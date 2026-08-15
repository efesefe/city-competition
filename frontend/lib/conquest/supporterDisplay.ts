import { API_BASE } from "@/lib/auth-api";
import type { ConquestSupporter } from "@/lib/conquest-api";

/** Compact fetch size for toast and city-sheet surfaces. */
export const COMPACT_SUPPORTER_LIMIT = 5;

/**
 * Preserve backend rank: 1-based index in the given array.
 * Do not sort — attributed contribution order is authoritative.
 */
export function rankedSupporters<T>(supporters: readonly T[]): Array<{
  rank: number;
  supporter: T;
}> {
  return supporters.map((supporter, i) => ({ rank: i + 1, supporter }));
}

export function moreCount(total: number, returned: number): number {
  const t = Number.isFinite(total) ? Math.floor(total) : 0;
  const n = Number.isFinite(returned) ? Math.floor(returned) : 0;
  return Math.max(0, t - n);
}

/**
 * 1–2 Turkish-uppercased letters from a display name (mirrors backend
 * user.Initials). Never empty — "?" when there are no letters.
 */
export function supporterInitials(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) {
    return "?";
  }
  const runes = Array.from(trimmed);
  const want = runes.length === 1 ? 1 : 2;
  const out: string[] = [];
  for (const r of runes) {
    if (/\s/u.test(r)) {
      continue;
    }
    out.push(r);
    if (out.length === want) {
      break;
    }
  }
  if (out.length === 0) {
    return "?";
  }
  return out.join("").toLocaleUpperCase("tr-TR");
}

/** Prefix relative avatar paths with API_BASE; pass through absolute/data URLs. */
export function resolveAvatarSrc(avatarUrl: string): string {
  const raw = avatarUrl.trim();
  if (!raw) {
    return "";
  }
  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) {
    return raw;
  }
  const base = API_BASE.replace(/\/$/, "");
  return raw.startsWith("/") ? `${base}${raw}` : `${base}/${raw}`;
}

/** Stable disc hue from a UUID string, matching backend user.HueFromUserID. */
export function hueFromUserId(userId: string): number {
  const hex = userId.replace(/-/g, "");
  if (hex.length < 8) {
    return 200;
  }
  const n = Number.parseInt(hex.slice(0, 8), 16);
  if (!Number.isFinite(n)) {
    return 200;
  }
  return n % 360;
}

export function rankVisualWeight(rank: number): number {
  if (rank <= 1) {
    return 1;
  }
  return Math.max(0.42, 1 - (rank - 1) * 0.08);
}

export function supporterRowKey(row: Pick<ConquestSupporter, "user_id">, rank: number): string {
  return `${row.user_id}:${rank}`;
}
