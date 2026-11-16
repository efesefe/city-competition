import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  androidPackOffers,
  androidSubOffer,
  iosPackOffers,
  iosSubOffer,
  lookupPackByProductId,
  shopCatalog,
} from "./iapCatalog.js";
import { applyIapGrant } from "./iapEntitlements.js";
import {
  parseRevenueCatWebhook,
  verifyRevenueCatAuthorization,
} from "./revenuecatWebhook.js";
import type { Queryable } from "./db.js";

type User = {
  id: string;
  paid_energy: number;
  sub_active: boolean;
};

type GrantRow = {
  id: string;
  user_id: string;
  product_id: string;
  kind: string;
  energy_granted: number;
  provider_event_id: string | null;
  provider_transaction_id: string;
};

function fakeDb(users: User[]): Queryable & { users: User[]; grants: GrantRow[] } {
  const store = {
    users: users.map((u) => ({ ...u })),
    grants: [] as GrantRow[],
  };

  const query = async (text: string, params?: unknown[]) => {
    const empty = { rows: [] as unknown[], rowCount: 0, command: "SELECT", oid: 0, fields: [] };

    if (text.includes("SELECT id, paid_energy, sub_active FROM users")) {
      const u = store.users.find((x) => x.id === params?.[0]);
      return {
        ...empty,
        rows: u ? [{ id: u.id, paid_energy: u.paid_energy, sub_active: u.sub_active }] : [],
        rowCount: u ? 1 : 0,
      };
    }

    if (text.includes("SELECT id, energy_granted FROM iap_grants WHERE provider_transaction_id")) {
      const g = store.grants.find((x) => x.provider_transaction_id === params?.[0]);
      return {
        ...empty,
        rows: g ? [{ id: g.id, energy_granted: g.energy_granted }] : [],
        rowCount: g ? 1 : 0,
      };
    }

    if (text.includes("SELECT id, energy_granted, kind FROM iap_grants WHERE provider_transaction_id")) {
      const g = store.grants.find((x) => x.provider_transaction_id === params?.[0]);
      return {
        ...empty,
        rows: g ? [{ id: g.id, energy_granted: g.energy_granted, kind: g.kind }] : [],
        rowCount: g ? 1 : 0,
      };
    }

    if (text.includes("SELECT id, energy_granted, kind FROM iap_grants WHERE provider_event_id")) {
      const g = store.grants.find((x) => x.provider_event_id === params?.[0]);
      return {
        ...empty,
        rows: g ? [{ id: g.id, energy_granted: g.energy_granted, kind: g.kind }] : [],
        rowCount: g ? 1 : 0,
      };
    }

    if (text.includes("SELECT sub_active FROM users")) {
      const u = store.users.find((x) => x.id === params?.[0]);
      return {
        ...empty,
        rows: u ? [{ sub_active: u.sub_active }] : [],
        rowCount: u ? 1 : 0,
      };
    }

    if (text.includes("INSERT INTO iap_grants")) {
      const existing = store.grants.find((g) => g.provider_transaction_id === params?.[7]);
      if (existing) {
        return { ...empty, rows: [], rowCount: 0, command: "INSERT" };
      }
      const row: GrantRow = {
        id: String(params?.[0]),
        user_id: String(params?.[1]),
        product_id: String(params?.[3]),
        kind: String(params?.[4]),
        energy_granted: Number(params?.[5]),
        provider_event_id: (params?.[6] as string | null) ?? null,
        provider_transaction_id: String(params?.[7]),
      };
      store.grants.push(row);
      return {
        ...empty,
        rows: text.includes("RETURNING") ? [{ id: row.id }] : [],
        rowCount: 1,
        command: "INSERT",
      };
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

    if (text.includes("UPDATE users SET sub_active = FALSE")) {
      const u = store.users.find((x) => x.id === params?.[0]);
      if (u) u.sub_active = false;
      return { ...empty, rowCount: u ? 1 : 0, command: "UPDATE" };
    }

    if (text.includes("UPDATE users SET sub_active = $1")) {
      const u = store.users.find((x) => x.id === params?.[1]);
      if (u) u.sub_active = Boolean(params?.[0]);
      return { ...empty, rowCount: u ? 1 : 0, command: "UPDATE" };
    }

    throw new Error(`unexpected query: ${text.slice(0, 120)}`);
  };

  return Object.assign({ query }, store) as Queryable & { users: User[]; grants: GrantRow[] };
}

describe("iapCatalog env defaults", () => {
  const keys = [
    "RC_IOS_PRODUCT_PACK_SMALL",
    "RC_IOS_PRODUCT_PACK_MEDIUM",
    "RC_IOS_PRODUCT_PACK_LARGE",
    "RC_IOS_PRODUCT_SUB_MONTHLY",
    "RC_ENTITLEMENT_SUB",
  ];
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it("maps economy-sheet pack energies 200/600/1500", () => {
    const packs = iosPackOffers();
    assert.deepEqual(
      packs.map((p) => p.energy),
      [200, 600, 1500],
    );
    assert.equal(iosSubOffer().dailyBonus, 50);
  });

  it("overrides product ids from env", () => {
    process.env.RC_IOS_PRODUCT_PACK_SMALL = "custom.small";
    process.env.RC_IOS_PRODUCT_SUB_MONTHLY = "custom.sub";
    process.env.RC_ENTITLEMENT_SUB = "vip";
    assert.equal(lookupPackByProductId("custom.small")?.energy, 200);
    assert.equal(iosSubOffer().productId, "custom.sub");
    assert.equal(iosSubOffer().entitlementId, "vip");
    assert.equal(shopCatalog().provider, "revenuecat");
  });
});

describe("applyIapGrant", () => {
  it("credits paid_energy for a pack once", async () => {
    const db = fakeDb([{ id: "u1", paid_energy: 10, sub_active: false }]);
    const productId = iosPackOffers()[0]!.productId;
    const first = await applyIapGrant(db, {
      userId: "u1",
      productId,
      transactionId: "txn_1",
      eventId: "evt_1",
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.alreadyGranted, false);
    assert.equal(first.energyGranted, 200);
    assert.equal(db.users[0]!.paid_energy, 210);

    const second = await applyIapGrant(db, {
      userId: "u1",
      productId,
      transactionId: "txn_1",
      eventId: "evt_1",
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.alreadyGranted, true);
    assert.equal(db.users[0]!.paid_energy, 210);
  });

  it("activates subscription entitlement without energy credit", async () => {
    const db = fakeDb([{ id: "u1", paid_energy: 0, sub_active: false }]);
    const res = await applyIapGrant(db, {
      userId: "u1",
      productId: iosSubOffer().productId,
      transactionId: "sub_txn",
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.kind, "subscription");
    assert.equal(res.energyGranted, 0);
    assert.equal(res.subActive, true);
    assert.equal(db.users[0]!.sub_active, true);
    assert.equal(db.users[0]!.paid_energy, 0);
  });

  it("deactivates subscription on expire marker", async () => {
    const db = fakeDb([{ id: "u1", paid_energy: 0, sub_active: true }]);
    const res = await applyIapGrant(db, {
      userId: "u1",
      productId: iosSubOffer().productId,
      transactionId: "expire:orig",
      deactivateSub: true,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.subActive, false);
    assert.equal(db.users[0]!.sub_active, false);
  });
});

describe("revenuecatWebhook", () => {
  it("verifies authorization header", () => {
    process.env.REVENUECAT_WEBHOOK_AUTHORIZATION = "sekrit";
    assert.equal(verifyRevenueCatAuthorization("sekrit"), true);
    assert.equal(verifyRevenueCatAuthorization("Bearer sekrit"), true);
    assert.equal(verifyRevenueCatAuthorization("nope"), false);
    delete process.env.REVENUECAT_WEBHOOK_AUTHORIZATION;
  });

  it("parses pack purchase for app_store", () => {
    const productId = iosPackOffers()[1]!.productId;
    const parsed = parseRevenueCatWebhook({
      event: {
        type: "NON_RENEWING_PURCHASE",
        id: "evt_pack",
        app_user_id: "user_abc",
        product_id: productId,
        store: "APP_STORE",
        environment: "SANDBOX",
        transaction_id: "1000001",
      },
    });
    assert.equal(parsed.action, "grant");
    if (parsed.action !== "grant") return;
    assert.equal(parsed.productId, productId);
    assert.equal(parsed.userId, "user_abc");
  });

  it("parses subscription expiration", () => {
    const parsed = parseRevenueCatWebhook({
      event: {
        type: "EXPIRATION",
        id: "evt_exp",
        app_user_id: "user_abc",
        product_id: iosSubOffer().productId,
        entitlement_ids: [iosSubOffer().entitlementId],
        store: "APP_STORE",
        transaction_id: "1000002",
      },
    });
    assert.equal(parsed.action, "deactivate_sub");
  });

  it("grants play store pack purchases (CC-45)", () => {
    const productId = androidPackOffers()[0]!.productId;
    const parsed = parseRevenueCatWebhook({
      event: {
        type: "INITIAL_PURCHASE",
        id: "evt_play",
        app_user_id: "user_abc",
        product_id: productId,
        store: "PLAY_STORE",
        transaction_id: "GPA.1",
      },
    });
    assert.equal(parsed.action, "grant");
    if (parsed.action !== "grant") return;
    assert.equal(parsed.store, "play_store");
    assert.equal(parsed.productId, productId);
  });

  it("activates android monthly sub via shared entitlement id", () => {
    const parsed = parseRevenueCatWebhook({
      event: {
        type: "INITIAL_PURCHASE",
        id: "evt_play_sub",
        app_user_id: "user_abc",
        product_id: androidSubOffer().productId,
        entitlement_ids: [androidSubOffer().entitlementId],
        store: "PLAY_STORE",
        transaction_id: "GPA.sub.1",
      },
    });
    assert.equal(parsed.action, "grant");
    if (parsed.action !== "grant") return;
    assert.equal(parsed.store, "play_store");
  });
});

describe("android catalog", () => {
  it("maps android pack energies and looks up by product id", () => {
    const packs = androidPackOffers();
    assert.deepEqual(
      packs.map((p) => p.energy),
      [200, 600, 1500],
    );
    assert.equal(lookupPackByProductId(packs[1]!.productId)?.sku, "medium");
    assert.equal(shopCatalog().packs[0]!.androidProductId, packs[0]!.productId);
  });
});
