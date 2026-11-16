import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEntitlementGrant, setSubActive } from "./entitlementGrants.js";
import { unifiedShopCatalog } from "./shopSkus.js";
import type { Queryable } from "./db.js";

type User = { id: string; paid_energy: number; sub_active: boolean };
type Grant = {
  id: string;
  provider: string;
  provider_transaction_id: string;
  provider_event_id: string | null;
  kind: string;
  energy_granted: number;
  channel: string;
  product_id: string;
};

function fakeDb(users: User[]) {
  const store = {
    users: users.map((u) => ({ ...u })),
    grants: [] as Grant[],
  };

  const query = async (text: string, params?: unknown[]) => {
    const empty = { rows: [] as unknown[], rowCount: 0, command: "SELECT", oid: 0, fields: [] };

    if (text.includes("FROM users WHERE id") && text.includes("paid_energy")) {
      const u = store.users.find((x) => x.id === params?.[0]);
      return {
        ...empty,
        rows: u ? [{ id: u.id, paid_energy: u.paid_energy, sub_active: u.sub_active }] : [],
        rowCount: u ? 1 : 0,
      };
    }

    if (text.includes("SELECT paid_energy FROM users") || text.includes("AS sub_active, paid_energy")) {
      const u = store.users.find((x) => x.id === params?.[0]);
      return {
        ...empty,
        rows: u ? [{ paid_energy: u.paid_energy, sub_active: u.sub_active }] : [],
        rowCount: u ? 1 : 0,
      };
    }

    if (text.includes("SELECT id FROM users")) {
      const u = store.users.find((x) => x.id === params?.[0]);
      return { ...empty, rows: u ? [{ id: u.id }] : [], rowCount: u ? 1 : 0 };
    }

    if (text.includes("FROM entitlement_grants") && text.includes("provider_transaction_id")) {
      const g = store.grants.find(
        (x) => x.provider === params?.[0] && x.provider_transaction_id === params?.[1],
      );
      return {
        ...empty,
        rows: g ? [{ id: g.id, energy_granted: g.energy_granted, kind: g.kind }] : [],
        rowCount: g ? 1 : 0,
      };
    }

    if (text.includes("FROM entitlement_grants") && text.includes("provider_event_id")) {
      const g = store.grants.find(
        (x) => x.provider === params?.[0] && x.provider_event_id === params?.[1],
      );
      return {
        ...empty,
        rows: g ? [{ id: g.id, energy_granted: g.energy_granted, kind: g.kind }] : [],
        rowCount: g ? 1 : 0,
      };
    }

    if (text.includes("INSERT INTO entitlement_grants")) {
      const provider = String(params?.[3]);
      const txn = String(params?.[8]);
      if (store.grants.some((g) => g.provider === provider && g.provider_transaction_id === txn)) {
        return { ...empty, rows: [], rowCount: 0, command: "INSERT" };
      }
      const row: Grant = {
        id: String(params?.[0]),
        provider,
        channel: String(params?.[2]),
        product_id: String(params?.[4]),
        kind: String(params?.[5]),
        energy_granted: Number(params?.[6]),
        provider_event_id: (params?.[7] as string | null) ?? null,
        provider_transaction_id: txn,
      };
      store.grants.push(row);
      return { ...empty, rows: [{ id: row.id }], rowCount: 1, command: "INSERT" };
    }

    if (text.includes("UPDATE users SET paid_energy = paid_energy +")) {
      const u = store.users.find((x) => x.id === params?.[1]);
      if (u) u.paid_energy += Number(params?.[0]);
      return { ...empty, rowCount: u ? 1 : 0, command: "UPDATE" };
    }

    if (text.includes("UPDATE users SET sub_active = TRUE")) {
      const u = store.users.find((x) => x.id === params?.[0]);
      if (u) u.sub_active = true;
      return { ...empty, rowCount: u ? 1 : 0, command: "UPDATE" };
    }

    if (text.includes("UPDATE users SET sub_active = FALSE") || text.includes("UPDATE users SET sub_active = $1")) {
      const active = typeof params?.[0] === "boolean" ? params[0] : false;
      const id = String(params?.[typeof params?.[0] === "boolean" ? 1 : 0]);
      const u = store.users.find((x) => x.id === id);
      if (u) u.sub_active = Boolean(active);
      return { ...empty, rowCount: u ? 1 : 0, command: "UPDATE" };
    }

    return empty;
  };

  return { query, store } as unknown as Queryable & { store: typeof store };
}

