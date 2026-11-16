import { nanoid } from "nanoid";
import { TEAM_BY_ID } from "../data/teams.js";
import { many, one, type Queryable } from "./db.js";

export const ShareKindSupport = "support" as const;
export const ShareKindAccomplishment = "accomplishment" as const;

export type ShareKind = typeof ShareKindSupport | typeof ShareKindAccomplishment;

export type AccomplishmentVariant = "took_city" | "cities_owned" | "held_city";

export type SupportPayload = {
  plate: string;
  cityName: string;
  alias: string;
  primaryColor?: string;
  boosted?: boolean;
};

export type AccomplishmentPayload = {
  variant: AccomplishmentVariant;
  alias: string;
  primaryColor?: string;
  plate?: string;
  cityName?: string;
  citiesOwned?: number;
  season?: string;
};

export type ShareCardRow = {
  id: string;
  userId: string;
  kind: ShareKind;
  payload: SupportPayload | AccomplishmentPayload;
  createdAt: string;
};

export type SharePublicView = {
  id: string;
  kind: ShareKind;
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
  payload: SupportPayload | AccomplishmentPayload;
  createdAt: string;
};

const BRAND = "City Competition";
const SEASON_DEFAULT = "0";

export function sharePublicBase(): string {
  const raw = process.env.PUBLIC_WEB_URL?.trim() || process.env.APP_PUBLIC_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  return "";
}

