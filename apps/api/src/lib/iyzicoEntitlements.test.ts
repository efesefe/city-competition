import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fmtMoneyTry,
  lookupPackBySku,
  webPackOffers,
  webShopCatalog,
  webSubOffer,
} from "./iyzicoCatalog.js";
import { parseWebhookBody, signWebhookV3, verifyWebhookSignature } from "./iyzicoClient.js";
import { applyIyzicoGrant } from "./iyzicoEntitlements.js";
import type { Queryable } from "./db.js";

describe("iyzico catalog", () => {
  it("exposes locked pack energies 200/600/1500", () => {
    const packs = webPackOffers();
    assert.deepEqual(
      packs.map((p) => p.energy),
      [200, 600, 1500],
    );
    assert.equal(webSubOffer().dailyBonus, 50);
  });

  it("formats TRY from kuruş", () => {
    assert.equal(fmtMoneyTry(4999), "49.99");
    assert.equal(lookupPackBySku("small")?.amountKurus, 4999);
  });

  it("shop catalog is iyzico web + 3DS", () => {
    const shop = webShopCatalog();
    assert.equal(shop.provider, "iyzico");
    assert.equal(shop.platform, "web");
    assert.equal(shop.threeds, true);
    assert.equal(shop.packs.length, 3);
    assert.equal(shop.subscription.sku, "monthly");
  });
});

describe("iyzico webhook signature", () => {
  it("verifies X-IYZ-SIGNATURE-V3", () => {
    process.env.IYZICO_SECRET_KEY = "test-secret";
    const eventType = "CHECKOUT_FORM_AUTH";
    const paymentId = "pay-1";
    const token = "tok-1";
    const conversationId = "conv-1";
    const status = "SUCCESS";
    const sig = signWebhookV3(eventType, paymentId, token, conversationId, status);
    const body = JSON.stringify({
      iyziEventType: eventType,
      iyziPaymentId: paymentId,
      token,
      paymentConversationId: conversationId,
      status,
    });
    assert.equal(
      verifyWebhookSignature({ "x-iyz-signature-v3": sig }, body),
      true,
    );
    assert.equal(
      verifyWebhookSignature({ "x-iyz-signature-v3": "deadbeef" }, body),
      false,
    );
    const parsed = parseWebhookBody(JSON.parse(body));
    assert.equal(parsed.status, "succeeded");
    assert.equal(parsed.conversationId, conversationId);
  });
});

type Row = Record<string, unknown>;

function memoryDb() {
  const users = new Map<string, Row>();
  const checkouts = new Map<string, Row>();
  const grants = new Map<string, Row>();

  users.set("u1", {
    id: "u1",
    paid_energy: 0,
    sub_active: false,
  });
  checkouts.set("c1", {
    id: "c1",
    user_id: "u1",
    status: "pending",
  });

  const db = {
    async query(text: string, params: unknown[] = []) {
      if (text.includes("FROM users WHERE id") && text.includes("paid_energy")) {
        const u = users.get(String(params[0]));
        return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
      }
      if (text.includes("FROM iyzico_checkouts WHERE id")) {
        const c = checkouts.get(String(params[0]));
        return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
      }
      if (text.includes("FROM iyzico_grants WHERE provider_payment_id")) {
        for (const g of grants.values()) {
          if (g.provider_payment_id === params[0]) {
            return { rows: [g], rowCount: 1 };
          }
        }
        return { rows: [], rowCount: 0 };
      }
      if (text.startsWith("INSERT INTO iyzico_grants")) {
        const id = String(params[0]);
        const paymentId = String(params[6]);
        for (const g of grants.values()) {
          if (g.provider_payment_id === paymentId) {
            return { rows: [], rowCount: 0 };
          }
        }
        const row = {
          id,
          user_id: params[1],
          checkout_id: params[2],
          kind: params[3],
          product_id: params[4],
          energy_granted: params[5],
          provider_payment_id: paymentId,
          created_at: params[7],
        };
        grants.set(id, row);
        return { rows: [{ id }], rowCount: 1 };
      }
      if (text.includes("paid_energy = paid_energy +")) {
        const u = users.get(String(params[1]))!;
        u.paid_energy = Number(u.paid_energy) + Number(params[0]);
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("SET sub_active = TRUE")) {
        const u = users.get(String(params[0]))!;
        u.sub_active = true;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("UPDATE iyzico_checkouts")) {
        const c = checkouts.get(String(params[0]));
        if (c) {
          c.status = "succeeded";
          c.provider_payment_id = params[1];
        }
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("SELECT COALESCE(sub_active")) {
        const u = users.get(String(params[0]));
        return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  } as unknown as Queryable;

  return { db, users, grants };
}

describe("applyIyzicoGrant", () => {
  it("credits paid_energy for packs idempotently", async () => {
    const { db, users } = memoryDb();
    const first = await applyIyzicoGrant(db, {
      userId: "u1",
      checkoutId: "c1",
      productId: "cc_web_pack_small_200",
      kind: "pack",
      energyGranted: 200,
      providerPaymentId: "pay-pack-1",
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.alreadyGranted, false);
    assert.equal(first.energyGranted, 200);
    assert.equal(users.get("u1")!.paid_energy, 200);

    const second = await applyIyzicoGrant(db, {
      userId: "u1",
      checkoutId: "c1",
      productId: "cc_web_pack_small_200",
      kind: "pack",
      energyGranted: 200,
      providerPaymentId: "pay-pack-1",
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.alreadyGranted, true);
    assert.equal(users.get("u1")!.paid_energy, 200);
  });

  it("activates sub_active for subscription", async () => {
    const { db, users } = memoryDb();
    const res = await applyIyzicoGrant(db, {
      userId: "u1",
      checkoutId: "c1",
      productId: "cc_web_sub_monthly",
      kind: "subscription",
      energyGranted: 0,
      providerPaymentId: "pay-sub-1",
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.subActive, true);
    assert.equal(users.get("u1")!.sub_active, true);
    assert.equal(users.get("u1")!.paid_energy, 0);
  });
});
