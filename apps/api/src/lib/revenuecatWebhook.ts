import { z } from "zod";
import {
  androidSubOffer,
  iosSubOffer,
  isSubProductId,
  lookupPackByProductId,
} from "./iapCatalog.js";

/** RevenueCat webhook event types we act on for Season 0 packs + sub. */
export const GRANT_EVENT_TYPES = new Set([
  "INITIAL_PURCHASE",
  "NON_RENEWING_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
]);

/** Only clear sub on true expiry — CANCELLATION still has remaining paid time. */
export const DEACTIVATE_EVENT_TYPES = new Set(["EXPIRATION"]);

const eventSchema = z
  .object({
    type: z.string(),
    id: z.string().optional(),
    app_user_id: z.string().optional(),
    original_app_user_id: z.string().optional(),
    product_id: z.string().optional(),
    entitlement_ids: z.array(z.string()).nullable().optional(),
    entitlement_id: z.string().nullable().optional(),
    store: z.string().optional(),
    environment: z.string().optional(),
    transaction_id: z.string().optional(),
    original_transaction_id: z.string().optional(),
  })
  .passthrough();

const bodySchema = z
  .object({
    api_version: z.string().optional(),
    event: eventSchema,
  })
  .passthrough();

export type ParsedRcEvent =
  | {
      action: "grant" | "deactivate_sub";
      userId: string;
      productId: string;
      transactionId: string;
      eventId: string;
      store: string;
      environment: string | null;
      type: string;
    }
  | { action: "ignore"; reason: string; type?: string };

export function verifyRevenueCatAuthorization(
  header: string | string[] | undefined,
  expected = process.env.REVENUECAT_WEBHOOK_AUTHORIZATION,
): boolean {
  const want = expected?.trim();
  if (!want) return false;
  const got = Array.isArray(header) ? header[0] : header;
  if (!got) return false;
  // Dashboard value may be stored with or without the "Bearer " prefix.
  const normalized = got.trim();
  return normalized === want || normalized === `Bearer ${want}` || `Bearer ${normalized}` === want;
}

function normalizeStore(store: string | undefined): "app_store" | "play_store" | "other" {
  const s = (store || "APP_STORE").toLowerCase().replace(/-/g, "_");
  if (s === "app_store" || s === "apple" || s === "mac_app_store") return "app_store";
  if (s === "play_store" || s === "google" || s === "google_play" || s === "play") return "play_store";
  // RC often sends PLAY_STORE uppercase → lowercased play_store already handled;
  // also accept literal "play_store" from tests.
  if (s === "play_store") return "play_store";
  return "other";
}

function defaultSubProductId(store: "app_store" | "play_store"): string {
  return store === "play_store" ? androidSubOffer().productId : iosSubOffer().productId;
}

export function parseRevenueCatWebhook(body: unknown): ParsedRcEvent {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return { action: "ignore", reason: "invalid_body" };

  const ev = parsed.data.event;
  const type = ev.type.toUpperCase();
  const userId = (ev.app_user_id || ev.original_app_user_id || "").trim();
  if (!userId || userId.startsWith("$RCAnonymousID:")) {
    return { action: "ignore", reason: "missing_app_user_id", type };
  }

  const productId = (ev.product_id || "").trim();
  const transactionId = (
    ev.transaction_id ||
    ev.original_transaction_id ||
    ev.id ||
    ""
  ).trim();
  if (!transactionId) return { action: "ignore", reason: "missing_transaction", type };

  const store = normalizeStore(ev.store);
  // CC-44 + CC-45: App Store and Play Store only (web is iyzico).
  if (store === "other") {
    return { action: "ignore", reason: "unsupported_store", type };
  }

  const eventId = (ev.id || transactionId).trim();
  const environment = ev.environment ?? null;
  const subEntitlement = iosSubOffer().entitlementId; // shared RC entitlement id
  const entitlements = [
    ...(ev.entitlement_ids ?? []),
    ...(ev.entitlement_id ? [ev.entitlement_id] : []),
  ].filter(Boolean) as string[];

  const looksLikeSub =
    isSubProductId(productId) ||
    entitlements.includes(subEntitlement) ||
    (productId === "" && entitlements.includes(subEntitlement));

  if (DEACTIVATE_EVENT_TYPES.has(type)) {
    if (!looksLikeSub && productId && !isSubProductId(productId)) {
      return { action: "ignore", reason: "pack_expire_noop", type };
    }
    return {
      action: "deactivate_sub",
      userId,
      productId: productId || defaultSubProductId(store),
      transactionId: `expire:${transactionId}`,
      eventId,
      store,
      environment,
      type,
    };
  }

  if (!GRANT_EVENT_TYPES.has(type)) {
    return { action: "ignore", reason: "unhandled_type", type };
  }

  if (looksLikeSub) {
    return {
      action: "grant",
      userId,
      productId: productId || defaultSubProductId(store),
      transactionId,
      eventId,
      store,
      environment,
      type,
    };
  }

  if (lookupPackByProductId(productId)) {
    return {
      action: "grant",
      userId,
      productId,
      transactionId,
      eventId,
      store,
      environment,
      type,
    };
  }

  return { action: "ignore", reason: "unknown_product", type };
}
