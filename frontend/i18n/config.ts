export const locales = ["tr", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "tr";

/** Cookie name used by middleware + LocaleToggle (no path prefix). */
export const localeCookieName = "NEXT_LOCALE";

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "tr" || value === "en";
}
