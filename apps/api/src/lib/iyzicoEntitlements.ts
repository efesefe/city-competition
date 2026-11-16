import { nanoid } from "nanoid";
import { one, withTransaction, type Db, type Queryable } from "./db.js";

export type IyzicoGrantKind = "pack" | "subscription";

export type ApplyIyzicoGrantInput = {
  userId: string;
  checkoutId: string;
  productId: string;
  kind: IyzicoGrantKind;
  energyGranted: number;
  providerPaymentId: string;
};

export type ApplyIyzicoGrantResult =
  | {
      ok: true;
      alreadyGranted: boolean;
      kind: IyzicoGrantKind;
      energyGranted: number;
      subActive: boolean;
      grantId: string;
      paidEnergy: number;
    }
  | { ok: false; reason: "user_not_found" | "invalid_payment" | "checkout_not_found" };

/**
 * Idempotent entitlement apply after a verified iyzico Checkout Form / 3DS success.
 * Packs credit `paid_energy`. Subscriptions flip `sub_active` (midnight +50 is CC-33).
 */
export async function applyIyzicoGrant(
  db: Db | Queryable,
  input: ApplyIyzicoGrantInput,
): Promise<ApplyIyzicoGrantResult> {
  const providerPaymentId = input.providerPaymentId.trim();
  if (!providerPaymentId) return { ok: false, reason: "invalid_payment" };

  const user = await one<{ id: string; paid_energy: number; sub_active: boolean }>(
    db,
    `SELECT id, paid_energy, COALESCE(sub_active, FALSE) AS sub_active FROM users WHERE id = $1`,
    [input.userId],
  );
  if (!user) return { ok: false, reason: "user_not_found" };

  const checkout = await one<{ id: string; status: string }>(
    db,
    `SELECT id, status FROM iyzico_checkouts WHERE id = $1`,
    [input.checkoutId],
  );
  if (!checkout) return { ok: false, reason: "checkout_not_found" };

  if ("connect" in db && typeof (db as Db).connect === "function") {
    return withTransaction(db as Db, (client) => applyOnTx(client, input));
  }
  return applyOnTx(db, input);
}

async function applyOnTx(
  db: Queryable,
  input: ApplyIyzicoGrantInput,
): Promise<ApplyIyzicoGrantResult> {
  const existing = await one<{
    id: string;
    energy_granted: number;
    kind: string;
  }>(db, `SELECT id, energy_granted, kind FROM iyzico_grants WHERE provider_payment_id = $1`, [
    input.providerPaymentId,
  ]);
  if (existing) {
    const sub = await one<{ sub_active: boolean; paid_energy: number }>(
      db,
      `SELECT COALESCE(sub_active, FALSE) AS sub_active, paid_energy FROM users WHERE id = $1`,
      [input.userId],
    );
    return {
      ok: true,
      alreadyGranted: true,
      kind: existing.kind as IyzicoGrantKind,
      energyGranted: Number(existing.energy_granted),
      subActive: Boolean(sub?.sub_active),
      grantId: existing.id,
      paidEnergy: Number(sub?.paid_energy ?? 0),
    };
  }

  const grantId = nanoid();
  const createdAt = new Date().toISOString();
  const inserted = await one<{ id: string }>(
    db,
    `INSERT INTO iyzico_grants (
       id, user_id, checkout_id, kind, product_id, energy_granted,
       provider_payment_id, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (provider_payment_id) DO NOTHING
     RETURNING id`,
    [
      grantId,
      input.userId,
      input.checkoutId,
      input.kind,
      input.productId,
      input.energyGranted,
      input.providerPaymentId,
      createdAt,
    ],
  );

  if (!inserted) {
    // Race: another worker won the unique insert.
    const raced = await one<{ id: string; energy_granted: number; kind: string }>(
      db,
      `SELECT id, energy_granted, kind FROM iyzico_grants WHERE provider_payment_id = $1`,
      [input.providerPaymentId],
    );
    const sub = await one<{ sub_active: boolean; paid_energy: number }>(
      db,
      `SELECT COALESCE(sub_active, FALSE) AS sub_active, paid_energy FROM users WHERE id = $1`,
      [input.userId],
    );
    return {
      ok: true,
      alreadyGranted: true,
      kind: (raced?.kind as IyzicoGrantKind) || input.kind,
      energyGranted: Number(raced?.energy_granted ?? input.energyGranted),
      subActive: Boolean(sub?.sub_active),
      grantId: raced?.id || grantId,
      paidEnergy: Number(sub?.paid_energy ?? 0),
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

  await db.query(
    `UPDATE iyzico_checkouts
     SET status = 'succeeded',
         provider_payment_id = $2,
         updated_at = $3
     WHERE id = $1`,
    [input.checkoutId, input.providerPaymentId, createdAt],
  );

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
    grantId,
    paidEnergy: Number(refreshed?.paid_energy ?? 0),
  };
}

export async function markCheckoutFailed(db: Queryable, checkoutId: string): Promise<void> {
  await db.query(
    `UPDATE iyzico_checkouts SET status = 'failed', updated_at = $2
     WHERE id = $1 AND status = 'pending'`,
    [checkoutId, new Date().toISOString()],
  );
}
