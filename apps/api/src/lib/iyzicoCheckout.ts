import { nanoid } from "nanoid";
import { one, type Db, type Queryable } from "./db.js";
import {
  fmtMoneyTry,
  isWebSubProductId,
  iyzicoMockMode,
  lookupPackByProductId,
  lookupPackBySku,
  publicApiBase,
  webSubOffer,
} from "./iyzicoCatalog.js";
import {
  initializePackCheckout,
  initializeSubscriptionCheckout,
  retrievePackCheckout,
  retrieveSubscriptionCheckout,
} from "./iyzicoClient.js";
import { applyIyzicoGrant, markCheckoutFailed } from "./iyzicoEntitlements.js";

export type CheckoutRow = {
  id: string;
  user_id: string;
  kind: "pack" | "subscription";
  product_id: string;
  sku: string;
  energy_grant: number;
  amount_kurus: number;
  currency: string;
  status: string;
  provider_token: string | null;
  provider_payment_id: string | null;
  checkout_url: string | null;
  return_url: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
};

export type CreateCheckoutInput = {
  userId: string;
  /** pack sku (small|medium|large) or "monthly" for subscription */
  sku: string;
  kind: "pack" | "subscription";
  idempotencyKey: string;
  returnUrl: string;
  buyerEmail?: string;
};

export async function getCheckoutById(
  db: Queryable,
  id: string,
): Promise<CheckoutRow | null> {
  return (
    (await one<CheckoutRow>(db, `SELECT * FROM iyzico_checkouts WHERE id = $1`, [id])) ?? null
  );
}

export async function getCheckoutByIdempotency(
  db: Queryable,
  key: string,
): Promise<CheckoutRow | null> {
  return (
    (await one<CheckoutRow>(
      db,
      `SELECT * FROM iyzico_checkouts WHERE idempotency_key = $1`,
      [key],
    )) ?? null
  );
}

export async function createIyzicoCheckout(
  db: Db,
  input: CreateCheckoutInput,
): Promise<
  | { ok: true; checkout: CheckoutRow; mock: boolean }
  | {
      ok: false;
      reason:
        | "invalid_sku"
        | "pricing_plan_missing"
        | "provider_error"
        | string;
    }
