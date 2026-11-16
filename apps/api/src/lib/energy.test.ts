import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  energyGrantTriggersEnabled,
  forceGrantDaily,
  maybeGrantDailyEnergy,
  runDailyFreeEnergyJob,
  setSubEntitlement,
} from "./energy.js";
import type { Queryable } from "./db.js";

type User = {
  id: string;
  phone_verified: boolean;
  free_energy: number;
  free_grant_date: string | null;
  paid_energy: number;
  sub_energy: number;
  sub_active: boolean;
  sub_grant_date: string | null;
};

function fakeDb(
  users: User[],
  amounts: { free?: number; sub?: number } = {},
): Queryable & { users: User[] } {
  const grantAmount = amounts.free ?? 100;
  const subBonusAmount = amounts.sub ?? 50;
  const store = { users: users.map((u) => ({ ...u })) };
  const query = async (text: string, params?: unknown[]) => {
    if (text.includes("FROM tunables") && params?.[0] === "free_daily_grant") {
      return {
        rows: [{ value: String(grantAmount) }],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: [],
      };
    }
    if (text.includes("FROM tunables") && params?.[0] === "sub_daily_bonus") {
      return {
        rows: [{ value: String(subBonusAmount) }],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: [],
      };
    }
    if (text.includes("SELECT free_grant_date, phone_verified, free_energy, sub_energy, sub_active, sub_grant_date")) {
      const u = store.users.find((x) => x.id === params?.[0]);
      return {
        rows: u
          ? [
              {
                free_grant_date: u.free_grant_date,
                phone_verified: u.phone_verified,
                free_energy: u.free_energy,
                sub_energy: u.sub_energy,
                sub_active: u.sub_active,
                sub_grant_date: u.sub_grant_date,
              },
            ]
          : [],
        rowCount: u ? 1 : 0,
        command: "SELECT",
        oid: 0,
        fields: [],
      };
    }
    if (text.includes("SELECT free_energy, sub_energy, sub_active, sub_grant_date FROM users")) {
      const u = store.users.find((x) => x.id === params?.[0]);
      return {
        rows: u
          ? [
              {
                free_energy: u.free_energy,
                sub_energy: u.sub_energy,
                sub_active: u.sub_active,
                sub_grant_date: u.sub_grant_date,
              },
            ]
          : [],
        rowCount: u ? 1 : 0,
        command: "SELECT",
        oid: 0,
        fields: [],
      };
    }
    if (text.includes("SELECT id FROM users WHERE id")) {
      const u = store.users.find((x) => x.id === params?.[0]);
      return {
        rows: u ? [{ id: u.id }] : [],
        rowCount: u ? 1 : 0,
        command: "SELECT",
        oid: 0,
        fields: [],
      };
    }
    if (
      text.includes(
        "SELECT id, free_grant_date, free_energy, sub_energy, sub_active, sub_grant_date",
      )
    ) {
      const rows = store.users
        .filter((u) => u.phone_verified)
        .map((u) => ({
          id: u.id,
          free_grant_date: u.free_grant_date,
          free_energy: u.free_energy,
          sub_energy: u.sub_energy,
          sub_active: u.sub_active,
          sub_grant_date: u.sub_grant_date,
        }));
      return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
    }
    if (text.startsWith("UPDATE users SET free_energy")) {
      const [energy, date, id] = params as [number, string, string];
      const u = store.users.find((x) => x.id === id);
      if (u) {
        u.free_energy = energy;
        u.free_grant_date = date;
      }
      return { rows: [], rowCount: u ? 1 : 0, command: "UPDATE", oid: 0, fields: [] };
    }
    if (text.startsWith("UPDATE users SET sub_energy")) {
      const [energy, date, id] = params as [number, string, string];
      const u = store.users.find((x) => x.id === id);
      if (u) {
        u.sub_energy = energy;
        u.sub_grant_date = date;
      }
      return { rows: [], rowCount: u ? 1 : 0, command: "UPDATE", oid: 0, fields: [] };
    }
    if (text.startsWith("UPDATE users SET sub_active")) {
      const [active, id] = params as [boolean, string];
      const u = store.users.find((x) => x.id === id);
      if (u) u.sub_active = active;
      return { rows: [], rowCount: u ? 1 : 0, command: "UPDATE", oid: 0, fields: [] };
    }
    throw new Error(`unexpected query: ${text}`);
  };
  return {
    users: store.users,
    query: query as Queryable["query"],
  };
}

function baseUser(partial: Partial<User> & { id: string }): User {
  return {
    phone_verified: true,
    free_energy: 0,
    free_grant_date: null,
    paid_energy: 0,
    sub_energy: 0,
    sub_active: false,
    sub_grant_date: null,
    ...partial,
  };
}