export function renderShareCopy(opts: {
  kind: ShareKind;
  payload: SupportPayload | AccomplishmentPayload;
}): { title: string; description: string; lineTr: string; lineEn: string; season: string | null } {
  if (opts.kind === ShareKindSupport) {
    const p = opts.payload as SupportPayload;
    const city = p.cityName.trim() || "Şehir";
    const alias = p.alias.trim() || "Kabile";
    const boosted = p.boosted ? " (boosted support)" : "";
    const boostedTr = p.boosted ? " (güçlendirilmiş destek)" : "";
    return {
      title: BRAND,
      description: `${alias} supported ${city}.${boosted}`,
      lineTr: `${alias} ${city} için destek verdi.${boostedTr}`,
      lineEn: `${alias} supported ${city}.${boosted}`,
      season: null,
    };
  }

  const p = opts.payload as AccomplishmentPayload;
  const alias = p.alias.trim() || "Kabile";
  const season = p.season?.trim() || SEASON_DEFAULT;
  if (p.variant === "cities_owned") {
    const n = Math.max(0, Number(p.citiesOwned ?? 0));
    return {
      title: BRAND,
      description: `${alias} — ${n} cities owned. Season ${season}.`,
      lineTr: `${alias} — ${n} şehir. Sezon ${season}.`,
      lineEn: `${alias} — ${n} cities owned. Season ${season}.`,
      season,
    };
  }
  if (p.variant === "held_city") {
    const city = (p.cityName ?? "").trim() || "Şehir";
    return {
      title: BRAND,
      description: `${alias} held ${city} in the war. Season ${season}.`,
      lineTr: `${alias} savaşta ${city}'ı tuttu. Sezon ${season}.`,
      lineEn: `${alias} held ${city} in the war. Season ${season}.`,
      season,
    };
  }
  // took_city
  const city = (p.cityName ?? "").trim() || "Şehir";
  return {
    title: BRAND,
    description: `${alias} took ${city}. Season ${season}.`,
    lineTr: `${alias} ${city}'ı aldı. Sezon ${season}.`,
    lineEn: `${alias} took ${city}. Season ${season}.`,
    season,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Static SVG share card (OG-sized). Brand is hero-level. */
export function renderShareSvg(view: SharePublicView): string {
  const accent = view.primaryColor || "#c8a96b";
  const seasonLine = view.season ? `Sezon ${escapeXml(view.season)}` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1f17"/>
      <stop offset="55%" stop-color="#13261d"/>
      <stop offset="100%" stop-color="#1a3328"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="18" height="630" fill="${escapeXml(accent)}"/>
  <text x="72" y="140" fill="#f4e7c5" font-size="64" font-family="Georgia, 'Times New Roman', serif" font-weight="700">${escapeXml(view.title)}</text>
  <text x="72" y="250" fill="${escapeXml(accent)}" font-size="40" font-family="Georgia, 'Times New Roman', serif">${escapeXml(view.lineTr)}</text>
  <text x="72" y="320" fill="#9bb0a3" font-size="28" font-family="system-ui, sans-serif">${escapeXml(view.lineEn)}</text>
  ${seasonLine ? `<text x="72" y="560" fill="#6b7c72" font-size="24" font-family="system-ui, sans-serif">${seasonLine}</text>` : `<text x="72" y="560" fill="#6b7c72" font-size="24" font-family="system-ui, sans-serif">citycompetition.app</text>`}
</svg>`;
}

export function toPublicView(row: ShareCardRow): SharePublicView {
  const copy = renderShareCopy({ kind: row.kind, payload: row.payload });
  const primaryColor =
    ("primaryColor" in row.payload && row.payload.primaryColor) || "#c8a96b";
  const plate =
    "plate" in row.payload && typeof row.payload.plate === "string" ? row.payload.plate : "";
  const deepLink = plate ? `/map?il=${plate}` : "/map";
  return {
    id: row.id,
    kind: row.kind,
    title: copy.title,
    description: copy.description,
    lineTr: copy.lineTr,
    lineEn: copy.lineEn,
    brand: BRAND,
    season: copy.season,
    deepLink,
    sharePath: `/share/${row.id}`,
    cardSvgPath: `/v1/share/${row.id}/card.svg`,
    primaryColor,
    payload: row.payload,
    createdAt: row.createdAt,
  };
}

export async function createShareCard(
  db: Queryable,
  input: {
    userId: string;
    kind: ShareKind;
    payload: SupportPayload | AccomplishmentPayload;
  },
): Promise<ShareCardRow> {
  const id = nanoid(12);
  const row = await one<{
    id: string;
    user_id: string;
    kind: string;
    payload: SupportPayload | AccomplishmentPayload;
    created_at: Date;
  }>(
    db,
    `INSERT INTO share_cards (id, user_id, kind, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, user_id, kind, payload, created_at`,
    [id, input.userId, input.kind, JSON.stringify(input.payload)],
  );
  if (!row) throw new Error("share_insert_failed");
  return mapRow(row);
}

export async function getShareCard(db: Queryable, id: string): Promise<ShareCardRow | null> {
  const row = await one<{
    id: string;
    user_id: string;
    kind: string;
    payload: SupportPayload | AccomplishmentPayload;
    created_at: Date;
  }>(
    db,
    `SELECT id, user_id, kind, payload, created_at FROM share_cards WHERE id = $1`,
    [id],
  );
  return row ? mapRow(row) : null;
}

export async function listMyShareCards(
  db: Queryable,
  userId: string,
  limit = 20,
): Promise<ShareCardRow[]> {
  const capped = Math.min(Math.max(limit, 1), 50);
  const rows = await many<{
    id: string;
    user_id: string;
    kind: string;
    payload: SupportPayload | AccomplishmentPayload;
    created_at: Date;
  }>(
    db,
    `SELECT id, user_id, kind, payload, created_at
     FROM share_cards
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, capped],
  );
  return rows.map(mapRow);
}

function mapRow(row: {
  id: string;
  user_id: string;
  kind: string;
  payload: SupportPayload | AccomplishmentPayload;
  created_at: Date;
}): ShareCardRow {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind as ShareKind,
    payload: row.payload ?? ({} as SupportPayload),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Build support payload from spender tribe + city (logged-in only). */
export function supportPayloadFrom(opts: {
  plate: string;
  cityName: string;
  tribeId: string;
  boosted?: boolean;
}): SupportPayload {
  const team = TEAM_BY_ID.get(opts.tribeId);
  return {
    plate: opts.plate,
    cityName: opts.cityName,
    alias: team?.publicAlias ?? opts.tribeId,
    primaryColor: team?.primary,
    boosted: opts.boosted === true,
  };
}

export function accomplishmentPayloadFrom(opts: {
  variant: AccomplishmentVariant;
  tribeId: string;
  plate?: string;
  cityName?: string;
  citiesOwned?: number;
  season?: string;
}): AccomplishmentPayload {
  const team = TEAM_BY_ID.get(opts.tribeId);
  return {
    variant: opts.variant,
    alias: team?.publicAlias ?? opts.tribeId,
    primaryColor: team?.primary,
    plate: opts.plate,
    cityName: opts.cityName,
    citiesOwned: opts.citiesOwned,
    season: opts.season ?? SEASON_DEFAULT,
  };
}
