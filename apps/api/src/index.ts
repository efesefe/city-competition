import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { teamsForPicker, TEAM_BY_ID } from "./data/teams.js";
import {
  authMode,
  issueOtp,
  normalizeTrPhone,
  publicUser,
  stubOAuthLogin,
  upsertPhoneUser,
  userFromRequest,
  verifyOtp,
} from "./lib/auth.js";
import { clientCount, publish, subscribe } from "./lib/bus.js";
import { getActionCost, getDb, getFreeGrant } from "./lib/db.js";
import {
  citySheet,
  forceGrantDaily,
  maybeGrantDailyEnergy,
  ownershipDigest,
  pickTribe,
  scoreboard,
  spendEnergy,
} from "./lib/game.js";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
  const db = getDb();
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get("/health", async () => ({
    ok: true,
    service: "city-competition-api",
    slice: "map-auth-spend",
    wsClients: clientCount(),
    auth: authMode(),
  }));

  app.get("/v1/meta", async () => ({
    actionCost: getActionCost(db),
    freeDailyGrant: getFreeGrant(db),
    auth: authMode(),
    shop: { stub: true, packs: [
      { sku: "small", energy: 200, tryPlaceholder: 49.99 },
      { sku: "medium", energy: 600, tryPlaceholder: 129.99 },
      { sku: "large", energy: 1500, tryPlaceholder: 249.99 },
    ]},
  }));

  app.get("/v1/teams", async () => ({ teams: teamsForPicker() }));

  app.get("/v1/map/digest", async () => ({ cities: ownershipDigest(db) }));

  app.get("/v1/scoreboard", async () => ({ teams: scoreboard(db) }));

  app.get<{ Params: { plate: string } }>("/v1/cities/:plate", async (req, reply) => {
    const sheet = citySheet(db, req.params.plate);
    if (!sheet) return reply.code(404).send({ error: "city_not_found" });
    return sheet;
  });

  app.get("/v1/me", async (req, reply) => {
    const user = userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    maybeGrantDailyEnergy(db, user.id);
    const refreshed = userFromRequest(db, req)!;
    const alias = refreshed.tribe_id ? TEAM_BY_ID.get(refreshed.tribe_id)?.publicAlias : null;
    return { user: publicUser(refreshed, alias) };
  });

  app.post("/v1/auth/phone/start", async (req, reply) => {
    const body = z.object({ phone: z.string().min(10) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_phone" });
    const e164 = normalizeTrPhone(body.data.phone);
    if (!e164) return reply.code(400).send({ error: "invalid_tr_phone" });
    const result = issueOtp(db, e164);
    return { ok: true, phoneE164: e164, ...result };
  });

  app.post("/v1/auth/phone/verify", async (req, reply) => {
    const body = z
      .object({ phone: z.string().min(10), code: z.string().min(4) })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const e164 = normalizeTrPhone(body.data.phone);
    if (!e164) return reply.code(400).send({ error: "invalid_tr_phone" });
    if (!verifyOtp(db, e164, body.data.code)) {
      return reply.code(401).send({ error: "invalid_otp" });
    }
    const { user, token } = upsertPhoneUser(db, e164);
    maybeGrantDailyEnergy(db, user.id);
    const refreshed = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id) as typeof user;
    const alias = refreshed.tribe_id ? TEAM_BY_ID.get(refreshed.tribe_id)?.publicAlias : null;
    return {
      token,
      user: publicUser(refreshed, alias),
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
    const mode = authMode();
    if (provider === "google" && !mode.googleEnabled) {
      // Still allow stub for local slice demo
    }
    const { user, token } = stubOAuthLogin(db, provider);
    return {
      token,
      user: publicUser(user),
      needsPhone: true,
      stub: true,
      note: "OAuth stub — bind phone before play",
    };
  });

  app.post("/v1/auth/phone/bind", async (req, reply) => {
    const user = userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const body = z
      .object({ phone: z.string().min(10), code: z.string().min(4) })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const e164 = normalizeTrPhone(body.data.phone);
    if (!e164) return reply.code(400).send({ error: "invalid_tr_phone" });
    if (!verifyOtp(db, e164, body.data.code)) {
      return reply.code(401).send({ error: "invalid_otp" });
    }
    const taken = db.prepare(`SELECT id FROM users WHERE phone_e164 = ? AND id != ?`).get(e164, user.id);
    if (taken) return reply.code(409).send({ error: "phone_taken" });
    db.prepare(`UPDATE users SET phone_e164 = ?, phone_verified = 1 WHERE id = ?`).run(e164, user.id);
    maybeGrantDailyEnergy(db, user.id);
    const refreshed = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id) as typeof user;
    const alias = refreshed.tribe_id ? TEAM_BY_ID.get(refreshed.tribe_id)?.publicAlias : null;
    return { user: publicUser(refreshed, alias) };
  });

  app.post("/v1/tribe/pick", async (req, reply) => {
    const user = userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const body = z.object({ tribeId: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const result = pickTribe(db, user.id, body.data.tribeId);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    const refreshed = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id) as typeof user;
    const alias = TEAM_BY_ID.get(body.data.tribeId)?.publicAlias ?? null;
    return { user: publicUser(refreshed, alias) };
  });

  app.post("/v1/energy/claim", async (req, reply) => {
    const user = userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const result = maybeGrantDailyEnergy(db, user.id);
    const refreshed = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id) as typeof user;
    const alias = refreshed.tribe_id ? TEAM_BY_ID.get(refreshed.tribe_id)?.publicAlias : null;
    return { ...result, user: publicUser(refreshed, alias) };
  });

  /** Dev/sim: force TR daily grant without waiting for midnight. */
  app.post("/v1/energy/grant-sim", async (req, reply) => {
    const user = userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.phone_verified) return reply.code(403).send({ error: "phone_unverified" });
    const result = forceGrantDaily(db, user.id);
    const refreshed = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id) as typeof user;
    const alias = refreshed.tribe_id ? TEAM_BY_ID.get(refreshed.tribe_id)?.publicAlias : null;
    return { ...result, simulated: true, user: publicUser(refreshed, alias) };
  });

  app.post("/v1/cities/:plate/spend", async (req, reply) => {
    const user = userFromRequest(db, req);
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
    const plate = (req.params as { plate: string }).plate;
    const result = spendEnergy(db, {
      userId: user.id,
      plate,
      amount: body.data.amount,
      idempotencyKey: body.data.idempotencyKey,
      confirmed: body.data.confirmed,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });

    const refreshed = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id) as typeof user;
    const alias = refreshed.tribe_id ? TEAM_BY_ID.get(refreshed.tribe_id)?.publicAlias : null;
    return {
      ...result,
      user: publicUser(refreshed, alias),
    };
  });

  app.get("/v1/ws", { websocket: true }, (socket) => {
    subscribe(socket);
    socket.send(JSON.stringify({ type: "digest", cities: ownershipDigest(db) }));
    const ping = setInterval(() => {
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: "ping" }));
    }, 25000);
    socket.on("close", () => clearInterval(ping));
  });

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`City Competition API slice on http://${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
