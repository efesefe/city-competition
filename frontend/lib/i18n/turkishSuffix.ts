const TURKISH_VOWELS = new Set(["a", "e", "ı", "i", "o", "ö", "u", "ü"]);
const FRONT_VOWELS = new Set(["e", "i", "ö", "ü"]);
const VOICELESS_CONSONANTS = new Set(["p", "ç", "t", "k", "f", "h", "s", "ş"]);

function lastVowel(runes: string[]): string | null {
  for (let i = runes.length - 1; i >= 0; i -= 1) {
    if (TURKISH_VOWELS.has(runes[i])) {
      return runes[i];
    }
  }
  return null;
}

function lastConsonantVoiceless(runes: string[]): boolean {
  if (runes.length === 0) {
    return false;
  }
  const r = runes[runes.length - 1];
  if (TURKISH_VOWELS.has(r) || !/^\p{L}$/u.test(r)) {
    return false;
  }
  return VOICELESS_CONSONANTS.has(r);
}

/**
 * Proper-noun apostrophe + vowel-harmony locative (-de/-da/-te/-ta).
 * Mirrors backend i18n.Locative. Unclassifiable names get "'da".
 */
export function locative(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") {
    return `${name}'da`;
  }

  const lower = trimmed.toLocaleLowerCase("tr-TR");
  const runes = Array.from(lower);
  const vowel = lastVowel(runes);
  if (!vowel) {
    return `${trimmed}'da`;
  }

  const front = FRONT_VOWELS.has(vowel);
  const voiceless = lastConsonantVoiceless(runes);
  let suffix: string;
  if (front && voiceless) {
    suffix = "te";
  } else if (front && !voiceless) {
    suffix = "de";
  } else if (!front && voiceless) {
    suffix = "ta";
  } else {
    suffix = "da";
  }

  return `${trimmed}'${suffix}`;
}
