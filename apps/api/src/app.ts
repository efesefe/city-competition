import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { teamsForPicker, teamsGroupedForPicker, TEAM_BY_ID } from "./data/teams.js";
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
  type UserRow,
} from "./lib/auth.js";
import {
  attachClient,
  clientCount,
  digestSubscriberCount,
    subscribeChannel,
  unsubscribeChannel,
} from "./lib/bus.js";
import {
  ACTION_COST_BAND,
  adminApiKeyConfigured,
  adminKeyAuthorized,
} from "./lib/actionCost.js";
import { closeDb, getActionCost, getFreeGrant, getSubDailyBonus, one, setActionCost, type Db } from "./lib/db.js";
import {
  activateMatchDayFixtureStub,
  activatePersonalBoostStub,
  activateTeamBoostSim,
  boostSnapshotForUser,
  citySheet,
  listActiveMatchDayEvents,
  loadOwnershipDigest,
  pickTribe,
  playerScoreboard,
  findLedgerByIdempotencyKey,
  spendEnergy,
  teamScoreboard,
  type BoostSnapshot,
} from "./lib/game.js";

import {
  cancelMatchDayWindow,
  isAdminRole,
  listMatchDayWindows,
  promoteAdminSim,
  scheduleDerbyWar,
  scheduleTeamBoost,
  updateMatchDayWindow,
} from "./lib/admin-match-day.js";

import {
  adminOtpStatus,
  challengeAdminOtp,
  enrollAdminPhone,
  ensureAdminOpsDefaults,
  getOpsMetrics,
  getPackPrices,
  getSeasonBounds,
  getSeedStatus,
  listAuditLog,
  listTeamAddTickets,
  loadAliasesAndSeedMatrix,
  recordPurchaseStub,
  submitTeamAddTicket,
  triageTeamAddTicket,
  updateEconomyTunables,
  updatePackPrices,
  updateSeasonBounds,
} from "./lib/admin-ops.js";
import {
  energyGrantTriggersEnabled,
  forceGrantDaily,
  maybeGrantDailyEnergy,
  setSubEntitlement,
} from "./lib/energy.js";
import { kickEnergyGrantJob, startEnergyGrantScheduler } from "./lib/energyGrantScheduler.js";
import { TR_TIMEZONE, trDateString } from "./lib/trTime.js";
import { singleFlight } from "./lib/idempotency.js";
import { guestLoginPayload, phoneUnverifiedPayload } from "./lib/play-gates.js";
import { allow, DEFAULT_LIMITS, GROUPS } from "./lib/ratelimit.js";
import { closeRedis, pingRedis } from "./lib/redis.js";
import {
  deliverOtpSms,
  parseSendSmsHookBody,
  smsHookConfigured,
  verifySmsHookSecret,
} from "./lib/sms-hook.js";
import {
  lookupSupportUser,
  rebindPhone,
  requireSupportOps,
  supportOpsConfigured,
} from "./lib/support-rebind.js";
import { supabaseConfigured } from "./lib/supabase.js";
import {
  applyTutorialSpendProgress,
  getTutorialPayload,
  maybeAutoMarkClaimFromGrant,
  skipTutorial,
} from "./lib/tutorial.js";

export type BuildAppOptions = {
  db: Db;
  logger?: boolean;
  /** When false, skip onClose hooks that tear down shared process pools (tests). */
  closeSharedResources?: boolean;
};


async function publicUserWithBoost(db: Db, user: UserRow, teamAlias?: string | null) {
  const boost: BoostSnapshot = await boostSnapshotForUser(db, {
    userId: user.id,
    tribeId: user.tribe_id,
  });
  const alias =
    teamAlias !== undefined
      ? teamAlias
      : user.tribe_id
        ? (TEAM_BY_ID.get(user.tribe_id)?.publicAlias ?? null)
        : null;
  return publicUser(user, alias, boost);
}


