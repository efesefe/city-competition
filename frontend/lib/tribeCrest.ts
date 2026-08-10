import type { Tribe } from "@/lib/tribes-api";

/** Neutral gray for unclaimed / unknown tribe surfaces (never a tribe color). */
export const NEUTRAL_TRIBE_COLOR = "#6b7280";

/**
 * Crest placeholder: colored monogram from tribe short_name / display_name.
 * Backend has no crest_asset_url yet — CSS discs are enough for Track A.
 */
export function tribeCrestInitial(tribe: Pick<Tribe, "short_name" | "display_name" | "slug">): string {
  const short = tribe.short_name?.trim();
  if (short) {
    return short.slice(0, 3).toUpperCase();
  }
  const name = tribe.display_name?.trim() || tribe.slug;
  return name.slice(0, 2).toUpperCase();
}

export function tribeAccentColor(
  tribe: Pick<Tribe, "primary_color"> | null | undefined,
): string {
  const color = tribe?.primary_color?.trim();
  return color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)
    ? color
    : NEUTRAL_TRIBE_COLOR;
}
