import type { Tribe } from "@/lib/tribes-api";

/** Neutral gray for unclaimed / unknown tribe surfaces (never a tribe color). */
export const NEUTRAL_TRIBE_COLOR = "#6b7280";

/** Shell / tab-bar background used for active-tab contrast checks. */
export const SHELL_DARK_BG = "#0c1418";

/**
 * Letter fallback when a tribe has no mascot emblem (unknown slug,
 * admin-created tribes). Seeded parody tribes use `tribeEmblem` silhouettes.
 */
export function tribeCrestInitial(tribe: Pick<Tribe, "short_name" | "display_name" | "slug">): string {
  const short = tribe.short_name?.trim();
  if (short) {
    return short.slice(0, 3).toUpperCase();
  }
  const name = tribe.display_name?.trim() || tribe.slug;
  return name.slice(0, 2).toUpperCase();
}

function parseHexColor(color: string): [number, number, number] | null {
  const trimmed = color.trim();
  const m6 = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
  if (m6) {
    const n = parseInt(m6[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  const m3 = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (m3) {
    const [r, g, b] = m3[1].split("").map((c) => parseInt(c + c, 16));
    return [r, g, b];
  }
  return null;
}

/** Relative luminance (sRGB), 0–1. */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHexColor(hex);
  if (!rgb) {
    return null;
  }
  const [rs, gs, bs] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** WCAG contrast ratio between two hex colors (higher is better). */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la == null || lb == null) {
    return null;
  }
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function isValidHex(color: string | null | undefined): color is string {
  return !!color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color.trim());
}

function lightenHex(hex: string, amount = 0.45): string {
  const rgb = parseHexColor(hex);
  if (!rgb) {
    return NEUTRAL_TRIBE_COLOR;
  }
  const [r, g, b] = rgb.map((c) =>
    Math.round(c + (255 - c) * amount),
  ) as [number, number, number];
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function tribeAccentColor(
  tribe: Pick<Tribe, "primary_color"> | null | undefined,
): string {
  const color = tribe?.primary_color?.trim();
  return isValidHex(color) ? color.trim() : NEUTRAL_TRIBE_COLOR;
}

/**
 * Accent safe to use as text/icon color on the dark shell / tab bar.
 * Prefers primary when contrast is adequate; otherwise secondary, then a lightened primary.
 */
export function tribeAccentOnDark(
  tribe:
    | Pick<Tribe, "primary_color" | "secondary_color">
    | null
    | undefined,
  bg: string = SHELL_DARK_BG,
): string {
  const primary = tribe?.primary_color?.trim();
  const secondary = tribe?.secondary_color?.trim();
  const minRatio = 3;

  if (isValidHex(primary)) {
    const p = primary.trim();
    const ratio = contrastRatio(p, bg);
    if (ratio != null && ratio >= minRatio) {
      return p;
    }
  }

  if (isValidHex(secondary)) {
    const s = secondary.trim();
    const ratio = contrastRatio(s, bg);
    if (ratio != null && ratio >= minRatio) {
      return s;
    }
  }

  if (isValidHex(primary)) {
    return lightenHex(primary.trim());
  }

  return NEUTRAL_TRIBE_COLOR;
}
