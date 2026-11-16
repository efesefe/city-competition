import { nanoid } from "nanoid";
import { one, withTransaction, type Db, type Queryable } from "./db.js";

export type EntitlementChannel = "app_store" | "play_store" | "web";
export type EntitlementProvider = "revenuecat" | "iyzico";
export type EntitlementKind = "pack" | "subscription";

export type ApplyEntitlementInput = {
  userId: string;
  channel: EntitlementChannel;
  provider: EntitlementProvider;
  productId: string;
  kind: EntitlementKind;
  energyGranted: number;
  /** Idempotency key from store txn / iyzico payment id. */
  providerTransactionId: string;
  providerEventId?: string | null;
  checkoutId?: string | null;
  environment?: string | null;
  /** When true, mark sub inactive (expiration / unsubscribe). */
  deactivateSub?: boolean;
};

export type ApplyEntitlementResult =
  | {
      ok: true;
      alreadyGranted: boolean;
      kind: EntitlementKind;
      energyGranted: number;
      subActive: boolean;
      paidEnergy: number;
      grantId: string;
    }
  | { ok: false; reason: "user_not_found" | "invalid_transaction" };

/**
 * Single cross-platform entitlement apply.
 * Store (RevenueCat) and iyzico both credit the same users.paid_energy / users.sub_active.
 */
export async function applyEntitlementGrant(
  db: Db | Queryable,
  input: ApplyEntitlementInput,
): Promise<ApplyEntitlementResult> {
  const providerTransactionId = input.providerTransactionId.trim();
  if (!providerTransactionId) return { ok: false, reason: "invalid_transaction" };

  const user = await one<{ id: string; paid_energy: number; sub_active: boolean }>(
    db,
    `SELECT id, paid_energy, COALESCE(sub_active, FALSE) AS sub_active FROM users WHERE id = $1`,
    [input.userId],
  );
  if (!user) return { ok: false, reason: "user_not_found" };

  if (input.deactivateSub) {
    return deactivateSubscription(db, input, providerTransactionId);
  }

  if ("connect" in db && typeof (db as Db).connect === "function") {
    return withTransaction(db as Db, (client) =>
      applyOnTx(client, { ...input, providerTransactionId }),
    );
  }
  return applyOnTx(db, { ...input, providerTransactionId });
}

async function deactivateSubscription(
  db: Queryable,
  input: ApplyEntitlementInput,
  providerTransactionId: string,
): Promise<ApplyEntitlementResult> {
  const existing = await one<{ id: string; energy_granted: number }>(
    db,
    `SELECT id, energy_granted FROM entitlement_grants
     WHERE provider = $1 AND provider_transaction_id = $2`,
    [input.provider, providerTransactionId],
  );
  if (existing) {
    await db.query(`UPDATE users SET sub_active = FALSE WHERE id = $1`, [input.userId]);
    const paid = await one<{ paid_energy: number }>(
      db,
      `SELECT paid_energy FROM users WHERE id = $1`,
      [input.userId],
    );
    return {
      ok: true,
      alreadyGranted: true,
      kind: "subscription",
      energyGranted: Number(existing.energy_granted),
      subActive: false,
      paidEnergy: Number(paid?.paid_energy ?? 0),
      grantId: existing.id,
    };
  }

  const grantId = nanoid();
  const createdAt = new Date().toISOString();
  await db.query(
    `INSERT INTO entitlement_grants (
       id, user_id, channel, provider, product_id, kind, energy_granted,
       provider_event_id, provider_transaction_id, checkout_id, environment, created_at
     ) VALUES ($1,$2,$3,$4,$5,'subscription',0,$6,$7,$8,$9,$10)
     ON CONFLICT (provider, provider_transaction_id) DO NOTHING`,
    [
      grantId,
      input.userId,
      input.channel,
      input.provider,
      input.productId,
      input.providerEventId ?? null,
      providerTransactionId,
      input.checkoutId ?? null,
      input.environment ?? null,
      createdAt,
    ],
  );
  await db.query(`UPDATE users SET sub_active = FALSE WHERE id = $1`, [input.userId]);
  const paid = await one<{ paid_energy: number }>(
    db,
    `SELECT paid_energy FROM users WHERE id = $1`,
    [input.userId],
  );
  return {
    ok: true,
    alreadyGranted: false,
    kind: "subscription",
    energyGranted: 0,
    subActive: false,
    paidEnergy: Number(paid?.paid_energy ?? 0),
    grantId,
  };
}

