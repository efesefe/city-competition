/**
 * Minimal iyzico Checkout Form + Subscription CF client (IYZWSv2 auth).
 * Matches the shape used by iyzipay-node / the legacy Go payments service.
 * Card PAN never touches our servers — hosted CF / 3DS only.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { iyzicoMockMode, publicApiBase } from "./iyzicoCatalog.js";

const WEBHOOK_SIG_HEADER = "x-iyz-signature-v3";

export type CheckoutInitResult = {
  token: string;
  checkoutUrl: string;
  mock: boolean;
};

export type CheckoutRetrieveResult = {
  status: "success" | "failure";
  paymentStatus?: string;
  paymentId?: string;
  conversationId?: string;
  token?: string;
  errorMessage?: string;
};

export type SubscriptionRetrieveResult = {
  status: "success" | "failure";
  subscriptionStatus?: string;
  referenceCode?: string;
  conversationId?: string;
  token?: string;
  errorMessage?: string;
};

function apiKey(): string {
  return process.env.IYZICO_API_KEY?.trim() || "";
}

function secretKey(): string {
  return process.env.IYZICO_SECRET_KEY?.trim() || "mock-iyzico-secret";
}

export function iyzicoBaseUrl(): string {
  return (
    process.env.IYZICO_BASE_URL?.trim() ||
    "https://sandbox-api.iyzipay.com"
  );
}

function authHeader(randomKey: string, path: string, body: string): string {
  const mac = createHmac("sha256", secretKey());
  mac.update(randomKey + path + body);
  const signature = mac.digest("hex");
  const plain = `apiKey:${apiKey()}&randomKey:${randomKey}&signature:${signature}`;
  return `IYZWSv2 ${Buffer.from(plain, "utf8").toString("base64")}`;
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const body = JSON.stringify(payload);
  const rnd = randomBytes(16).toString("hex");
  const url = `${iyzicoBaseUrl().replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(rnd, path, body),
      "x-iyzi-rnd": rnd,
    },
    body,
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`iyzico_http_${res.status}:${raw.slice(0, 200)}`);
  }
  return JSON.parse(raw) as T;
}

async function getJson<T>(path: string): Promise<T> {
  const body = "";
  const rnd = randomBytes(16).toString("hex");
  const url = `${iyzicoBaseUrl().replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: authHeader(rnd, path, body),
      "x-iyzi-rnd": rnd,
    },
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`iyzico_http_${res.status}:${raw.slice(0, 200)}`);
  }
  return JSON.parse(raw) as T;
}

export type PackCheckoutInput = {
  conversationId: string;
  productId: string;
  price: string;
  paidPrice: string;
  callbackUrl: string;
  buyerId: string;
  buyerEmail?: string;
  returnUrl?: string;
};

export async function initializePackCheckout(
  input: PackCheckoutInput,
): Promise<CheckoutInitResult> {
  if (iyzicoMockMode()) {
    const token = `mock-tok-${input.conversationId}`;
    const base = publicApiBase().replace(/\/$/, "");
    const q = new URLSearchParams();
    q.set("token", token);
    if (input.returnUrl) q.set("return_url", input.returnUrl);
    return {
      token,
      checkoutUrl: `${base}/v1/payments/iyzico/mock-checkout/${input.conversationId}?${q}`,
      mock: true,
    };
  }

  const path = "/payment/iyzipos/checkoutform/initialize/auth/ecom";
  const payload = {
    locale: "tr",
    conversationId: input.conversationId,
    price: input.price,
    paidPrice: input.paidPrice,
    currency: "TRY",
    basketId: input.productId,
    paymentGroup: "PRODUCT",
    callbackUrl: input.callbackUrl,
    buyer: {
      id: input.buyerId,
      name: "Player",
      surname: "User",
      identityNumber: "11111111111",
      email: input.buyerEmail || `${input.buyerId}@citycompetition.local`,
      registrationAddress: "TR",
      city: "Istanbul",
      country: "Turkey",
      ip: "127.0.0.1",
    },
    shippingAddress: {
      contactName: "Player User",
      city: "Istanbul",
      country: "Turkey",
      address: "TR",
    },
    billingAddress: {
      contactName: "Player User",
      city: "Istanbul",
      country: "Turkey",
      address: "TR",
    },
    basketItems: [
      {
        id: input.productId,
        name: input.productId,
        category1: "Energy",
        itemType: "VIRTUAL",
        price: input.price,
      },
    ],
  };

  const resp = await postJson<{
    status: string;
    errorMessage?: string;
    token?: string;
    paymentPageUrl?: string;
  }>(path, payload);

  if (resp.status !== "success" || !resp.token) {
    throw new Error(resp.errorMessage || "iyzico_checkout_init_failed");
  }
  const checkoutUrl =
    resp.paymentPageUrl ||
    `${iyzicoBaseUrl().replace(/\/$/, "")}/payment/checkoutform?token=${resp.token}`;
  return { token: resp.token, checkoutUrl, mock: false };
}

export async function retrievePackCheckout(
  token: string,
  conversationId?: string,
): Promise<CheckoutRetrieveResult> {
  if (iyzicoMockMode() && token.startsWith("mock-tok-")) {
    return {
      status: "success",
      paymentStatus: "SUCCESS",
      paymentId: `mock-pay-${conversationId || token}`,
      conversationId,
      token,
    };
  }

  const path = "/payment/iyzipos/checkoutform/auth/ecom/detail";
  const resp = await postJson<{
    status: string;
    paymentStatus?: string;
    paymentId?: string | number;
    conversationId?: string;
    token?: string;
    errorMessage?: string;
  }>(path, {
    locale: "tr",
    conversationId,
    token,
  });

  const ok =
    resp.status === "success" &&
    String(resp.paymentStatus || "").toUpperCase() === "SUCCESS";
  return {
    status: ok ? "success" : "failure",
    paymentStatus: resp.paymentStatus,
    paymentId: resp.paymentId != null ? String(resp.paymentId) : undefined,
    conversationId: resp.conversationId,
    token: resp.token || token,
    errorMessage: resp.errorMessage,
  };
}

export type SubCheckoutInput = {
  conversationId: string;
  pricingPlanReferenceCode: string;
  callbackUrl: string;
  buyerId: string;
  buyerEmail?: string;
  returnUrl?: string;
};

export async function initializeSubscriptionCheckout(
  input: SubCheckoutInput,
): Promise<CheckoutInitResult> {
  if (iyzicoMockMode()) {
    const token = `mock-sub-tok-${input.conversationId}`;
    const base = publicApiBase().replace(/\/$/, "");
    const q = new URLSearchParams();
    q.set("token", token);
    if (input.returnUrl) q.set("return_url", input.returnUrl);
    return {
      token,
      checkoutUrl: `${base}/v1/payments/iyzico/mock-checkout/${input.conversationId}?${q}`,
      mock: true,
    };
  }

  const path = "/v2/subscription/checkoutform/initialize";
  const payload = {
    locale: "tr",
    conversationId: input.conversationId,
    callbackUrl: input.callbackUrl,
    pricingPlanReferenceCode: input.pricingPlanReferenceCode,
    subscriptionInitialStatus: "ACTIVE",
    customer: {
      name: "Player",
      surname: "User",
      email: input.buyerEmail || `${input.buyerId}@citycompetition.local`,
      gsmNumber: "+905555555555",
      identityNumber: "11111111111",
      billingAddress: {
        contactName: "Player User",
        city: "Istanbul",
        country: "Turkey",
        address: "TR",
      },
    },
  };

  const resp = await postJson<{
    status: string;
    errorMessage?: string;
    token?: string;
    checkoutFormContent?: string;
  }>(path, payload);

  if (resp.status !== "success" || !resp.token) {
    throw new Error(resp.errorMessage || "iyzico_sub_init_failed");
  }

  // Subscription CF often returns HTML content; hosted page URL follows token pattern.
  const checkoutUrl = `${iyzicoBaseUrl().replace(/\/$/, "")}/v2/subscription/checkoutform/${resp.token}`;
  return { token: resp.token, checkoutUrl, mock: false };
}

export async function retrieveSubscriptionCheckout(
  token: string,
  conversationId?: string,
): Promise<SubscriptionRetrieveResult> {
  if (iyzicoMockMode() && token.startsWith("mock-")) {
    return {
      status: "success",
      subscriptionStatus: "ACTIVE",
      referenceCode: `mock-sub-${conversationId || token}`,
      conversationId,
      token,
    };
  }

  const q = conversationId
    ? `?conversationId=${encodeURIComponent(conversationId)}`
    : "";
  const path = `/v2/subscription/checkoutform/${encodeURIComponent(token)}${q}`;
  const resp = await getJson<{
    status: string;
    errorMessage?: string;
    conversationId?: string;
    token?: string;
    data?: {
      referenceCode?: string;
      subscriptionStatus?: string;
    };
  }>(path);

  const subStatus = resp.data?.subscriptionStatus || "";
  const ok =
    resp.status === "success" &&
    ["ACTIVE", "PENDING"].includes(String(subStatus).toUpperCase());
  return {
    status: ok ? "success" : "failure",
    subscriptionStatus: subStatus,
    referenceCode: resp.data?.referenceCode,
    conversationId: resp.conversationId || conversationId,
    token: resp.token || token,
    errorMessage: resp.errorMessage,
  };
}

export function signWebhookV3(
  eventType: string,
  paymentId: string,
  token: string,
  conversationId: string,
  status: string,
): string {
  const msg = secretKey() + eventType + paymentId + token + conversationId + status;
  return createHmac("sha256", secretKey()).update(msg).digest("hex");
}

export function verifyWebhookSignature(
  headers: Record<string, string | string[] | undefined>,
  body: Buffer | string,
): boolean {
  const rawHeader =
    headers[WEBHOOK_SIG_HEADER] ||
    headers["X-IYZ-SIGNATURE-V3"] ||
    headers["x-iyz-signature-v3"];
  const sig = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!sig) return false;

  let event: {
    iyziEventType?: string;
    iyziPaymentId?: string | number;
    paymentId?: string | number;
    token?: string;
    paymentConversationId?: string;
    status?: string;
  };
  try {
    event = JSON.parse(typeof body === "string" ? body : body.toString("utf8"));
  } catch {
    return false;
  }

  const paymentId = String(event.iyziPaymentId ?? event.paymentId ?? "");
  const expected = signWebhookV3(
    event.iyziEventType || "",
    paymentId === "undefined" || paymentId === "null" ? "" : paymentId,
    event.token || "",
    event.paymentConversationId || "",
    event.status || "",
  );

  try {
    const a = Buffer.from(sig.toLowerCase());
    const b = Buffer.from(expected.toLowerCase());
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function parseWebhookBody(body: unknown): {
  status: "succeeded" | "failed" | "chargeback";
  token: string;
  paymentId: string;
  conversationId: string;
  eventType: string;
} {
  const event = (body || {}) as {
    token?: string;
    paymentId?: string | number;
    iyziPaymentId?: string | number;
    paymentConversationId?: string;
    status?: string;
    iyziEventType?: string;
  };
  const eventType = event.iyziEventType || "";
  let status: "succeeded" | "failed" | "chargeback" = "failed";
  if (
    String(event.status || "").toUpperCase() === "CHARGEBACK" ||
    eventType.toUpperCase().includes("CHARGEBACK")
  ) {
    status = "chargeback";
  } else if (String(event.status || "").toUpperCase() === "SUCCESS") {
    status = "succeeded";
  }
  const paymentId = String(event.iyziPaymentId ?? event.paymentId ?? event.token ?? "");
  return {
    status,
    token: event.token || "",
    paymentId: paymentId === "undefined" || paymentId === "null" ? "" : paymentId,
    conversationId: event.paymentConversationId || "",
    eventType,
  };
}

export function buildMockSignedWebhook(
  conversationId: string,
  token: string,
  status: string,
): { body: string; signature: string } {
  const paymentId = `mock-pay-${conversationId}`;
  const eventType = "CHECKOUT_FORM_AUTH";
  const payload = {
    iyziEventType: eventType,
    iyziPaymentId: paymentId,
    token,
    paymentConversationId: conversationId,
    status,
  };
  return {
    body: JSON.stringify(payload),
    signature: signWebhookV3(eventType, paymentId, token, conversationId, status),
  };
}