describe("daily free energy grant", () => {
  const trNoon = new Date("2026-11-16T09:00:00.000Z"); // 12:00 TR

  it("grants 100 and expires leftover free energy (no bank)", async () => {
    const db = fakeDb([
      baseUser({
        id: "u1",
        free_energy: 40,
        free_grant_date: "2026-11-15",
        paid_energy: 200,
        sub_energy: 50,
      }),
    ]);
    const result = await maybeGrantDailyEnergy(db, "u1", trNoon);
    assert.equal(result.granted, true);
    if (result.granted) {
      assert.equal(result.amount, 100);
      assert.equal(result.date, "2026-11-16");
      assert.equal(result.expiredPreviousFree, true);
      assert.deepEqual(result.subBonus, { granted: false, reason: "not_subscriber" });
    }
    assert.equal(db.users[0]!.free_energy, 100);
    assert.equal(db.users[0]!.free_grant_date, "2026-11-16");
    assert.equal(db.users[0]!.paid_energy, 200);
    assert.equal(db.users[0]!.sub_energy, 50);
  });

  it("is idempotent within the same TR date", async () => {
    const db = fakeDb([
      baseUser({
        id: "u1",
        free_energy: 100,
        free_grant_date: "2026-11-16",
      }),
    ]);
    const result = await maybeGrantDailyEnergy(db, "u1", trNoon);
    assert.deepEqual(result, {
      granted: false,
      reason: "already_granted",
      subBonus: { granted: false, reason: "not_subscriber" },
    });
    assert.equal(db.users[0]!.free_energy, 100);
  });

  it("skips unverified phones on lazy grant", async () => {
    const db = fakeDb([
      baseUser({
        id: "u1",
        phone_verified: false,
      }),
    ]);
    const result = await maybeGrantDailyEnergy(db, "u1", trNoon);
    assert.equal(result.granted, false);
    if (!result.granted) assert.equal(result.reason, "phone_unverified");
  });

  it("forceGrantDaily re-grants without waiting for midnight", async () => {
    const db = fakeDb([
      baseUser({
        id: "u1",
        free_energy: 12,
        free_grant_date: "2026-11-16",
      }),
    ]);
    const result = await forceGrantDaily(db, "u1", trNoon);
    assert.equal(result.granted, true);
    assert.equal(result.amount, 100);
    assert.equal(result.expiredPreviousFree, true);
    assert.equal(db.users[0]!.free_energy, 100);
  });

  it("batch job grants only users missing today's TR date", async () => {
    const db = fakeDb([
      baseUser({ id: "a", free_energy: 5, free_grant_date: "2026-11-15" }),
      baseUser({ id: "b", free_energy: 100, free_grant_date: "2026-11-16" }),
      baseUser({ id: "c", phone_verified: false }),
    ]);
    const job = await runDailyFreeEnergyJob(db, { now: trNoon });
    assert.equal(job.timezone, "Europe/Istanbul");
    assert.equal(job.date, "2026-11-16");
    assert.equal(job.amount, 100);
    assert.equal(job.freeAmount, 100);
    assert.equal(job.scanned, 2);
    assert.equal(job.granted, 1);
    assert.equal(job.skippedAlreadyGranted, 1);
    assert.equal(db.users.find((u) => u.id === "a")!.free_energy, 100);
    assert.equal(db.users.find((u) => u.id === "b")!.free_energy, 100);
    assert.equal(db.users.find((u) => u.id === "c")!.free_energy, 0);
  });

  it("batch force re-applies expire-then-grant to all verified users", async () => {
    const db = fakeDb([
      baseUser({
        id: "a",
        free_energy: 7,
        free_grant_date: "2026-11-16",
        paid_energy: 10,
      }),
    ]);
    const job = await runDailyFreeEnergyJob(db, { now: trNoon, force: true });
    assert.equal(job.granted, 1);
    assert.equal(job.force, true);
    assert.equal(db.users[0]!.free_energy, 100);
    assert.equal(db.users[0]!.paid_energy, 10);
  });
});

