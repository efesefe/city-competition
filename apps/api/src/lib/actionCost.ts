/**
 * Season 0 attack/support action cost — admin-tunable within a locked band.
 * Product default is mid-band (15). See docs/action-cost-tunable.md.
 */

export const ACTION_COST_MIN = 10;
export const ACTION_COST_MAX = 20;
export const ACTION_COST_DEFAULT = 15; // mid-band

export type ActionCostBand = {
  min: typeof ACTION_COST_MIN;
  max: typeof ACTION_COST_MAX;
  default: typeof ACTION_COST_DEFAULT;
};

export const ACTION_COST_BAND: ActionCostBand = {
  min: ACTION_COST_MIN,
  max: ACTION_COST_MAX,
  default: ACTION_COST_DEFAULT,
};

export type ActionCostParseOk = { ok: true; value: number };
export type ActionCostParseErr = {
  ok: false;
  error: "not_integer" | "out_of_band";
  min: number;
  max: number;
};
export type ActionCostParseResult = ActionCostParseOk | ActionCostParseErr;

/** Parse and validate an admin/client-supplied action cost. */
export function parseActionCost(raw: unknown): ActionCostParseResult {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return {
      ok: false,
      error: "not_integer",
      min: ACTION_COST_MIN,
      max: ACTION_COST_MAX,
    };
  }
  if (n < ACTION_COST_MIN || n > ACTION_COST_MAX) {
    return {
      ok: false,
      error: "out_of_band",
      min: ACTION_COST_MIN,
      max: ACTION_COST_MAX,
    };
  }
  return { ok: true, value: n };
}

/**
 * Coerce a stored tunable to a safe in-band integer.
 * Corrupt / out-of-band DB values fall back to mid-band default.
 */
export function coerceActionCost(raw: unknown): number {
  const parsed = parseActionCost(
    typeof raw === "string" || typeof raw === "number" ? Number(raw) : raw,
  );
  return parsed.ok ? parsed.value : ACTION_COST_DEFAULT;
}

/**
 * Admin write gate for tunables (Season 0 API key — phone OTP console is a later Admin leaf).
 * Header: `x-admin-key: <ADMIN_API_KEY>`
 */
export function adminApiKeyConfigured(): boolean {
  return Boolean(process.env.ADMIN_API_KEY?.trim());
}

export function adminKeyAuthorized(headerValue: string | string[] | undefined): boolean {
  const expected = process.env.ADMIN_API_KEY?.trim();
  if (!expected) return false;
  const got = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return Boolean(got && got === expected);
}