> {
  const existing = await getCheckoutByIdempotency(db, input.idempotencyKey);
  if (existing) {
    return { ok: true, checkout: existing, mock: iyzicoMockMode() };
  }

  let kind = input.kind;
  let productId = "";
  let sku = input.sku;
  let energyGrant = 0;
  let amountKurus = 0;

  if (kind === "pack") {
    const pack = lookupPackBySku(sku) || lookupPackByProductId(sku);
    if (!pack) return { ok: false, reason: "invalid_sku" };
    productId = pack.productId;
    sku = pack.sku;
    energyGrant = pack.energy;
    amountKurus = pack.amountKurus;
  } else {
    const sub = webSubOffer();
    if (sku !== "monthly" && sku !== sub.productId && !isWebSubProductId(sku)) {
      // allow product id as sku
      if (sku !== sub.productId) return { ok: false, reason: "invalid_sku" };
    }
    productId = sub.productId;
    sku = "monthly";
    energyGrant = 0;
    amountKurus = sub.amountKurus;
    if (!iyzicoMockMode() && !sub.pricingPlanReferenceCode) {
      return { ok: false, reason: "pricing_plan_missing" };
    }
  }

  const id = nanoid();
  const now = new Date().toISOString();
  const callbackUrl = `${publicApiBase().replace(/\/$/, "")}/v1/payments/iyzico/callback`;

  let init;
  try {
    if (kind === "pack") {
      init = await initializePackCheckout({
        conversationId: id,
        productId,
        price: fmtMoneyTry(amountKurus),
        paidPrice: fmtMoneyTry(amountKurus),
        callbackUrl,
        buyerId: input.userId,
        buyerEmail: input.buyerEmail,
        returnUrl: input.returnUrl,
      });
    } else {
      const plan = webSubOffer().pricingPlanReferenceCode || "mock-plan";
      init = await initializeSubscriptionCheckout({
        conversationId: id,
        pricingPlanReferenceCode: plan,
        callbackUrl,
        buyerId: input.userId,
        buyerEmail: input.buyerEmail,
        returnUrl: input.returnUrl,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "provider_error";
    return { ok: false, reason: message };
  }

  try {
    await db.query(
      `INSERT INTO iyzico_checkouts (
         id, user_id, kind, product_id, sku, energy_grant, amount_kurus, currency,
         status, provider_token, checkout_url, return_url, idempotency_key, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'TRY','pending',$8,$9,$10,$11,$12,$12)`,
      [
        id,
        input.userId,
        kind,
        productId,
        sku,
        energyGrant,
        amountKurus,
        init.token,
        init.checkoutUrl,
        input.returnUrl,
        input.idempotencyKey,
        now,
      ],
    );
  } catch (err) {
    // Idempotency race — return the winner.
    const raced = await getCheckoutByIdempotency(db, input.idempotencyKey);
    if (raced) return { ok: true, checkout: raced, mock: init.mock };
    throw err;
  }

  const checkout = (await getCheckoutById(db, id))!;
  return { ok: true, checkout, mock: init.mock };
}

/**
 * After CF callback / mock success: retrieve from iyzico and grant entitlements.
 */
export async function finalizeIyzicoCheckout(
  db: Db,
  opts: { checkoutId: string; token?: string | null },
): Promise<
  | {
      ok: true;
      alreadyGranted: boolean;
      kind: "pack" | "subscription";
      energyGranted: number;
      subActive: boolean;
      grantId: string;
      checkout: CheckoutRow;
    }
  | { ok: false; reason: string }
> {
  const checkout = await getCheckoutById(db, opts.checkoutId);
  if (!checkout) return { ok: false, reason: "not_found" };

  if (checkout.status === "succeeded") {
    const grant = await one<{
      id: string;
      energy_granted: number;
      kind: string;
    }>(db, `SELECT id, energy_granted, kind FROM iyzico_grants WHERE checkout_id = $1`, [
      checkout.id,
    ]);
    const user = await one<{ sub_active: boolean }>(
      db,
      `SELECT COALESCE(sub_active, FALSE) AS sub_active FROM users WHERE id = $1`,
      [checkout.user_id],
    );
    return {
      ok: true,
      alreadyGranted: true,
      kind: checkout.kind,
      energyGranted: Number(grant?.energy_granted ?? checkout.energy_grant),
      subActive: Boolean(user?.sub_active),
      grantId: grant?.id || "",
      checkout,
    };
  }

  const token = opts.token || checkout.provider_token;
  if (!token) return { ok: false, reason: "missing_token" };

  let providerPaymentId = "";
  let succeeded = false;

  if (checkout.kind === "pack") {
    const retrieved = await retrievePackCheckout(token, checkout.id);
    succeeded = retrieved.status === "success";
    providerPaymentId = retrieved.paymentId || token;
    if (!succeeded) {
      await markCheckoutFailed(db, checkout.id);
      return { ok: false, reason: retrieved.errorMessage || "payment_failed" };
    }
  } else {
    const retrieved = await retrieveSubscriptionCheckout(token, checkout.id);
    succeeded = retrieved.status === "success";
    providerPaymentId = retrieved.referenceCode || token;
    if (!succeeded) {
      await markCheckoutFailed(db, checkout.id);
      return { ok: false, reason: retrieved.errorMessage || "subscription_failed" };
    }
  }

  const grant = await applyIyzicoGrant(db, {
    userId: checkout.user_id,
    checkoutId: checkout.id,
    productId: checkout.product_id,
    kind: checkout.kind,
    energyGranted: Number(checkout.energy_grant),
    providerPaymentId,
  });
  if (!grant.ok) return { ok: false, reason: grant.reason };

  const refreshed = (await getCheckoutById(db, checkout.id))!;
  return {
    ok: true,
    alreadyGranted: grant.alreadyGranted,
    kind: grant.kind,
    energyGranted: grant.energyGranted,
    subActive: grant.subActive,
    grantId: grant.grantId,
    checkout: refreshed,
  };
}

export function mockCheckoutHtml(checkout: CheckoutRow, token: string, returnUrl: string | null): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const label =
    checkout.kind === "subscription"
      ? "Aylık abonelik (+50/gün)"
      : `${checkout.sku} — ${checkout.energy_grant} enerji`;
  const amount = fmtMoneyTry(checkout.amount_kurus);
  return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mock iyzico 3DS</title>
<style>
  body{font-family:Georgia,serif;background:#0b1f17;color:#f4e7c5;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  .card{background:#13261d;padding:28px;border-radius:12px;max-width:420px;width:90%}
  h1{font-size:1.4rem;margin:0 0 8px}
  p{color:#9bb0a3;margin:6px 0}
  .amt{color:#c8a96b;font-size:1.2rem;margin:12px 0}
  form{display:flex;gap:10px;margin-top:18px}
  button{flex:1;padding:12px;border:0;border-radius:8px;font-weight:700;cursor:pointer}
  .ok{background:#c8a96b;color:#0b1f17}
  .fail{background:#3d5a4c;color:#f4e7c5}
  .badge{display:inline-block;background:#1e3a2c;color:#8fd4a0;padding:4px 8px;border-radius:6px;font-size:.75rem}
</style></head><body>
<div class="card">
  <span class="badge">Mock iyzico · 3DS</span>
  <h1>Checkout Form</h1>
  <p>${esc(label)}</p>
  <p class="amt">₺${esc(amount)}</p>
  <p>conversationId: <code>${esc(checkout.id)}</code></p>
  <form method="POST" action="/v1/payments/iyzico/mock-checkout/${esc(checkout.id)}/complete">
    <input type="hidden" name="token" value="${esc(token)}" />
    <input type="hidden" name="return_url" value="${esc(returnUrl || "")}" />
    <button class="ok" name="result" value="success" type="submit">3DS Başarılı</button>
    <button class="fail" name="result" value="fail" type="submit">Başarısız</button>
  </form>
</div>
</body></html>`;
}

export function redirectHtml(url: string, message: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${esc(url)}">
<title>Ödeme</title></head>
<body style="font-family:Georgia,serif;background:#0b1f17;color:#f4e7c5;padding:24px">
<p>${esc(message)}</p>
<p><a style="color:#c8a96b" href="${esc(url)}">Devam et</a></p>
</body></html>`;
}
