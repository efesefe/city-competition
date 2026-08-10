import { postRegionSupport, type SupportResult } from "@/lib/api/support";

export const SUPPORT_CHIPS = [10, 50, 100, 250] as const;

export function clampCredits(amount: number, balance: number): number {
  if (!Number.isFinite(amount) || amount < 1) return 0;
  if (!Number.isFinite(balance) || balance < 1) return 0;
  return Math.min(Math.floor(amount), Math.floor(balance));
}

export function defaultChipAmount(balance: number): number {
  for (const chip of SUPPORT_CHIPS) {
    if (chip <= balance) return chip;
  }
  return balance >= 1 ? Math.min(SUPPORT_CHIPS[0], Math.floor(balance)) : 0;
}

export type OwnershipSegment = {
  tribe_id: string;
  committed_credits: number;
  share: number;
  color: string;
};

export function ownershipBarSegments(
  competing: Array<{ tribe_id: string; committed_credits: number }>,
  colorByTribe: Record<string, string>,
  neutralColor: string,
): OwnershipSegment[] {
  const total = competing.reduce((s, c) => s + Math.max(0, c.committed_credits), 0);
  if (total <= 0) {
    return [];
  }
  return competing
    .filter((c) => c.committed_credits > 0)
    .map((c) => ({
      tribe_id: c.tribe_id,
      committed_credits: c.committed_credits,
      share: c.committed_credits / total,
      color: colorByTribe[c.tribe_id] ?? neutralColor,
    }));
}

export type SupportSubmitDeps = {
  postSupport?: typeof postRegionSupport;
  applyOptimisticDelta: (delta: number) => void;
  reconcileBalance: (balance: number) => void;
  applySupportDelta: (ilCode: string, tribeId: string, delta: number) => void;
  registerPendingSupport: (
    ilCode: string,
    tribeId: string,
    delta: number,
  ) => void;
  /** Clear pending WS dedupe key on failed spend (same signature as register). */
  consumePendingSupport: (
    ilCode: string,
    tribeId: string,
    delta: number,
  ) => boolean;
  fetchWalletBalance?: () => Promise<{ balance: number }>;
};

/** True when an active derby covers this province and the user's tribe. */
export function isDerbiBonusActive(
  derbies: Array<{
    status: string;
    il_code: string;
    host_tribe_id: string;
    guest_tribe_id: string;
  }>,
  ilCode: string,
  tribeId: string,
): boolean {
  return derbies.some(
    (d) =>
      d.status === "active" &&
      d.il_code === ilCode &&
      (d.host_tribe_id === tribeId || d.guest_tribe_id === tribeId),
  );
}

export function mapSupportErrorKey(code: string): string {
  const known = new Set([
    "insufficient_credits",
    "unknown_region",
    "tribe_required",
    "rate_limit_exceeded",
    "write_path_degraded",
    "invalid_credits",
    "error_unauthorized",
    "error_banned",
    "idempotency_conflict",
  ]);
  return known.has(code) ? code : "error_internal";
}

export type SupportSubmitInput = {
  ilCode: string;
  tribeId: string;
  credits: number;
  derbiActive: boolean;
};

export type SupportSubmitOutcome =
  | { ok: true; result: SupportResult }
  | { ok: false; code: string };

/**
 * Optimistic wallet + city-bar update, then region support POST.
 * On success registers a pending WS dedupe key. On failure rolls both back.
 */
export async function submitSupportOptimistic(
  input: SupportSubmitInput,
  deps: SupportSubmitDeps,
): Promise<SupportSubmitOutcome> {
  const amount = Math.floor(input.credits);
  if (amount <= 0) {
    return { ok: false, code: "invalid_credits" };
  }
  const expectedDelta = input.derbiActive ? amount * 2 : amount;
  const post = deps.postSupport ?? postRegionSupport;

  deps.applyOptimisticDelta(-amount);
  deps.applySupportDelta(input.ilCode, input.tribeId, expectedDelta);
  deps.registerPendingSupport(input.ilCode, input.tribeId, expectedDelta);

  try {
    const result = await post(input.ilCode, amount);
    deps.reconcileBalance(result.balance_after);
    return { ok: true, result };
  } catch (err) {
    deps.applySupportDelta(input.ilCode, input.tribeId, -expectedDelta);
    deps.consumePendingSupport(input.ilCode, input.tribeId, expectedDelta);
    try {
      if (deps.fetchWalletBalance) {
        const { balance } = await deps.fetchWalletBalance();
        deps.reconcileBalance(balance);
      } else {
        deps.applyOptimisticDelta(amount);
      }
    } catch {
      deps.applyOptimisticDelta(amount);
    }
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code)
        : err instanceof Error
          ? err.message
          : "error_internal";
    return { ok: false, code: mapSupportErrorKey(code || "error_internal") };
  }
}
