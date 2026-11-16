import { nanoid } from "nanoid";
import { one, withTransaction, type Db, type Queryable } from "./db.js";
import { iosSubOffer, isSubProductId, lookupPackByProductId } from "./iapCatalog.js";

export type GrantKind = "pack" | "subscription";

export type ApplyGrantInput = {
  userId: string;
  productId: string;
  transactionId: string;
  eventId?: string | null;
  store?: string;
  environment?: string | null;
  /** When true, mark sub inactive (expiration / unsubscribe). */
  deactivateSub?: boolean;
};

export type ApplyGrantResult =
  | {
      ok: true;
      alreadyGranted: boolean;
      kind: GrantKind;
      energyGranted: number;
      subActive: boolean;
      grantId: string;
    }
  | { ok: false; reason: "user_not_found" | "unknown_product" | "invalid_transaction" };

/**
 * Idempotent entitlement apply for a verified App Store / RevenueCat purchase.
 * Packs credit `paid_energy`. Subscriptions flip `sub_active` (midnight +50 is CC-33).
 */
export async function applyIapGrant(
  db: Db | Queryable,
  input: ApplyGrantInput,
): Promise<ApplyGrantResult> {
  const productId = input.productId.trim();
  const transactionId = input.transactionId.trim();
  if (!transactionId) return { ok: false, reason: "invalid_transaction" };

  const user = await one<{ id: string; paid_energy: number; sub_active: boolean }>(
    db,
    `SELECT id, paid_energy, sub_active FROM users WHERE id = $1`,
    [input.userId],
  );
  if (!user) return { ok: false, reason: "user_not_found" };

  if (input.deactivateSub || isExpirationOnly(productId, input.deactivateSub)) {
    return deactivateSubscription(db, {
      userId: input.userId,
      productId: productId || iosSubOffer().productId,
      transactionId,
      eventId: input.eventId,
      store: input.store,
      environment: input.environment,
    });
  }

  const pack = lookupPackByProductId(productId);
  const isSub = isSubProductId(productId);
  if (!pack && !isSub) return { ok: false, reason: "unknown_product" };

  const kind: GrantKind = pack ? "pack" : "subscription";
  const energyGranted = pack ? pack.energy : 0;

  // Prefer pool transaction when available.
  if ("connect" in db && typeof (db as Db).connect === "function") {
    return withTransaction(db as Db, (client) =>
      applyOnTx(client, {
        userId: input.userId,
        productId,
        transactionId,
        eventId: input.eventId ?? null,
        store: input.store ?? "app_store",
        environment: input.environment ?? null,
        kind,
        energyGranted,
        activateSub: isSub,
      }),
    );
  }

  return applyOnTx(db, {
    userId: input.userId,
    productId,
    transactionId,
    eventId: input.eventId ?? null,
    store: input.store ?? "app_store",
    environment: input.environment ?? null,
    kind,
    energyGranted,
    activateSub: isSub,
  });
}

function isExpirationOnly(productId: string, deactivate?: boolean): boolean {
  return Boolean(deactivate) && (productId === "" || isSubProductId(productId));
}

async function deactivateSubscription(
  db: Queryable,
  input: {
    userId: string;
    productId: string;
    transactionId: string;
    eventId?: string | null;
    store?: string;
    environment?: string | null;
  },
): Promise<ApplyGrantResult> {
  const existing = await one<{ id: string; energy_granted: number }>(
    db,
    `SELECT id, energy_granted FROM iap_grants WHERE provider_transaction_id = $1`,
    [input.transactionId],
  );
  if (existing) {
    await db.query(`UPDATE users SET sub_active = FALSE WHERE id = $1`, [input.userId]);
    return {
      ok: true,
      alreadyGranted: true,
      kind: "subscription",
      energyGranted: Number(existing.energy_granted),
      subActive: false,
      grantId: existing.id,
    };
  }

  const grantId = nanoid();
  const createdAt = new Date().toISOString();
  // Same $1…$10 layout as applyOnTx so tests / callers can share query stubs.
  await db.query(
    `INSERT INTO iap_grants (
       id, user_id, provider, store, product_id, kind, energy_granted,
       provider_event_id, provider_transaction_id, environment, created_at
     ) VALUES ($1,$2,'revenuecat',$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (provider_transaction_id) DO NOTHING`,
    [
      grantId,
      input.userId,
      input.store ?? "app_store",
      input.productId,
      "subscription",
      0,
      input.eventId ?? null,
      input.transactionId,
      input.environment ?? null,
      createdAt,
    ],
  );
  await db.query(`UPDATE users SET sub_active = FALSE WHERE id = $1`, [input.userId]);
  return {
    ok: true,
    alreadyGranted: false,
    kind: "subscription",
    energyGranted: 0,
    subActive: false,
    grantId,
  };
}

