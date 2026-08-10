/**
 * Turkish case-folding for search/sort (mirrors backend user.FoldUsername
 * via language.Turkish lowercasing), then maps dotless ı → i so typed queries
 * like "ISTANBUL" still match city names that fold to "istanbul".
 */
export function foldTurkish(value: string): string {
  return value.toLocaleLowerCase("tr-TR").replaceAll("ı", "i");
}

export function compareTurkish(a: string, b: string): number {
  return a.localeCompare(b, "tr", { sensitivity: "base" });
}

/** True when folded query is a substring of folded haystack (or equals id). */
export function matchesTurkishSearch(
  query: string,
  haystack: string,
  id?: string,
): boolean {
  const q = foldTurkish(query.trim());
  if (!q) return true;
  if (foldTurkish(haystack).includes(q)) return true;
  if (id && foldTurkish(id).includes(q)) return true;
  return false;
}