describe("sub daily +50 bonus (same TR midnight clock)", () => {
  const trNoon = new Date("2026-11-16T09:00:00.000Z");

  it("stacks free 100 + sub 50 for active subscribers", async () => {
    const db = fakeDb([
      baseUser({
        id: "sub1",
        free_energy: 20,
        free_grant_date: "2026-11-15",
        sub_energy: 10,
        sub_active: true,
        sub_grant_date: "2026-11-15",
        paid_energy: 200,
      }),
    ]);
    const result = await maybeGrantDailyEnergy(db, "sub1", trNoon);
    assert.equal(result.granted, true);
    if (result.granted) {
      assert.equal(result.amount, 100);
      assert.deepEqual(result.subBonus, {
        granted: true,
        amount: 50,
        date: "2026-11-16",
        expiredPreviousSub: true,
      });
    }
    assert.equal(db.users[0]!.free_energy, 100);
    assert.equal(db.users[0]!.sub_energy, 50);
    assert.equal(db.users[0]!.sub_grant_date, "2026-11-16");
    assert.equal(db.users[0]!.paid_energy, 200);
  });

  it("does not grant sub bonus to non-subscribers", async () => {
    const db = fakeDb([
      baseUser({
        id: "free1",
        free_grant_date: "2026-11-15",
        sub_active: false,
        sub_energy: 0,
      }),
    ]);
    const result = await maybeGrantDailyEnergy(db, "free1", trNoon);
    assert.equal(result.granted, true);
    if (result.granted) {
      assert.deepEqual(result.subBonus, { granted: false, reason: "not_subscriber" });
    }
    assert.equal(db.users[0]!.sub_energy, 0);
    assert.equal(db.users[0]!.sub_grant_date, null);
  });

  it("sub bonus is idempotent within the same TR date", async () => {
    const db = fakeDb([
      baseUser({
        id: "sub1",
        free_energy: 100,
        free_grant_date: "2026-11-16",
        sub_active: true,
        sub_energy: 50,
        sub_grant_date: "2026-11-16",
      }),
    ]);
    const result = await maybeGrantDailyEnergy(db, "sub1", trNoon);
    assert.equal(result.granted, false);
    assert.deepEqual(result.subBonus, { granted: false, reason: "already_granted" });
    assert.equal(db.users[0]!.sub_energy, 50);
  });

  it("batch job grants free to all verified and +50 only to active subs", async () => {
    const db = fakeDb([
      baseUser({
        id: "sub",
        free_grant_date: "2026-11-15",
        sub_active: true,
        sub_energy: 5,
        sub_grant_date: "2026-11-15",
      }),
      baseUser({
        id: "free",
        free_grant_date: "2026-11-15",
        sub_active: false,
      }),
      baseUser({
        id: "already",
        free_energy: 100,
        free_grant_date: "2026-11-16",
        sub_active: true,
        sub_energy: 50,
        sub_grant_date: "2026-11-16",
      }),
    ]);
    const job = await runDailyFreeEnergyJob(db, { now: trNoon });
    assert.equal(job.granted, 2);
    assert.equal(job.skippedAlreadyGranted, 1);
    assert.equal(job.subBonusAmount, 50);
    assert.equal(job.subBonusGranted, 1);
    assert.equal(job.subBonusSkipped, 2); // free (not_subscriber) + already
    assert.equal(db.users.find((u) => u.id === "sub")!.free_energy, 100);
    assert.equal(db.users.find((u) => u.id === "sub")!.sub_energy, 50);
    assert.equal(db.users.find((u) => u.id === "free")!.free_energy, 100);
    assert.equal(db.users.find((u) => u.id === "free")!.sub_energy, 0);
    assert.equal(db.users.find((u) => u.id === "already")!.sub_energy, 50);
  });

  it("force batch re-grants free + sub bonus", async () => {
    const db = fakeDb([
      baseUser({
        id: "sub",
        free_energy: 3,
        free_grant_date: "2026-11-16",
        sub_active: true,
        sub_energy: 7,
        sub_grant_date: "2026-11-16",
        paid_energy: 40,
      }),
    ]);
    const job = await runDailyFreeEnergyJob(db, { now: trNoon, force: true });
    assert.equal(job.granted, 1);
    assert.equal(job.subBonusGranted, 1);
    assert.equal(db.users[0]!.free_energy, 100);
    assert.equal(db.users[0]!.sub_energy, 50);
    assert.equal(db.users[0]!.paid_energy, 40);
  });

  it("setSubEntitlement toggles flag for ops without payments", async () => {
    const db = fakeDb([baseUser({ id: "u1" })]);
    const on = await setSubEntitlement(db, "u1", true);
    assert.deepEqual(on, { ok: true, userId: "u1", subActive: true });
    assert.equal(db.users[0]!.sub_active, true);
    const off = await setSubEntitlement(db, "u1", false);
    assert.equal(off.ok, true);
    assert.equal(db.users[0]!.sub_active, false);
    const missing = await setSubEntitlement(db, "nope", true);
    assert.deepEqual(missing, { ok: false, reason: "user_not_found" });
  });

  it("forceGrantDaily includes sub bonus when entitled", async () => {
    const db = fakeDb([
      baseUser({
        id: "sub",
        free_energy: 1,
        free_grant_date: "2026-11-16",
        sub_active: true,
        sub_energy: 2,
        sub_grant_date: "2026-11-16",
      }),
    ]);
    const result = await forceGrantDaily(db, "sub", trNoon);
    assert.equal(result.amount, 100);
    assert.deepEqual(result.subBonus, {
      granted: true,
      amount: 50,
      date: "2026-11-16",
      expiredPreviousSub: true,
    });
    assert.equal(db.users[0]!.sub_energy, 50);
  });
});

describe("energyGrantTriggersEnabled", () => {
  it("defaults off in production unless explicitly allowed", () => {
    const prevNode = process.env.NODE_ENV;
    const prevAllow = process.env.ALLOW_ENERGY_GRANT_TRIGGERS;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.ALLOW_ENERGY_GRANT_TRIGGERS;
      assert.equal(energyGrantTriggersEnabled(), false);
      process.env.ALLOW_ENERGY_GRANT_TRIGGERS = "true";
      assert.equal(energyGrantTriggersEnabled(), true);
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevAllow === undefined) delete process.env.ALLOW_ENERGY_GRANT_TRIGGERS;
      else process.env.ALLOW_ENERGY_GRANT_TRIGGERS = prevAllow;
    }
  });
});
