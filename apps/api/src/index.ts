import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { teamsForPicker, TEAM_BY_ID } from "./data/teams.js";
import {
  authMode,
  getUserById,
  issueOtp,
  normalizeTrPhone,
  publicUser,
  sessionFromSupabaseToken,
  stubOAuthLogin,
  upsertPhoneUser,
  userFromRequest,
  verifyOtp,
} from "./lib/auth.js";
import {
  attachClient,
  clientCount,
  digestSubscriberCount,
  startBus,
  subscribeChannel,
  unsubscribeChannel,
} from "./lib/bus.js";
import { closeDb, getActionCost, getFreeGrant, initDb, one } from "./lib/db.js";
import {
  citySheet,
  forceGrantDaily,
  loadOwnershipDigest,
  maybeGrantDailyEnergy,
  pickTribe,
  scoreboard,
  spendEnergy,
  warmDigestCache,
} from "./lib/game.js";
import { allow, DEFAULT_LIMITS, GROUPS } from "./lib/ratelimit.js";
import { closeRedis, pingRedis } from "./lib/redis.js";
import {
  deliverOtpSms,
  parseSendSmsHookBody,
  smsHookConfigured,
  verifySmsHookSecret,
} from "./lib/sms-hook.js";
import { supabaseConfigured } from "./lib/supabase.js";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
  const db = await initDb();
  await startBus();
  const warmed = await warmDigestCache(db);
  console.info(`[digest] warmed Redis cache with ${warmed} cities`);
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.addHook("onClose", async () => {
    await closeDb();
    await closeRedis();
  });

  app.get("/health", async () => {
    await db.query("SELECT 1");
    const redis = await pingRedis();
    return {
      ok: true,
      service: "city-competition-api",
      slice: "map-auth-spend",
      db: "postgres",
      redis,
      wsClients: clientCount(),
      digestSubscribers: digestSubscriberCount(),
      auth: authMode(),
    };
  });

  app.get("/v1/meta", async () => ({
    actionCost: await getActionCost(db),
    freeDailyGrant: await getFreeGrant(db),
    auth: authMode(),
    shop: {
      stub: true,
      packs: [
        { sku: "small", energy: 200, tryPlaceholder: 49.99 },
        { sku: "medium", energy: 600, tryPlaceholder: 129.99 },
        { sku: "large", energy: 1500, tryPlaceholder: 249.99 },
      ],
    },
  }));

  app.get("/v1/teams", async () => ({ teams: teamsForPicker() }));

  app.get("/v1/map/digest", async () => ({
    cities: await loadOwnershipDigest(db),
  }));

  app.get("/v1/scoreboard", async () => ({ teams: await scoreboard(db) }));

  app.get<{ Params: { plate: string } }>("/v1/cities/:plate", async (req, reply) => {
    const sheet = await citySheet(db, req.params.plate);
    if (!sheet) return reply.code(404).send({ error: "city_not_found" });
    return sheet;
  });

  app.get("/v1/me", async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    await maybeGrantDailyEnergy(db, user.id);
    const refreshed = (await getUserById(db, user.id))!;
    const alias = refreshed.tribe_id ? TEAM_BY_ID.get(refreshed.tribe_id)?.publicAlias : null;
    return { user: publicUser(refreshed, alias) };
  });

  /**
   * Sync Supabase Auth session → local User row.
   * Client: authenticate with Supabase SDK, then POST Bearer access_token here (or use /v1/me).
   */
  app.post("/v1/auth/supabase/session", async (req, reply) => {
    if (!supabaseConfigured()) {
      return reply.code(503).send({
        error: "supabase_not_configured",
        note: "Set SUPABASE_URL + SUPABASE_JWT_SECRET, or use mock phone OTP",
      });
    }
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "missing_bearer" });
    }
    const accessToken = header.slice(7);
    const session = await sessionFromSupabaseToken(db, accessToken);
    if (!session) return reply.code(401).send({ error: "invalid_supabase_token" });
    await maybeGrantDailyEnergy(db, session.user.id);
    const refreshed = (await getUserById(db, session.user.id))!;
    const alias = refreshed.tribe_id ? TEAM_BY_ID.get(refreshed.tribe_id)?.publicAlias : null;
    return {
      token: accessToken,
      user: publicUser(refreshed, alias),
      needsPhone: session.needsPhone,
      mode: "supabase",
      supabaseShaped: {
        access_token: accessToken,
        token_type: "bearer",
        user: {
          id: refreshed.supabase_user_id ?? refreshed.id,
          phone: refreshed.phone_e164,
          phone_confirmed_at: refreshed.phone_verified ? new Date().toISOString() : null,
        },
      },
    };
  });

  /**
   * Supabase Send SMS Hook — Netgsm OTP when credentials + SMS_HOOK_DRY_RUN=false.
   * Point Supabase Auth → Hooks → Send SMS here. Dry-run logs OTP when keys absent.
   */
  app.post("/v1/auth/hooks/send-sms", async (req, reply) => {
    if (!smsHookConfigured()) {
      return reply.code(503).send({
        error: "sms_hook_secret_missing",
        note: "Set SEND_SMS_HOOK_SECRETS to the Supabase hook secret",
      });
    }
    if (!verifySmsHookSecret(req.headers as Record<string, string | string[] | undefined>)) {
      return reply.code(401).send({ error: "invalid_hook_secret" });
    }
    const { phone, otp } = parseSendSmsHookBody(req.body);
    const result = await deliverOtpSms({ phone, otp });
    if (result.error === "missing_phone_or_otp") {
      return reply.code(400).send({ success: false, ...result });
    }
    if (result.provider === "netgsm" && !result.delivered) {
      // Tell Supabase the send failed so the client can surface an error / retry.
      return reply.code(502).send({ success: false, ...result });
    }
    // Dry-run and successful Netgsm accepts → 200.
    return reply.code(200).send({
      success: true,
      ...result,
    });
  });

  app.post("/v1/auth/phone/start", async (req, reply) => {
    if (supabaseConfigured()) {
      return reply.code(400).send({
        error: "use_supabase_phone_otp",
        note: "Call supabase.auth.signInWithOtp on the client, then POST /v1/auth/supabase/session",
      });
    }
    const body = z.object({ phone: z.string().min(10) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_phone" });
    const e164 = normalizeTrPhone(body.data.phone);
    if (!e164) return reply.code(400).send({ error: "invalid_tr_phone" });
    const rl = await allow(e164, GROUPS.otpStart, DEFAULT_LIMITS.otpStart);
    if (!rl.allowed) {
      return reply
        .code(429)
        .header("retry-after", String(rl.retryAfterSec))
        .send({ error: "rate_limit_exceeded", retryAfterSec: rl.retryAfterSec });
    }
    try {
      const result = await issueOtp(db, e164);
      return { ok: true, phoneE164: e164, ...result };
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      return reply.code(err.statusCode ?? 500).send({ error: err.message });
    }
  });

  app.post("/v1/auth/phone/verify", async (req, reply) => {
    if (supabaseConfigured()) {
      return reply.code(400).send({
        error: "use_supabase_phone_otp",
        note: "Call supabase.auth.verifyOtp on the client, then POST /v1/auth/supabase/session",
      });
    }
    const body = z
      .object({ phone: z.string().min(10), code: z.string().min(4) })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const e164 = normalizeTrPhone(body.data.phone);
    if (!e164) return reply.code(400).send({ error: "invalid_tr_phone" });
    const rl = await allow(e164, GROUPS.otpVerify, DEFAULT_LIMITS.otpVerify);
    if (!rl.allowed) {
      return reply
        .code(429)
        .header("retry-after", String(rl.retryAfterSec))
        .send({ error: "rate_limit_exceeded", retryAfterSec: rl.retryAfterSec });
    }
    if (!(await verifyOtp(db, e164, body.data.code))) {
      return reply.code(401).send({ error: "invalid_otp" });
    }
    const { user, token } = await upsertPhoneUser(db, e164);
    await maybeGrantDailyEnergy(db, user.id);
    const refreshed = (await getUserById(db, user.id))!;
    const alias = refreshed.tribe_id ? TEAM_BY_ID.get(refreshed.tribe_id)?.publicAlias : null;
    return {
      token,
      user: publicUser(refreshed, alias),
      mode: "mock",
      supabaseShaped: {
        access_token: token,
        token_type: "bearer",
        user: { id: user.id, phone: e164, phone_confirmed_at: new Date().toISOString() },
      },
    };
  });

  app.post("/v1/auth/oauth/:provider", async (req, reply) => {
    const provider = (req.params as { provider: string }).provider;
    if (provider !== "google" && provider !== "apple") {
      return reply.code(400).send({ error: "unsupported_provider" });
    }
    if (supabaseConfigured()) {
      return reply.code(400).send({
        error: "use_supabase_oauth",
        note: `Call supabase.auth.signInWithOAuth({ provider: '${provider}' }) then POST /v1/auth/supabase/session`,
      });
    }
    const { user, token } = await stubOAuthLogin(db, provider);
    return {
      token,
      user: publicUser(user),
      needsPhone: true,
      stub: true,
      mode: "mock",
      note: "OAuth stub (no Supabase) — bind phone before play",
    };
  });

  app.post("/v1/auth/phone/bind", async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (supabaseConfigured()) {
      return reply.code(400).send({
        error: "use_supabase_phone_bind",
        note: "Use supabase.auth.updateUser({ phone }) + verifyOtp, then refresh /v1/auth/supabase/session",
      });
    }
    const body = z
      .object({ phone: z.string().min(10), code: z.string().min(4) })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const e164 = normalizeTrPhone(body.data.phone);
    if (!e164) return reply.code(400).send({ error: "invalid_tr_phone" });
    if (!(await verifyOtp(db, e164, body.data.code))) {
      return reply.code(401).send({ error: "invalid_otp" });
    }
    const taken = await one<{ id: string }>(
      db,
      `SELECT id FROM users WHERE phone_e164 = $1 AND id != $2`,
      [e164, user.id],
    );
    if (taken) return reply.code(409).send({ error: "phone_taken" });
    await db.query(`UPDATE users SET phone_e164 = $1, phone_verified = TRUE WHERE id = $2`, [
      e164,
      user.id,
    ]);
    await maybeGrantDailyEnergy(db, user.id);
    const refreshed = (await getUserById(db, user.id))!;
    const alias = refreshed.tribe_id ? TEAM_BY_ID.get(refreshed.tribe_id)?.publicAlias : null;
    return { user: publicUser(refreshed, alias) };
  });

  app.post("/v1/tribe/pick", async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const body = z.object({ tribeId: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const result = await pickTribe(db, user.id, body.data.tribeId);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    const refreshed = (await getUserById(db, user.id))!;
    const alias = TEAM_BY_ID.get(body.data.tribeId)?.publicAlias ?? null;
    return { user: publicUser(refreshed, alias) };
  });

  app.post("/v1/energy/claim", async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const result = await maybeGrantDailyEnergy(db, user.id);
    const refreshed = (await getUserById(db, user.id))!;
    const alias = refreshed.tribe_id ? TEAM_BY_ID.get(refreshed.tribe_id)?.publicAlias : null;
    return { ...result, user: publicUser(refreshed, alias) };
  });

  /** Dev/sim: force TR daily grant without waiting for midnight. */
  app.post("/v1/energy/grant-sim", async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.phone_verified) return reply.code(403).send({ error: "phone_unverified" });
    const result = await forceGrantDaily(db, user.id);
    const refreshed = (await getUserById(db, user.id))!;
    const alias = refreshed.tribe_id ? TEAM_BY_ID.get(refreshed.tribe_id)?.publicAlias : null;
    return { ...result, simulated: true, user: publicUser(refreshed, alias) };
  });

  app.post("/v1/cities/:plate/spend", async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const body = z
      .object({
        confirmed: z.literal(true),
        idempotencyKey: z.string().min(8),
        amount: z.number().int().min(10).max(20).optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "confirm_required_or_invalid", details: body.error.flatten() });
    }
    const rl = await allow(user.id, GROUPS.supportSpend, DEFAULT_LIMITS.supportSpend);
    if (!rl.allowed) {
      return reply
        .code(429)
        .header("retry-after", String(rl.retryAfterSec))
        .send({ error: "rate_limit_exceeded", retryAfterSec: rl.retryAfterSec });
    }
    const plate = (req.params as { plate: string }).plate;
    const result = await spendEnergy(db, {
      userId: user.id,
      plate,
      amount: body.data.amount,
      idempotencyKey: body.data.idempotencyKey,
      confirmed: body.data.confirmed,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });

    const refreshed = (await getUserById(db, user.id))!;
    const alias = refreshed.tribe_id ? TEAM_BY_ID.get(refreshed.tribe_id)?.publicAlias : null;
    return {
      ...result,
      user: publicUser(refreshed, alias),
    };
  });

  /**
   * Live ownership/support digest for guests and logged-in players.
   *
   * Protocol:
   *   ← { type: "hello", channels: ["digest"], authRequired: false }
   *   → { type: "subscribe", channel: "digest" }
   *   ← { type: "subscribed", channel: "digest" }
   *   ← { type: "digest", cities: [...81] }   // snapshot (Redis cache when warm)
   *   ← { type: "support" | "flip" | "digest" | "ping" }  // live
   *   → { type: "unsubscribe", channel: "digest" }
   *   → { type: "ping" } → ← { type: "pong" }
   *
   * No auth gate: guests receive the same digest channel as fighters (architecture lock).
   */
  app.get("/v1/ws", { websocket: true }, (socket) => {
    attachClient(socket);
    if (socket.readyState === 1) {
      socket.send(
        JSON.stringify({
          type: "hello",
          channels: ["digest"],
          authRequired: false,
          note: "Send {type:\"subscribe\",channel:\"digest\"} for the 81-city snapshot + live updates",
        }),
      );
    }

    const sendDigestSnapshot = async () => {
      const cities = await loadOwnershipDigest(db);
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ type: "digest", cities }));
      }
    };

    socket.on("message", (raw) => {
      let msg: { type?: string; channel?: string };
      try {
        msg = JSON.parse(String(raw)) as { type?: string; channel?: string };
      } catch {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: "error", error: "invalid_json" }));
        }
        return;
      }

      if (msg.type === "ping") {
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: "pong" }));
        return;
      }

      if (msg.type === "subscribe") {
        if (msg.channel !== "digest") {
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({ type: "error", error: "unknown_channel" }));
          }
          return;
        }
        subscribeChannel(socket, "digest");
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: "subscribed", channel: "digest" }));
        }
        void sendDigestSnapshot();
        return;
      }

      if (msg.type === "unsubscribe") {
        if (msg.channel === "digest") {
          unsubscribeChannel(socket, "digest");
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({ type: "unsubscribed", channel: "digest" }));
          }
        }
        return;
      }
    });

    const ping = setInterval(() => {
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: "ping" }));
    }, 25000);
    socket.on("close", () => clearInterval(ping));
  });

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`City Competition API on http://${HOST}:${PORT} (Postgres + Redis + WS digest)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
