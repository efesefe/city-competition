import { API_URL } from "./config";

export type TutorialStep = "claim" | "capture" | "fight" | "done" | "idle";

export type TutorialState = {
  claimedEnergy: boolean;
  capture: boolean;
  liveFight: boolean;
  skipped: boolean;
  complete: boolean;
  capturePlate: string | null;
  fightPlate: string | null;
  captureName?: string | null;
  fightName?: string | null;
  captureConfirms?: number;
  captureConfirmsNeeded?: number;
  step: TutorialStep;
  active: boolean;
};

export type PublicUser = {
  id: string;
  handle: string;
  phoneVerified: boolean;
  phoneE164: string | null;
  tribeId: string | null;
  tribeAlias: string | null;
  subActive?: boolean;
  role?: "player" | "admin";
  energy: { free: number; paid: number; sub: number; total: number };
  /** Live personal × team multipliers for boosted-support UI. */
  boost?: BoostSnapshot;
  tutorial?: TutorialState;
};

export type MatchDayWindow = {
  id: string;
  kind: "team_boost" | "derby_war";
  teamId: string;
  teamAlias: string;
  boostPct: number;
  startsAt: string;
  endsAt: string;
  notes: string | null;
  label: string | null;
  spotlightPlate: string | null;
  cityNameTr: string | null;
  involvedAliases: string | null;
  canceledAt: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type ShopCatalog = {
  stub: boolean;
  provider: "revenuecat";
  packs: {
    sku: string;
    kind: "pack";
    energy: number;
    productId: string;
    iosProductId?: string;
    androidProductId?: string;
    tryPlaceholder: number;
  }[];
  subscription: {
    sku: string;
    kind: "subscription";
    productId: string;
    iosProductId?: string;
    androidProductId?: string;
    entitlementId: string;
    dailyBonus: number;
    tryPlaceholder: number;
  };

  personalBoost?: {
    sku: string;
    effect: string;
    durationMinutes: number;
    tryPlaceholder: number | null;
    purchase: string;
  };
};

export type DigestCity = {
  plate: string;
  ownerTeamId: string | null;
  ownerAlias: string | null;
  ownerColor: string | null;
  /** Present on WS/HTTP digest after CC-36 — top cumulative support. */
  leadSupport?: number;
  rivalSupport?: number;
  leadMargin?: number;
};

export type CityContributor = {
  handle: string;
  /** Current Kabile public_alias for the contributor (may be null). */
  alias: string | null;
  support: number;
};

export type CitySheet = {
  plate: string;
  nameTr: string;
  ownerTeamId: string | null;
  ownerAlias: string | null;
  ownerColor: string | null;
  support: { teamId: string; alias: string; color: string; support: number }[];
  leadMargin: number;
  topContributors: CityContributor[];
};

export type Team = {
  internalId: string;
  publicAlias: string;
  primary: string;
  secondary: string;
  big4: boolean;
};

export type AuthMeta = {
  mode: "supabase" | "mock";
  mockOtpCode: string | null;
  phoneOtp: string;
  googleEnabled: boolean;
  appleEnabled: boolean;
  oauthMode: "supabase" | "stub";
  supabaseUrl: string | null;
  supabaseAnonKeyConfigured: boolean;
  smsHook: { path: string; secretConfigured: boolean; netgsmDelivery: string };
};

/** Personal × team boost multipliers (shop / match-day). */
export type BoostSnapshot = {
  personalBoostPct: number;
  teamBoostPct: number;
  personalExpiresAt?: string | null;
  teamWindowEndsAt?: string | null;
};

export const DEFAULT_BOOST: BoostSnapshot = {
  personalBoostPct: 1,
  teamBoostPct: 1,
  personalExpiresAt: null,
  teamWindowEndsAt: null,
};

export function boostFromUser(user: PublicUser | null | undefined): BoostSnapshot {
  if (!user?.boost) return DEFAULT_BOOST;
  return {
    personalBoostPct: user.boost.personalBoostPct ?? 1,
    teamBoostPct: user.boost.teamBoostPct ?? 1,
    personalExpiresAt: user.boost.personalExpiresAt ?? null,
    teamWindowEndsAt: user.boost.teamWindowEndsAt ?? null,
  };
}

export function effectiveSupport(base: number, boost: BoostSnapshot = DEFAULT_BOOST): number {
  return Math.round(base * boost.personalBoostPct * boost.teamBoostPct * 1000) / 1000;
}

export type SeasonInfo = {
  id: string;
  label: string;
  startsAt: string;
  endsAt: string;
  endsAtLabelTr: string;
  timezone: string;
};

export type TeamScoreboardEntry = {
  rank: number;
  teamId: string;
  alias: string;
  color: string;
  citiesOwned: number;
};

export type PlayerScoreboardEntry = {
  rank: number;
  userId: string;
  handle: string;
  tribeId: string | null;
  tribeAlias: string | null;
  tribeColor: string | null;
  supportSpent: number;
};

export type TeamScoreboard = {
  season: SeasonInfo;
  metric: "cities_owned";
  guestBrowse: true;
  teams: TeamScoreboardEntry[];
};

export type PlayerScoreboard = {
  season: SeasonInfo;
  metric: "support_spent";
  guestBrowse: true;
  players: PlayerScoreboardEntry[];
  you: PlayerScoreboardEntry | null;
};

export type ScoreboardsPayload = {
  teams: TeamScoreboard;
  players: PlayerScoreboard;
  guestBrowse: true;
};

/** Active match-day window for map banner + spotlight chrome. */
export type MatchDayEvent = {
  id: string;
  teamId: string;
  teamAlias: string;
  teamColor: string | null;
  boostPct: number;
  spotlightPlate: string | null;
  cityNameTr: string | null;
  label: string | null;
  startsAt: string;
  endsAt: string;
};

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const body = data as { error?: string; messageTr?: string; message?: string };
    const err = new Error(body.messageTr || body.message || body.error || res.statusText);
    (err as Error & { status: number; data: unknown }).status = res.status;
    (err as Error & { status: number; data: unknown }).data = data;
    throw err;
  }
  return data as T;
}