async function applyOnTx(
  db: Queryable,
  input: ApplyEntitlementInput & { providerTransactionId: string },
): Promise<ApplyEntitlementResult> {
  const existing = await one<{
    id: string;
    energy_granted: number;
    kind: string;
  }>(
    db,
    `SELECT id, energy_granted, kind FROM entitlement_grants
     WHERE provider = $1 AND provider_transaction_id = $2`,
    [input.provider, input.providerTransactionId],
  );
  if (existing) {
    const bal = await one<{ sub_active: boolean; paid_energy: number }>(
      db,
      `SELECT COALESCE(sub_active, FALSE) AS sub_active, paid_energy FROM users WHERE id = $1`,
      [input.userId],
    );
    return {
      ok: true,
      alreadyGranted: true,
      kind: existing.kind as EntitlementKind,
      energyGranted: Number(existing.energy_granted),
      subActive: Boolean(bal?.sub_active),
      paidEnergy: Number(bal?.paid_energy ?? 0),
      grantId: existing.id,
    };
  }

  if (input.providerEventId) {
    const byEvent = await one<{ id: string; energy_granted: number; kind: string }>(
      db,
      `SELECT id, energy_granted, kind FROM entitlement_grants
       WHERE provider = $1 AND provider_event_id = $2`,
      [input.provider, input.providerEventId],
    );
    if (byEvent) {
      const bal = await one<{ sub_active: boolean; paid_energy: number }>(
        db,
        `SELECT COALESCE(sub_active, FALSE) AS sub_active, paid_energy FROM users WHERE id = $1`,
        [input.userId],
      );
      return {
        ok: true,
        alreadyGranted: true,
        kind: byEvent.kind as EntitlementKind,
        energyGranted: Number(byEvent.energy_granted),
        subActive: Boolean(bal?.sub_active),
        paidEnergy: Number(bal?.paid_energy ?? 0),
        grantId: byEvent.id,
      };
    }
  }

  const grantId = nanoid();
  const createdAt = new Date().toISOString();
  const inserted = await one<{ id: string }>(
    db,
    `INSERT INTO entitlement_grants (
       id, user_id, channel, provider, product_id, kind, energy_granted,
       provider_event_id, provider_transaction_id, checkout_id, environment, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (provider, provider_transaction_id) DO NOTHING
     RETURNING id`,
    [
      grantId,
      input.userId,
      input.channel,
      input.provider,
      input.productId,
      input.kind,
      input.energyGranted,
      input.providerEventId ?? null,
      input.providerTransactionId,
      input.checkoutId ?? null,
      input.environment ?? null,
      createdAt,
    ],
  );

  if (!inserted) {
    const raced = await one<{ id: string; energy_granted: number; kind: string }>(
      db,
      `SELECT id, energy_granted, kind FROM entitlement_grants
       WHERE provider = $1 AND provider_transaction_id = $2`,
      [input.provider, input.providerTransactionId],
    );
    const bal = await one<{ sub_active: boolean; paid_energy: number }>(
      db,
      `SELECT COALESCE(sub_active, FALSE) AS sub_active, paid_energy FROM users WHERE id = $1`,
      [input.userId],
    );
    return {
      ok: true,
      alreadyGranted: true,
      kind: (raced?.kind as EntitlementKind) ?? input.kind,
      energyGranted: Number(raced?.energy_granted ?? input.energyGranted),
      subActive: Boolean(bal?.sub_active),
      paidEnergy: Number(bal?.paid_energy ?? 0),
      grantId: raced?.id ?? grantId,
    };
  }

  if (input.kind === "pack" && input.energyGranted > 0) {
    await db.query(`UPDATE users SET paid_energy = paid_energy + $1 WHERE id = $2`, [
      input.energyGranted,
      input.userId,
    ]);
  }
  if (input.kind === "subscription") {
    await db.query(`UPDATE users SET sub_active = TRUE WHERE id = $1`, [input.userId]);
  }

  const refreshed = await one<{ sub_active: boolean; paid_energy: number }>(
    db,
    `SELECT COALESCE(sub_active, FALSE) AS sub_active, paid_energy FROM users WHERE id = $1`,
    [input.userId],
  );

  return {
    ok: true,
    alreadyGranted: false,
    kind: input.kind,
    energyGranted: input.energyGranted,
    subActive: Boolean(refreshed?.sub_active),
    paidEnergy: Number(refreshed?.paid_energy ?? 0),
    grantId,
  };
}

export async function setSubActive(
  db: Queryable,
  userId: string,
  active: boolean,
): Promise<{ ok: true; subActive: boolean } | { ok: false; reason: "user_not_found" }> {
  const user = await one<{ id: string }>(db, `SELECT id FROM users WHERE id = $1`, [userId]);
  if (!user) return { ok: false, reason: "user_not_found" };
  await db.query(`UPDATE users SET sub_active = $1 WHERE id = $2`, [active, userId]);
  return { ok: true, subActive: active };
}
