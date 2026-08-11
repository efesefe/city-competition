import type { SupportHistoryItem } from "@/lib/support-api";

/** Append page items by id; never duplicates across pagination. */
export function mergeSupportHistoryPages(
  existing: SupportHistoryItem[],
  incoming: SupportHistoryItem[],
): SupportHistoryItem[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((row) => row.id));
  const merged = existing.slice();
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}