async function applyOnTx(
  db: Queryable,
  opts: {
    userId: string;
    productId: string;
    transactionId: string;
    eventId: string | null;
    store: string;
    environment: string | null;
    kind: GrantKind;
    energyGranted: number;
    activateSub: boolean;
  },
): Promise<ApplyGrantResult> {
  const existing = await one<{
    id: string;
    energy_granted: number;
    kind: string;
  }>(db, `SELECT id, energy_granted, kind FROM iap_grants WHERE provider_transaction_id = $1`, [
    opts.transactionId,
  ]);
  if (existing) {
    const sub = await one<{ sub_active: boolean }>(
      db,
      `SELECT sub_active FROM users WHERE id = $1`,
      [opts.userId],
    );
    return {
      ok: true,
      alreadyGranted: true,
      kind: existing.kind as GrantKind,
      energyGranted: Number(existing.energy_granted),
      subActive: Boolean(sub?.sub_active),
      grantId: existing.id,
    };
  }

  if (opts.eventId) {
    const byEvent = await one<{ id: string; energy_granted: number; kind: string }>(
      db,
      `SELECT id, energy_granted, kind FROM iap_grants WHERE provider_event_id = $1`,
      [opts.eventId],
    );
    if (byEvent) {
      const sub = await one<{ sub_active: boolean }>(
        db,
        `SELECT sub_active FROM users WHERE id = $1`,
        [opts.userId],
      );
      return {
        ok: true,
        alreadyGranted: true,
        kind: byEvent.kind as GrantKind,
        energyGranted: Number(byEvent.energy_granted),
        subActive: Boolean(sub?.sub_active),
        grantId: byEvent.id,
      };
    }
  }

  const grantId = nanoid();
  const createdAt = new Date().toISOString();
  const insert = await db.query(
    `INSERT INTO iap_grants (
       id, user_id, provider, store, product_id, kind, energy_granted,
       provider_event_id, provider_transaction_id, environment, created_at
     ) VALUES ($1,$2,'revenuecat',$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (provider_transaction_id) DO NOTHING
     RETURNING id`,
    [
      grantId,
      opts.userId,
      opts.store,
      opts.productId,
      opts.kind,
      opts.energyGranted,
      opts.eventId,
      opts.transactionId,
      opts.environment,
      createdAt,
    ],
  );

  if (!insert.rowCount) {
    const raced = await one<{ id: string; energy_granted: number; kind: string }>(
      db,
      `SELECT id, energy_granted, kind FROM iap_grants WHERE provider_transaction_id = $1`,
      [opts.transactionId],
    );
    const sub = await one<{ sub_active: boolean }>(
      db,
      `SELECT sub_active FROM users WHERE id = $1`,
      [opts.userId],
    );
    return {
      ok: true,
      alreadyGranted: true,
      kind: (raced?.kind as GrantKind) ?? opts.kind,
      energyGranted: Number(raced?.energy_granted ?? opts.energyGranted),
      subActive: Boolean(sub?.sub_active),
      grantId: raced?.id ?? grantId,
    };
  }

  if (opts.kind === "pack" && opts.energyGranted > 0) {
    await db.query(`UPDATE users SET paid_energy = paid_energy + $1 WHERE id = $2`, [
      opts.energyGranted,
      opts.userId,
    ]);
  }

  if (opts.activateSub) {
    await db.query(`UPDATE users SET sub_active = TRUE WHERE id = $1`, [opts.userId]);
  }

  const sub = await one<{ sub_active: boolean }>(
    db,
    `SELECT sub_active FROM users WHERE id = $1`,
    [opts.userId],
  );

  return {
    ok: true,
    alreadyGranted: false,
    kind: opts.kind,
    energyGranted: opts.energyGranted,
    subActive: Boolean(sub?.sub_active),
    grantId,
  };
}

/** Ops / restore helper: set sub flag without a store transaction (dev only via route gate). */
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