describe("applyEntitlementGrant (CC-47)", () => {
  it("credits the same paid_energy across store + web channels", async () => {
    const db = fakeDb([{ id: "u1", paid_energy: 0, sub_active: false }]);
    const catalog = unifiedShopCatalog();
    const small = catalog.packs[0]!;

    const ios = await applyEntitlementGrant(db, {
      userId: "u1",
      channel: "app_store",
      provider: "revenuecat",
      productId: small.iosProductId,
      kind: "pack",
      energyGranted: small.energy,
      providerTransactionId: "ios-txn-1",
    });
    assert.equal(ios.ok, true);
    if (!ios.ok) return;
    assert.equal(ios.paidEnergy, 200);

    const web = await applyEntitlementGrant(db, {
      userId: "u1",
      channel: "web",
      provider: "iyzico",
      productId: small.webProductId,
      kind: "pack",
      energyGranted: small.energy,
      providerTransactionId: "web-pay-1",
      checkoutId: "c1",
    });
    assert.equal(web.ok, true);
    if (!web.ok) return;
    assert.equal(web.paidEnergy, 400);
  });

  it("is idempotent on provider transaction id", async () => {
    const db = fakeDb([{ id: "u1", paid_energy: 0, sub_active: false }]);
    const input = {
      userId: "u1",
      channel: "play_store" as const,
      provider: "revenuecat" as const,
      productId: "cc_android_pack_small_200",
      kind: "pack" as const,
      energyGranted: 200,
      providerTransactionId: "dup-1",
    };
    const a = await applyEntitlementGrant(db, input);
    const b = await applyEntitlementGrant(db, input);
    assert.equal(a.ok && a.alreadyGranted, false);
    assert.equal(b.ok && b.alreadyGranted, true);
    assert.equal(a.ok && a.paidEnergy, 200);
    assert.equal(b.ok && b.paidEnergy, 200);
  });

  it("activates subscription on either channel", async () => {
    const db = fakeDb([{ id: "u1", paid_energy: 10, sub_active: false }]);
    const sub = unifiedShopCatalog().subscription;
    const res = await applyEntitlementGrant(db, {
      userId: "u1",
      channel: "web",
      provider: "iyzico",
      productId: sub.webProductId,
      kind: "subscription",
      energyGranted: 0,
      providerTransactionId: "sub-1",
    });
    assert.equal(res.ok && res.subActive, true);
  });

  it("setSubActive toggles entitlement flag", async () => {
    const db = fakeDb([{ id: "u1", paid_energy: 0, sub_active: true }]);
    const res = await setSubActive(db, "u1", false);
    assert.deepEqual(res, { ok: true, subActive: false });
  });
});

describe("unifiedShopCatalog (CC-48)", () => {
  it("exposes ios/android/web product ids per pack", () => {
    const shop = unifiedShopCatalog();
    assert.equal(shop.provider, "unified");
    assert.equal(shop.packs.length, 3);
    for (const p of shop.packs) {
      assert.ok(p.iosProductId.startsWith("cc_"));
      assert.ok(p.androidProductId.startsWith("cc_"));
      assert.ok(p.webProductId.startsWith("cc_"));
      assert.equal(p.tryListingStatus, "tbd");
    }
    assert.equal(shop.subscription.dailyBonus, 50);
  });
});
