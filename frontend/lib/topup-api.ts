import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

export type CreditPack = {
  provider: string;
  product_id: string;
  credits: number;
  amount_kurus?: number;
};

export type CreditPacksResponse = {
  packs: CreditPack[];
  promo?: { bonus_percent: number } | null;
  custom?: {
    min_credits: number;
    max_credits: number;
    credits: number;
    amount_kurus: number;
  } | null;
};

export type CheckoutResult = {
  checkout_url: string;
  payment_intent_id: string;
  provider: string;
  provider_payment_id: string;
};

export type GrantResult = {
  balance_after: number;
  credits_granted: number;
  purchase_id: string;
  invoice_id?: string;
  already_granted: boolean;
};

export type CheckoutStatusResponse = {
  status: "pending" | "succeeded" | string;
  purchase_id?: string;
  invoice_id?: string;
  credits_granted?: number;
  balance_after?: number;
};

export type InvoiceResponse = {
  id: string;
  currency: string;
  kdv_rate_bps: number;
  net_kurus: number;
  tax_kurus: number;
  gross_kurus: number;
  status: string;
  created_at: string;
  source_type: string;
  source_id: string;
};

async function authJSON<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getSessionToken();
  if (!token) {
    throw Object.assign(new Error("error_unauthorized"), {
      status: 401,
      code: "error_unauthorized",
    });
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? "request_failed"), {
      status: res.status,
      code: data.error,
    });
  }
  return data;
}

export function fetchCreditPacks() {
  return authJSON<CreditPacksResponse>("GET", "/v1/credit-packs");
}

export function startCheckout(input: {
  provider: string;
  product_id: string;
  return_url: string;
  credits?: number;
}) {
  return authJSON<CheckoutResult>("POST", "/v1/payments/checkout", input);
}

export function verifyIap(input: {
  provider: string;
  product_id: string;
  receipt_data?: string;
  purchase_token?: string;
  package_name?: string;
}) {
  return authJSON<GrantResult>("POST", "/v1/iap/verify", input);
}

export function fetchCheckoutStatus(paymentIntentId: string) {
  const q = new URLSearchParams({ payment_intent_id: paymentIntentId });
  return authJSON<CheckoutStatusResponse>(
    "GET",
    `/v1/payments/checkout/status?${q}`,
  );
}

export function fetchInvoice(invoiceId: string) {
  return authJSON<InvoiceResponse>(
    "GET",
    `/v1/invoices/${encodeURIComponent(invoiceId)}`,
  );
}

export function simulateIyzicoSuccess(paymentIntentId: string) {
  return authJSON<{ status?: string }>(
    "POST",
    "/v1/dev/payments/simulate-iyzico",
    { payment_intent_id: paymentIntentId },
  );
}

export const CHECKOUT_INTENT_STORAGE_KEY = "cc_topup_payment_intent_id";
