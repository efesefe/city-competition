/**
 * Turkish-style date/time formatting (DD.MM.YYYY, 24h), always via tr-TR.
 * Independent of UI locale (en vs tr chrome).
 */

const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Istanbul",
});

const timeFormatter = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/Istanbul",
});

function asDate(input: Date | string | number): Date {
  return input instanceof Date ? input : new Date(input);
}

/** DD.MM.YYYY in Europe/Istanbul. */
export function formatDate(input: Date | string | number): string {
  return dateFormatter.format(asDate(input));
}

/** HH:mm (24h) in Europe/Istanbul. */
export function formatTime(input: Date | string | number): string {
  return timeFormatter.format(asDate(input));
}

/** DD.MM.YYYY HH:mm */
export function formatDateTime(input: Date | string | number): string {
  const d = asDate(input);
  return `${formatDate(d)} ${formatTime(d)}`;
}