async function requireAdmin(db: Db, req: Parameters<typeof userFromRequest>[1]) {
  const user = await userFromRequest(db, req);
  if (!user) return { ok: false as const, status: 401 as const, error: "unauthorized" as const };
  if (!isAdminRole(user.role)) {
    return { ok: false as const, status: 403 as const, error: "forbidden" as const };
  }
  return { ok: true as const, user };
}

/** Build the Fastify app (shared by server boot and load/smoke tests). */
export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { db } = opts;
  await ensureAdminOpsDefaults(db);
  const app = Fastify({ logger: opts.logger ?? true });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  const stopGrantScheduler = startEnergyGrantScheduler(db, app.log);

  if (opts.closeSharedResources !== false) {
    app.addHook("onClose", async () => {
      stopGrantScheduler();
      await closeDb();
      await closeRedis();
    });
  } else {
    app.addHook("onClose", async () => {
      stopGrantScheduler();
    });
  }

  /** Liveness for Fly / ops: 200 only when Postgres + Redis both answer. Never silent 200s. */
  async function healthHandler(_req: FastifyRequest, reply: FastifyReply) {
    const errors: string[] = [];
    let dbStatus: string | null = null;
    let redisStatus: string | null = null;

    try {
      await db.query("SELECT 1");
      dbStatus = "postgres";
    } catch {
      errors.push("db_unreachable");
    }

    try {
      redisStatus = await pingRedis();
    } catch {
      errors.push("redis_unreachable");
    }

    const energy = {
      timezone: TR_TIMEZONE,
      trDate: trDateString(),
      scheduler: process.env.ENERGY_GRANT_SCHEDULER === "true",
      grantTriggers: energyGrantTriggersEnabled(),
    };

    if (errors.length > 0) {
      return reply.code(503).send({
        ok: false,
        service: "city-competition-api",
        slice: "map-auth-spend",
        db: dbStatus,
        redis: redisStatus,
        reason: errors.join(","),
        errors,
        energy,
      });
    }

    return {
      ok: true,
      service: "city-competition-api",
      slice: "map-auth-spend",
      db: dbStatus,
      redis: redisStatus,
      wsClients: clientCount(),
      digestSubscribers: digestSubscriberCount(),
      auth: authMode(),
      energy,
    };
  }

  app.get("/health", healthHandler);
  app.get("/healthz", healthHandler);

  app.get("/v1/meta", async () => {
    const freeDailyGrant = await getFreeGrant(db);
    const subDailyBonus = await getSubDailyBonus(db);
    const prices = await getPackPrices(db);
    const season = await getSeasonBounds(db);
    return {
      actionCost: await getActionCost(db),
      actionCostBand: ACTION_COST_BAND,
      freeDailyGrant,
      subDailyBonus,
      timezone: TR_TIMEZONE,
      trDate: trDateString(),
      season,
      auth: authMode(),
      support: {
        lostSimRebind: true,
        opsKeyConfigured: supportOpsConfigured(),
        lookupPath: "/v1/support/users/lookup",
        rebindPath: "/v1/support/phone/rebind",
      },
      shop: {
        stub: true,
        packs: [
          { sku: "small", energy: 200, tryPlaceholder: prices.smallTry },
          { sku: "medium", energy: 600, tryPlaceholder: prices.mediumTry },
          { sku: "large", energy: 1500, tryPlaceholder: prices.largeTry },
        ],
        subDailyBonus,
        subscription: {
          sku: "monthly_sub",
          dailyBonus: 50,
          tryPlaceholder: prices.subTry,
        },
        /** Payments not ready — client shows SKU; activate via stub endpoint. */
        personalBoost: {
          sku: "personal_boost_1h",
          effect: "+50% support",
          durationMinutes: 60,
          tryPlaceholder: prices.personalBoostTry,
          purchase: "stub",
        },
      },
    };
  });


  /**
   * Admin read of economy tunables (action cost + free grant).
   * Auth unchanged — gated by `x-admin-key` / `ADMIN_API_KEY` (phone OTP console = later Admin leaf).
   */
  app.get("/v1/admin/tunables", async (req, reply) => {
    if (!adminApiKeyConfigured()) {
      return reply.code(503).send({ error: "admin_api_key_not_configured" });
    }
    if (!adminKeyAuthorized(req.headers["x-admin-key"])) {
      return reply.code(401).send({ error: "admin_unauthorized" });
    }
    return {
      actionCost: await getActionCost(db),
      actionCostBand: ACTION_COST_BAND,
      freeDailyGrant: await getFreeGrant(db),
    };
  });

  /**
   * Admin set attack/support cost within locked band 10–20 (default mid 15).
   * Body: `{ "actionCost": 12 }`
   */
  app.put("/v1/admin/tunables/action-cost", async (req, reply) => {
    if (!adminApiKeyConfigured()) {
      return reply.code(503).send({ error: "admin_api_key_not_configured" });
    }
    if (!adminKeyAuthorized(req.headers["x-admin-key"])) {
      return reply.code(401).send({ error: "admin_unauthorized" });
    }
    const body = z.object({ actionCost: z.number().int() }).safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({
        error: "invalid_body",
        actionCostBand: ACTION_COST_BAND,
        details: body.error.flatten(),
      });
    }
    const result = await setActionCost(db, body.data.actionCost);
    if (!result.ok) {
      return reply.code(400).send({
        error: result.error,
        actionCostBand: ACTION_COST_BAND,
        min: result.min,
        max: result.max,
      });
    }
    req.log.info(
      {
        tunable: "action_cost",
        previous: result.previous,
        actionCost: result.actionCost,
      },
      "admin action_cost updated",
    );
    return {
      ok: true,
      previous: result.previous,
      actionCost: result.actionCost,
      actionCostBand: ACTION_COST_BAND,
    };
  });

  /** Kabile picker roster — `public_alias` only; Big 4 first (CC-63). */
  app.get("/v1/teams", async () => {
    const grouped = teamsGroupedForPicker();
    return {
      order: "big4_first" as const,
      teams: teamsForPicker(),
      big4: grouped.big4,
      rest: grouped.rest,
    };
  });

  app.get("/v1/map/digest", async () => ({
    cities: await loadOwnershipDigest(db),
  }));

  /** Team board (cities owned) — guest browse OK. */
  app.get("/v1/scoreboards/teams", async () => teamScoreboard(db));

  /** User board (total support spent this season) — guest browse OK. */
  app.get("/v1/scoreboards/players", async (req) => {
    const q = req.query as { limit?: string };
    const limit = q.limit ? Number(q.limit) : 50;
    const viewer = await userFromRequest(db, req); // optional — guests still get the board
    return playerScoreboard(db, {
      limit: Number.isFinite(limit) ? limit : 50,
      viewerId: viewer?.id ?? null,
    });
  });

  /** Combined boards payload for the scoreboard screen (guest OK). */
  app.get("/v1/scoreboards", async (req) => {
    const q = req.query as { limit?: string };
    const limit = q.limit ? Number(q.limit) : 50;
    const viewer = await userFromRequest(db, req);
    const [teams, players] = await Promise.all([
      teamScoreboard(db),
      playerScoreboard(db, {
        limit: Number.isFinite(limit) ? limit : 50,
        viewerId: viewer?.id ?? null,
      }),
    ]);
    return { teams, players, guestBrowse: true as const };
  });

  /** Legacy alias — same team rows as /v1/scoreboards/teams.teams */
  app.get("/v1/scoreboard", async () => {
    const board = await teamScoreboard(db);
    return {
      season: board.season,
      metric: board.metric,
      guestBrowse: board.guestBrowse,
      teams: board.teams,
    };
  });

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
    return { user: await publicUserWithBoost(db, refreshed) };
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
    return {
      token: accessToken,
      user: await publicUserWithBoost(db, refreshed),
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
    return {
      token,
      user: await publicUserWithBoost(db, refreshed),
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
      user: await publicUserWithBoost(db, user),
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
    return { user: await publicUserWithBoost(db, refreshed) };
  });

  /**
   * Season 0 support ops — lost-SIM phone rebind (CC-22).
   * Auth: Bearer SUPPORT_OPS_KEY (Fly secret). Never wipes tribe/energy/ledger.
   */
  app.get("/v1/support/users/lookup", async (req, reply) => {
    if (!supportOpsConfigured()) {
      return reply.code(503).send({
        error: "support_ops_not_configured",
        note: "Set SUPPORT_OPS_KEY (min 16 chars) on the API",
      });
    }
    if (!requireSupportOps(req)) {
      return reply.code(401).send({ error: "unauthorized_support" });
    }
    const q = z
      .object({
        userId: z.string().min(1).optional(),
        phone: z.string().min(10).optional(),
        handle: z.string().min(1).optional(),
      })
      .safeParse(req.query);
    if (!q.success || (!q.data.userId && !q.data.phone && !q.data.handle)) {
      return reply.code(400).send({
        error: "lookup_requires_userId_phone_or_handle",
      });
    }
    const found = await lookupSupportUser(db, q.data);
    if (!found) return reply.code(404).send({ error: "user_not_found" });
    return { user: found };
  });

  app.post("/v1/support/phone/rebind", async (req, reply) => {
    if (!supportOpsConfigured()) {
      return reply.code(503).send({
        error: "support_ops_not_configured",
        note: "Set SUPPORT_OPS_KEY (min 16 chars) on the API",
      });
    }
    if (!requireSupportOps(req)) {
      return reply.code(401).send({ error: "unauthorized_support" });
    }
    const body = z
      .object({
        userId: z.string().min(1),
        newPhone: z.string().min(10),
        reason: z.string().min(3).max(500),
        actor: z.string().min(2).max(200),
        ticketId: z.string().max(120).optional(),
        syncSupabase: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
    }
    const result = await rebindPhone(db, body.data);
    if (!result.ok) {
      return reply.code(result.status).send({
        error: result.error,
        note: result.note,
      });
    }
    return result;
  });

  app.post("/v1/tribe/pick", async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send(guestLoginPayload());
    const body = z.object({ tribeId: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const result = await pickTribe(db, user.id, body.data.tribeId);
    if (!result.ok) {
      if (result.error === "phone_unverified") {
        return reply.code(403).send(phoneUnverifiedPayload("kabile"));
      }
      return reply.code(result.status).send({ error: result.error });
    }
    const refreshed = (await getUserById(db, user.id))!;
    const alias = TEAM_BY_ID.get(body.data.tribeId)?.publicAlias ?? null;
    return { user: await publicUserWithBoost(db, refreshed, alias) };
  });

  app.post("/v1/energy/claim", async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send(guestLoginPayload());
    if (!user.phone_verified) {
      return reply.code(403).send(phoneUnverifiedPayload("play"));
    }
    const result = await maybeGrantDailyEnergy(db, user.id);
    await maybeAutoMarkClaimFromGrant(
      db,
      user.id,
      "reason" in result ? result.reason : undefined,
      Boolean(result.granted),
    );
    const refreshed = (await getUserById(db, user.id))!;
    return { ...result, user: await publicUserWithBoost(db, refreshed) };
  });

  /** Dev/sim: force TR daily grant for the caller without waiting for midnight. */
  app.post("/v1/energy/grant-sim", async (req, reply) => {
    if (!energyGrantTriggersEnabled()) {
      return reply.code(403).send({ error: "grant_triggers_disabled" });
    }
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send(guestLoginPayload());
    if (!user.phone_verified) {
      return reply.code(403).send(phoneUnverifiedPayload("play"));
    }
    const result = await forceGrantDaily(db, user.id);
    await maybeAutoMarkClaimFromGrant(db, user.id, undefined, Boolean(result.granted));
    const refreshed = (await getUserById(db, user.id))!;
    return { ...result, simulated: true, timezone: TR_TIMEZONE, user: await publicUserWithBoost(db, refreshed) };
  });

  /**
   * Dev/ops: run the TR midnight free-energy batch now (expire unused free → grant 100).
   * Body `{ "force": true }` re-grants even if already granted today.
   * Gated by ALLOW_ENERGY_GRANT_TRIGGERS (defaults on outside production).
   */
  app.post("/v1/energy/grant-job", async (req, reply) => {
    if (!energyGrantTriggersEnabled()) {
      return reply.code(403).send({ error: "grant_triggers_disabled" });
    }
    const body = z.object({ force: z.boolean().optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const result = await kickEnergyGrantJob(db, { force: body.data.force });
    return { ok: true, job: result };
  });

  /**
   * Dev/ops: set `sub_active` entitlement without payments (Season 0 stub).
   * Body `{ "active": true }` for the Bearer user, or `{ "active": true, "userId": "…" }` for ops.
   */
  app.post("/v1/energy/sub-entitle", async (req, reply) => {
    if (!energyGrantTriggersEnabled()) {
      return reply.code(403).send({ error: "grant_triggers_disabled" });
    }
    const body = z
      .object({ active: z.boolean(), userId: z.string().min(1).optional() })
      .safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });

    let targetId = body.data.userId;
    if (!targetId) {
      const user = await userFromRequest(db, req);
      if (!user) return reply.code(401).send({ error: "unauthorized" });
      targetId = user.id;
    }

    const result = await setSubEntitlement(db, targetId, body.data.active);
    if (!result.ok) return reply.code(404).send({ error: result.reason });
    const refreshed = await getUserById(db, targetId);
    return {
      ...result,
      user: refreshed ? await publicUserWithBoost(db, refreshed) : null,
    };
  });


  /** Payments stub until IAP/iyzico — activates +50% / 1h with real expiry timing. */
  app.post("/v1/boosts/personal/stub", async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const result = await activatePersonalBoostStub(db, user.id);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    const refreshed = (await getUserById(db, user.id))!;
    return {
      ok: true,
      stub: true,
      boost: result.boost,
      user: await publicUserWithBoost(db, refreshed),
      note: "Personal boost activated without payment — Payments leaf wires real SKU later",
    };
  });

  /** Dev/sim team +25% window so personal×team stacking can be exercised before admin match-day. */
  app.post("/v1/boosts/team/sim", async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const result = await activateTeamBoostSim(db, user.id);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    const refreshed = (await getUserById(db, user.id))!;
    return {
      ok: true,
      simulated: true,
      boost: result.boost,
      windowId: result.windowId,
      user: await publicUserWithBoost(db, refreshed),
    };
  });

  /** Guest-readable active match-day windows for map banner + spotlight chrome. */
  app.get("/v1/match-day/active", async () => ({
    events: await listActiveMatchDayEvents(db),
  }));

  /**
   * Fixture stub until Admin MatchDay ops: team +25% + spotlight city (default İstanbul).
   * Prefer this over team-boost-only sims when verifying locked banner+spotlight chrome.
   */
  app.post("/v1/match-day/fixture-stub", async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const body = z
      .object({
        spotlightPlate: z.string().min(1).max(3).optional(),
        label: z.string().max(80).nullable().optional(),
        durationMs: z.number().int().min(60_000).max(8 * 60 * 60 * 1000).optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
    }
    const result = await activateMatchDayFixtureStub(db, user.id, body.data);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    const refreshed = (await getUserById(db, user.id))!;
    return {
      ok: true,
      stub: true,
      event: result.event,
      boost: result.boost,
      user: await publicUserWithBoost(db, refreshed),
      note: "Fixture stub — Admin MatchDay scheduling leaf replaces this",
    };
  });

  /** Slice bootstrap: promote verified caller to admin (OTP enrollment is a later leaf). */
  app.post("/v1/admin/promote-sim", async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const result = await promoteAdminSim(db, user.id);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    const refreshed = (await getUserById(db, user.id))!;
    return { ok: true, simulated: true, user: await publicUserWithBoost(db, refreshed) };
  });

  /** CC-50/51: list scheduled match-day windows (team boosts + derby wars). */
  app.get("/v1/admin/match-day", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const q = req.query as { includeCanceled?: string; kind?: string };
    const kind =
      q.kind === "team_boost" || q.kind === "derby_war" ? q.kind : undefined;
    const windows = await listMatchDayWindows(db, {
      includeCanceled: q.includeCanceled === "1" || q.includeCanceled === "true",
      kind,
    });
    return { windows };
  });

  /** CC-50: schedule +25% team boost (kickoff−1h → FT+30m via kickoffAt/fullTimeAt, or explicit window). */
  app.post("/v1/admin/match-day/team-boosts", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const body = z
      .object({
        teamId: z.string().min(1),
        boostPct: z.number().min(1).max(3).optional(),
        startsAt: z.string().optional(),
        endsAt: z.string().optional(),
        kickoffAt: z.string().optional(),
        fullTimeAt: z.string().optional(),
        notes: z.string().nullable().optional(),
        label: z.string().nullable().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
    }
    const result = await scheduleTeamBoost(db, {
      ...body.data,
      adminUserId: gate.user.id,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return reply.code(201).send({ window: result.window });
  });

  /** CC-51: schedule derby timed city war (spotlight on plate; boost optional, default 1.0). */
  app.post("/v1/admin/match-day/derby-wars", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const body = z
      .object({
        teamId: z.string().min(1),
        spotlightPlate: z.string().min(1).max(3),
        boostPct: z.number().min(1).max(3).optional(),
        startsAt: z.string().optional(),
        endsAt: z.string().optional(),
        kickoffAt: z.string().optional(),
        fullTimeAt: z.string().optional(),
        notes: z.string().nullable().optional(),
        label: z.string().nullable().optional(),
        involvedAliases: z.string().nullable().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
    }
    const result = await scheduleDerbyWar(db, {
      ...body.data,
      adminUserId: gate.user.id,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return reply.code(201).send({ window: result.window });
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/match-day/:id", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const id = req.params.id;
    const body = z
      .object({
        boostPct: z.number().min(1).max(3).optional(),
        startsAt: z.string().optional(),
        endsAt: z.string().optional(),
        notes: z.string().nullable().optional(),
        label: z.string().nullable().optional(),
        spotlightPlate: z.string().nullable().optional(),
        involvedAliases: z.string().nullable().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
    }
    const result = await updateMatchDayWindow(db, id, body.data);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return { window: result.window };
  });

  app.post<{ Params: { id: string } }>("/v1/admin/match-day/:id/cancel", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const id = req.params.id;
    const result = await cancelMatchDayWindow(db, id);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return { window: result.window };
  });


  /** CC-52: admin phone enrollment + purpose OTP for gated writes. */
  app.get("/v1/admin/otp/status", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    return adminOtpStatus(db, gate.user.id);
  });

  app.post("/v1/admin/otp/enroll", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const body = z.object({ phone: z.string().optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const result = await enrollAdminPhone(db, gate.user.id, body.data.phone);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return result;
  });

  app.post("/v1/admin/otp/challenge", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const body = z.object({ purpose: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const result = await challengeAdminOtp(db, gate.user.id, body.data.purpose);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return result;
  });

  app.get("/v1/admin/economy", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    return {
      prices: await getPackPrices(db),
      freeDailyGrant: await getFreeGrant(db),
      actionCost: await getActionCost(db),
      season: await getSeasonBounds(db),
    };
  });

  app.post("/v1/admin/economy/pack-prices", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const body = z
      .object({
        otp: z.string().min(4),
        smallTry: z.number().nonnegative().nullable().optional(),
        mediumTry: z.number().nonnegative().nullable().optional(),
        largeTry: z.number().nonnegative().nullable().optional(),
        subTry: z.number().nonnegative().nullable().optional(),
        personalBoostTry: z.number().nonnegative().nullable().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
    }
    const { otp, ...prices } = body.data;
    const result = await updatePackPrices(db, { actorUserId: gate.user.id, otp, prices });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return result;
  });

  app.post("/v1/admin/economy/tunables", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const body = z
      .object({
        otp: z.string().min(4),
        freeDailyGrant: z.number().optional(),
        actionCost: z.number().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
    }
    const result = await updateEconomyTunables(db, {
      actorUserId: gate.user.id,
      otp: body.data.otp,
      freeDailyGrant: body.data.freeDailyGrant,
      actionCost: body.data.actionCost,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return result;
  });

  app.post("/v1/admin/season/bounds", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const body = z
      .object({
        otp: z.string().min(4),
        season0StartsAt: z.string().optional(),
        season0EndsAt: z.string().optional(),
        season1PrepStartsAt: z.string().nullable().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
    }
    const result = await updateSeasonBounds(db, {
      actorUserId: gate.user.id,
      otp: body.data.otp,
      season0StartsAt: body.data.season0StartsAt,
      season0EndsAt: body.data.season0EndsAt,
      season1PrepStartsAt: body.data.season1PrepStartsAt,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return result;
  });

  /** CC-54: aliases + 81-city seed matrix status / OTP-gated load. */
  app.get("/v1/admin/seeds/status", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    return getSeedStatus(db);
  });

  app.post("/v1/admin/seeds/load", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const body = z
      .object({
        otp: z.string().min(4),
        resetSupport: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
    }
    const result = await loadAliasesAndSeedMatrix(db, {
      actorUserId: gate.user.id,
      otp: body.data.otp,
      resetSupport: body.data.resetSupport,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return result;
  });

  /** CC-53: player submit + admin triage team-add tickets. */
  app.post("/v1/tickets/team-add", async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.phone_verified) return reply.code(403).send({ error: "phone_unverified" });
    const body = z.object({ requestedClub: z.string().min(2).max(120) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const result = await submitTeamAddTicket(db, {
      userId: user.id,
      requestedClub: body.data.requestedClub,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return reply.code(201).send(result);
  });

  app.get("/v1/admin/tickets/team-add", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const q = req.query as { status?: string };
    const status =
      q.status === "open" ||
      q.status === "accepted" ||
      q.status === "rejected" ||
      q.status === "deferred"
        ? q.status
        : undefined;
    return { tickets: await listTeamAddTickets(db, { status }) };
  });

  app.post<{ Params: { id: string } }>("/v1/admin/tickets/team-add/:id/triage", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const id = req.params.id;
    const body = z
      .object({
        action: z.enum(["accept", "reject", "defer"]),
        adminNote: z.string().nullable().optional(),
        publicAlias: z.string().optional(),
        primaryColor: z.string().optional(),
        secondaryColor: z.string().optional(),
        internalId: z.string().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
    }
    const result = await triageTeamAddTicket(db, {
      ticketId: id,
      adminUserId: gate.user.id,
      ...body.data,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return result;
  });

  /** CC-55: soft-launch ops metrics (watch-only; no kill gates). */
  app.get("/v1/admin/metrics", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    return { metrics: await getOpsMetrics(db) };
  });

  app.get("/v1/admin/audit", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    return { entries: await listAuditLog(db) };
  });

  /** Dev stub: record a purchase event so revenue widgets are exercisable. */
  app.post("/v1/admin/metrics/purchase-sim", async (req, reply) => {
    const gate = await requireAdmin(db, req);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const body = z
      .object({
        sku: z.string().min(1).default("small"),
        amountTry: z.number().positive(),
        userId: z.string().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const result = await recordPurchaseStub(db, {
      userId: body.data.userId ?? gate.user.id,
      sku: body.data.sku,
      amountTry: body.data.amountTry,
    });
    return { simulated: true, ...result };
  });

  app.post("/v1/cities/:plate/spend", async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send(guestLoginPayload());
    const body = z
      .object({
        confirmed: z.literal(true),
        idempotencyKey: z.string().min(8),
        /** Optional confirm of current admin-tuned cost; must match `GET /v1/meta.actionCost`. */
        amount: z.number().int().min(ACTION_COST_BAND.min).max(ACTION_COST_BAND.max).optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({
        error: "confirm_required_or_invalid",
        actionCostBand: ACTION_COST_BAND,
        details: body.error.flatten(),
      });
    }
    const plate = (req.params as { plate: string }).plate;
    const idempotencyKey = body.data.idempotencyKey;

    // One pipeline per user+key: concurrent double-taps share work and do not burn N rate tokens.
    const payload = await singleFlight(`http-spend:${user.id}:${idempotencyKey}`, async () => {
      const prior = await findLedgerByIdempotencyKey(db, idempotencyKey);
      if (!prior) {
        const rl = await allow(user.id, GROUPS.supportSpend, DEFAULT_LIMITS.supportSpend);
        if (!rl.allowed) {
          return {
            status: 429 as const,
            headers: { "retry-after": String(rl.retryAfterSec) },
            body: { error: "rate_limit_exceeded", retryAfterSec: rl.retryAfterSec },
          };
        }
      }

      const result = await spendEnergy(db, {
        userId: user.id,
        plate,
        amount: body.data.amount,
        idempotencyKey,
        confirmed: body.data.confirmed,
      });
      if (!result.ok) {
        if (result.error === "phone_unverified") {
          return { status: 403 as const, body: phoneUnverifiedPayload("spend") };
        }
        return {
          status: result.status,
          body: {
            error: result.error,
            ...("actionCost" in result ? { actionCost: result.actionCost } : {}),
          },
        };
      }

      if (
        !("idempotentReplay" in result && result.idempotentReplay) &&
        "flipped" in result &&
        user.tribe_id
      ) {
        await applyTutorialSpendProgress(db, {
          userId: user.id,
          plate,
          flipped: Boolean(result.flipped),
          toTeamId:
            result.flipped && result.sheet?.ownerTeamId
              ? result.sheet.ownerTeamId
              : user.tribe_id,
          tribeId: user.tribe_id,
        });
      }

      const refreshed = (await getUserById(db, user.id))!;
      return {
        status: 200 as const,
        body: {
          ...result,
          user: await publicUserWithBoost(db, refreshed),
        },
      };
    });

    if (payload.status === 429 && "headers" in payload && payload.headers) {
      return reply
        .code(429)
        .header("retry-after", payload.headers["retry-after"])
        .send(payload.body);
    }
    return reply.code(payload.status).send(payload.body);
  });

  /** First-session tutorial state + locked dynamic cities (CC-61). */
  app.get("/v1/tutorial", async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send(guestLoginPayload());
    if (!user.phone_verified) {
      return reply.code(403).send(phoneUnverifiedPayload("play"));
    }
    if (!user.tribe_id) {
      return reply.code(403).send({ error: "tribe_required", gate: "kabile" });
    }
    const tutorial = await getTutorialPayload(db, user);
    const refreshed = (await getUserById(db, user.id))!;
    const alias = TEAM_BY_ID.get(refreshed.tribe_id!)?.publicAlias ?? null;
    return { tutorial, user: publicUser(refreshed, alias) };
  });

  /** Skip remaining coach marks after verify / first session (locked). */
  app.post("/v1/tutorial/skip", async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send(guestLoginPayload());
    if (!user.phone_verified) {
      return reply.code(403).send(phoneUnverifiedPayload("play"));
    }
    await skipTutorial(db, user.id);
    const refreshed = (await getUserById(db, user.id))!;
    return { skipped: true, user: await publicUserWithBoost(db, refreshed) };
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

  return app;
}