export const api = {
  meta: () =>
    request<{
      actionCost: number;
      actionCostBand: { min: number; max: number; default: number };
      freeDailyGrant: number;
      subDailyBonus: number;
      auth: AuthMeta;
      shop: ShopCatalog & { subDailyBonus?: number };
      iap?: {
        provider: string;
        ios: boolean;
        android: boolean;
        webhookConfigured: boolean;
        stubEnabled: boolean;
      };
    }>("/v1/meta"),
  digest: () => request<{ cities: DigestCity[] }>("/v1/map/digest"),
  /** Combined Season 0 boards — no auth required (guest browse). */
  scoreboards: (token?: string | null) =>
    request<ScoreboardsPayload>("/v1/scoreboards", { token: token ?? null }),
  scoreboardTeams: () => request<TeamScoreboard>("/v1/scoreboards/teams"),
  scoreboardPlayers: (token?: string | null, limit = 50) =>
    request<PlayerScoreboard>(`/v1/scoreboards/players?limit=${limit}`, {
      token: token ?? null,
    }),
  /** Legacy team-only shape. */
  scoreboard: () =>
    request<{
      season: SeasonInfo;
      metric: "cities_owned";
      guestBrowse: true;
      teams: TeamScoreboardEntry[];
    }>("/v1/scoreboard"),
  city: (plate: string) => request<CitySheet>(`/v1/cities/${plate}`),
  teams: () =>
    request<{
      order: "big4_first";
      teams: Team[];
      big4: Team[];
      rest: Team[];
    }>("/v1/teams"),
  me: (token: string) => request<{ user: PublicUser }>("/v1/me", { token }),
  startPhone: (phone: string) =>
    request<{ ok: true; phoneE164: string; mock?: boolean; code?: string }>("/v1/auth/phone/start", {
      body: { phone },
    }),
  verifyPhone: (phone: string, code: string) =>
    request<{ token: string; user: PublicUser }>("/v1/auth/phone/verify", {
      body: { phone, code },
    }),
  /** Local stub only — when API auth.mode === mock. */
  oauthStub: (provider: "google" | "apple") =>
    request<{ token: string; user: PublicUser; needsPhone: boolean; stub: boolean }>(
      `/v1/auth/oauth/${provider}`,
      { method: "POST", body: {} },
    ),
  /** Exchange Supabase access_token for game User row. */
  exchangeSupabaseSession: (accessToken: string) =>
    request<{ token: string; user: PublicUser; needsPhone: boolean; mode: "supabase" }>(
      "/v1/auth/supabase/session",
      { method: "POST", token: accessToken, body: {} },
    ),
  bindPhone: (token: string, phone: string, code: string) =>
    request<{ user: PublicUser }>("/v1/auth/phone/bind", { token, body: { phone, code } }),
  pickTribe: (token: string, tribeId: string) =>
    request<{ user: PublicUser }>("/v1/tribe/pick", { token, body: { tribeId } }),
  claimEnergy: (token: string) =>
    request<{ granted: boolean; user: PublicUser }>("/v1/energy/claim", {
      token,
      method: "POST",
      body: {},
    }),
  grantSim: (token: string) =>
    request<{ granted: boolean; amount: number; user: PublicUser }>("/v1/energy/grant-sim", {
      token,
      method: "POST",
      body: {},
    }),
  /** Dev/ops: run TR midnight free + sub-bonus batch without waiting. */
  grantJob: (opts?: { force?: boolean }) =>
    request<{
      ok: true;
      job: {
        timezone: string;
        date: string;
        amount: number;
        freeAmount: number;
        subBonusAmount: number;
        scanned: number;
        granted: number;
        skippedAlreadyGranted: number;
        subBonusGranted: number;
        subBonusSkipped: number;
        force: boolean;
      };
    }>("/v1/energy/grant-job", {
      method: "POST",
      body: { force: opts?.force ?? false },
    }),
  /** Dev/ops: set subscription entitlement without payments. */
  subEntitle: (token: string, opts: { active: boolean; userId?: string }) =>
    request<{ ok: true; userId: string; subActive: boolean; user: PublicUser | null }>(
      "/v1/energy/sub-entitle",
      { token, method: "POST", body: opts },
    ),
  /** Payments stub — activates personal +50% / 1h without charging. */
  activatePersonalBoostStub: (token: string) =>
    request<{ ok: true; stub: true; boost: BoostSnapshot; user: PublicUser }>(
      "/v1/boosts/personal/stub",
      { token, method: "POST", body: {} },
    ),
  /** Dev/sim team +25% window for display path until admin match-day leaf. */
  simulateTeamBoost: (token: string) =>
    request<{ ok: true; simulated: true; boost: BoostSnapshot; user: PublicUser }>(
      "/v1/boosts/team/sim",
      { token, method: "POST", body: {} },
    ),
  /** Guest-readable active match-day events (banner + spotlight). */
  matchDayActive: () => request<{ events: MatchDayEvent[] }>("/v1/match-day/active"),
  /** Fixture stub: team +25% + spotlight city until Admin MatchDay ops. */
  matchDayFixtureStub: (
    token: string,
    body: { spotlightPlate?: string; label?: string | null; durationMs?: number } = {},
  ) =>
    request<{
      ok: true;
      stub: true;
      event: MatchDayEvent;
      boost: BoostSnapshot;
      user: PublicUser;
    }>("/v1/match-day/fixture-stub", { token, method: "POST", body }),

  iapSync: (
    token: string,
    body: {
      productId: string;
      transactionId: string;
      platform: "ios" | "android";
      environment?: string;
    },
  ) =>
    request<{
      ok: true;
      alreadyGranted: boolean;
      kind: string;
      energyGranted: number;
      subActive: boolean;
      grantId: string;
      user: PublicUser;
    }>("/v1/iap/sync", { token, method: "POST", body }),

  iapStub: (
    token: string,
    body: { productId: string; transactionId?: string; platform?: "ios" | "android" },
  ) =>
    request<{
      ok: true;
      alreadyGranted: boolean;
      kind: string;
      energyGranted: number;
      subActive: boolean;
      grantId: string;
      stub: true;
      user: PublicUser;
    }>("/v1/iap/stub", { token, method: "POST", body }),

  spend: (
    token: string,
    plate: string,
    opts: { confirmed: true; idempotencyKey: string; amount?: number },
  ) =>
    request<{
      flipped: boolean;
      sheet: CitySheet;
      digest: DigestCity[];
      user: PublicUser;
      boost?: BoostSnapshot;
      supportCredited?: number;
      energySpent?: number;
    }>(`/v1/cities/${plate}/spend`, { token, body: opts }),
tutorial: (token: string) =>
    request<{ tutorial: TutorialState; user: PublicUser }>("/v1/tutorial", { token }),
  skipTutorial: (token: string) =>
    request<{ skipped: true; user: PublicUser }>("/v1/tutorial/skip", {
      token,
      method: "POST",
      body: {},
    }),

  adminPromoteSim: (token: string) =>
    request<{ ok: true; simulated: true; user: PublicUser }>("/v1/admin/promote-sim", {
      token,
      method: "POST",
      body: {},
    }),

  adminListMatchDay: (
    token: string,
    opts: { includeCanceled?: boolean; kind?: "team_boost" | "derby_war" } = {},
  ) => {
    const q = new URLSearchParams();
    if (opts.includeCanceled) q.set("includeCanceled", "1");
    if (opts.kind) q.set("kind", opts.kind);
    const qs = q.toString();
    return request<{ windows: MatchDayWindow[] }>(
      `/v1/admin/match-day${qs ? `?${qs}` : ""}`,
      { token },
    );
  },

  adminScheduleTeamBoost: (
    token: string,
    body: {
      teamId: string;
      boostPct?: number;
      startsAt?: string;
      endsAt?: string;
      kickoffAt?: string;
      fullTimeAt?: string;
      notes?: string | null;
      label?: string | null;
    },
  ) =>
    request<{ window: MatchDayWindow }>("/v1/admin/match-day/team-boosts", {
      token,
      body,
    }),

  adminScheduleDerbyWar: (
    token: string,
    body: {
      teamId: string;
      spotlightPlate: string;
      boostPct?: number;
      startsAt?: string;
      endsAt?: string;
      kickoffAt?: string;
      fullTimeAt?: string;
      notes?: string | null;
      label?: string | null;
      involvedAliases?: string | null;
    },
  ) =>
    request<{ window: MatchDayWindow }>("/v1/admin/match-day/derby-wars", {
      token,
      body,
    }),

  adminCancelMatchDay: (token: string, id: string) =>
    request<{ window: MatchDayWindow }>(`/v1/admin/match-day/${id}/cancel`, {
      token,
      method: "POST",
      body: {},
    }),

  adminOtpStatus: (token: string) =>
    request<{ enrolled: boolean; phoneE164: string | null; purposes: string[] }>(
      "/v1/admin/otp/status",
      { token },
    ),

  adminOtpEnroll: (token: string, phone?: string) =>
    request<{ ok: true; phoneE164: string; enrolled: true }>("/v1/admin/otp/enroll", {
      token,
      body: phone ? { phone } : {},
    }),

  adminOtpChallenge: (token: string, purpose: string) =>
    request<{
      ok: true;
      challengeId: string;
      purpose: string;
      mock: boolean;
      code?: string;
      expiresAt: string;
    }>("/v1/admin/otp/challenge", { token, body: { purpose } }),

  adminEconomy: (token: string) =>
    request<{
      prices: {
        smallTry: number | null;
        mediumTry: number | null;
        largeTry: number | null;
        subTry: number | null;
        personalBoostTry: number | null;
      };
      freeDailyGrant: number;
      actionCost: number;
      season: {
        season0StartsAt: string;
        season0EndsAt: string;
        season1PrepStartsAt: string | null;
      };
    }>("/v1/admin/economy", { token }),

  adminUpdatePackPrices: (
    token: string,
    body: {
      otp: string;
      smallTry?: number | null;
      mediumTry?: number | null;
      largeTry?: number | null;
      subTry?: number | null;
      personalBoostTry?: number | null;
    },
  ) =>
    request<{ ok: true; prices: unknown }>("/v1/admin/economy/pack-prices", {
      token,
      body,
    }),

  adminUpdateTunables: (
    token: string,
    body: { otp: string; freeDailyGrant?: number; actionCost?: number },
  ) =>
    request<{ ok: true; freeDailyGrant: number; actionCost: number }>(
      "/v1/admin/economy/tunables",
      { token, body },
    ),

  adminUpdateSeason: (
    token: string,
    body: {
      otp: string;
      season0StartsAt?: string;
      season0EndsAt?: string;
      season1PrepStartsAt?: string | null;
    },
  ) =>
    request<{ ok: true; bounds: unknown }>("/v1/admin/season/bounds", {
      token,
      body,
    }),

  adminSeedStatus: (token: string) =>
    request<{
      teams: number;
      cities: number;
      supportRows: number;
      expectedTeams: number;
      expectedCities: number;
      confirmedAt: string | null;
      aliases: { internalId: string; publicAlias: string }[];
    }>("/v1/admin/seeds/status", { token }),

  adminSeedLoad: (token: string, body: { otp: string; resetSupport?: boolean }) =>
    request<{ ok: true; status: unknown }>("/v1/admin/seeds/load", { token, body }),

  submitTeamAddTicket: (token: string, requestedClub: string) =>
    request<{ ok: true; ticket: TeamAddTicket }>("/v1/tickets/team-add", {
      token,
      body: { requestedClub },
    }),

  adminListTickets: (token: string, status?: string) => {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<{ tickets: TeamAddTicket[] }>(`/v1/admin/tickets/team-add${q}`, {
      token,
    });
  },

  adminTriageTicket: (
    token: string,
    id: string,
    body: {
      action: "accept" | "reject" | "defer";
      adminNote?: string | null;
      publicAlias?: string;
      primaryColor?: string;
      secondaryColor?: string;
    },
  ) =>
    request<{ ok: true; ticket: TeamAddTicket }>(
      `/v1/admin/tickets/team-add/${id}/triage`,
      { token, body },
    ),

  adminMetrics: (token: string) =>
    request<{
      metrics: {
        dau: number;
        dauSparkline: { day: string; dau: number }[];
        flipsToday: number;
        flips7d: number;
        revenueTodayTry: number;
        revenueMtdTry: number;
        matchDay: {
          nextEvent: {
            id: string;
            kind: string;
            label: string | null;
            startsAt: string;
            endsAt: string;
          } | null;
          lastPeakConcurrent: number | null;
          lastPeakAt: string | null;
          currentConcurrent: number;
          inMatchWindow: boolean;
        };
        openTeamAddTickets: number;
        note: string;
      };
    }>("/v1/admin/metrics", { token }),,

  /** Logged-in only — mints a static support / accomplishment share card. */
  createShareCard: (
    token: string,
    body:
      | { kind: "support"; plate: string; cityName?: string; boosted?: boolean }
      | {
          kind: "accomplishment";
          variant: "took_city" | "cities_owned" | "held_city";
          plate?: string;
          cityName?: string;
          citiesOwned?: number;
          season?: string;
        },
  ) =>
    request<{ card: ShareCard }>(`/v1/share/cards`, { token, body }),
  getShareCard: (id: string) => request<ShareCard>(`/v1/share/${id}`),
};

export type TeamAddTicket = {
  id: string;
  userId: string;
  requesterHandle: string | null;
  requestedClub: string;
  status: "open" | "accepted" | "rejected" | "deferred";
  adminNote: string | null;
  createdPublicAlias: string | null;
  createdTeamId: string | null;
  triagedBy: string | null;
  triagedAt: string | null;
};

export type ShareCard = {
  id: string;
  kind: "support" | "accomplishment";
  title: string;
  description: string;
  lineTr: string;
  lineEn: string;
  brand: string;
  season: string | null;
  deepLink: string;
  sharePath: string;
  cardSvgPath: string;
  primaryColor: string;
  createdAt: string;
};
