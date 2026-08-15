import type { ActivityKind } from "@/lib/activity-feed-api";
import { accusative, locative } from "@/lib/i18n/turkishSuffix";

/**
 * City label for ticker ICU `{place}`. Turkish conquest uses accusative
 * (İstanbul'u fethetti); support events use locative (İzmir'de destek verdi).
 * Other locales keep the bare city name.
 */
export function activityPlaceLabel(
  cityName: string,
  locale: string,
  kind: ActivityKind = "large_support",
): string {
  const trimmed = cityName.trim();
  if (!trimmed) {
    return cityName;
  }
  if (locale === "tr" || locale.startsWith("tr-")) {
    return kind === "conquest" ? accusative(trimmed) : locative(trimmed);
  }
  return trimmed;
}

export function activityTribeLabel(
  tribe:
    | { short_name?: string | null; display_name?: string | null }
    | null
    | undefined,
  fallback = "",
): string {
  const shortName = tribe?.short_name?.trim();
  if (shortName) {
    return shortName;
  }
  const display = tribe?.display_name?.trim();
  if (display) {
    return display;
  }
  return fallback;
}
