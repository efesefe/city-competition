import { locative } from "@/lib/i18n/turkishSuffix";

/**
 * City label for ticker ICU `{place}`. Turkish uses the established locative
 * helper; other locales keep the bare city name.
 */
export function activityPlaceLabel(cityName: string, locale: string): string {
  const trimmed = cityName.trim();
  if (!trimmed) {
    return cityName;
  }
  if (locale === "tr" || locale.startsWith("tr-")) {
    return locative(trimmed);
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
