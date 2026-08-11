/**
 * Turkish mobile national digits only (10 digits, typically starting with 5).
 * Strips country code / leading 0 if the user pastes a fuller number.
 */
export function extractTRNationalDigits(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("90") && digits.length > 10) {
    digits = digits.slice(2);
  }
  if (digits.startsWith("0") && digits.length >= 11) {
    digits = digits.slice(1);
  }
  return digits.slice(0, 10);
}

/**
 * Format national TR mobile as the user types: 5xx xxx xx xx
 */
export function formatTRNationalPhone(input: string): string {
  const d = extractTRNationalDigits(input);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)} ${d.slice(3)}`;
  if (d.length <= 8) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
}

/** Build E.164 from national digits or a formatted national string. */
export function nationalToE164TR(national: string): string | null {
  const d = extractTRNationalDigits(national);
  if (d.length !== 10) return null;
  return `+90${d}`;
}
