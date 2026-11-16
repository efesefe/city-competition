import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  energyGrantTriggersEnabled,
  forceGrantDaily,
  maybeGrantDailyEnergy,
  runDailyFreeEnergyJob,
} from "./energy.js";
import type { Queryable } from "./db.js";

type User = {
  id: string;
  phone_verified: boolean;
  free_energy: number;
  free_grant_date: string | null;
  paid_energy: number;
  sub_energy: number;
};

function fakeDb(users: User[], grantAmount = 100): Queryable & { users: User[] } {
  const store = { users: users.map((u) => ({ ...u })) };
  const query = async (text: string, params?: unknown[]) => {
      if (text.includes("FROM tunables") && params?.[0] === "free_daily_grant") {
        return { rows: [{ value: String(grantAmount) }], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
      }
      if (text.includes("SELECT free_grant_date, phone_verified, free_energy")) {
        const u = store.users.find((x) => x.id === params?.[0]);
        return {
          rows: u
            ? [
                {
                  free_grant_date: u.free_grant_date,
                  phone_verified: u.phone_verified,
                  free_energy: u.free_energy,
                },
              ]
            : [],
          rowCount: u ? 1 : 0,
          command: "SELECT",
          oid: 0,
          fields: [],
        };
      }
      if (text.includes("SELECT free_energy FROM users")) {
        const u = store.users.find((x) => x.id === params?.[0]);
        return {
          rows: u ? [{ free_energy: u.free_energy }] : [],
          rowCount: u ? 1 : 0,
          command: "SELECT",
          oid: 0,
          fields: [],
        };
      }
      if (text.includes("SELECT id, free_grant_date FROM users WHERE phone_verified")) {
        const rows = store.users
          .filter((u) => u.phone_verified)
          .map((u) => ({ id: u.id, free_grant_date: u.free_grant_date }));
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
      throw new Error(`unexpected query: ${text}`);
  };
  return {
    users: store.users,
    query: query as Queryable["query"],
  };
}

describe("daily free energy grant", () => {
  const trNoon = new Date("2026-11-16T09:00:00.000Z"); // 12:00 TR

  it("grants 100 and expires leftover free energy (no bank)", async () => {
    const db = fakeDb([
      {
        id: "u1",
        phone_verified: true,
        free_energy: 40,
        free_grant_date: "2026-11-15",
        paid_energy: 200,
        sub_energy: 50,
      },
    ]);
    const result = await maybeGrantDailyEnergy(db, "u1", trNoon);
    assert.deepEqual(result, {
      granted: true,
      amount: 100,
      date: "2026-11-16",
      expiredPreviousFree: true,
    });
    assert.equal(db.users[0]!.free_energy, 100);
    assert.equal(db.users[0]!.free_grant_date, "2026-11-16");
    assert.equal(db.users[0]!.paid_energy, 200);
    assert.equal(db.users[0]!.sub_energy, 50);
  });

  it("is idempotent within the same TR date", async () => {
    const db = fakeDb([
      {
        id: "u1",
        phone_verified: true,
        free_energy: 100,
        free_grant_date: "2026-11-16",
        paid_energy: 0,
        sub_energy: 0,
      },
    ]);
    const result = await maybeGrantDailyEnergy(db, "u1", trNoon);
    assert.deepEqual(result, { granted: false, reason: "already_granted" });
    assert.equal(db.users[0]!.free_energy, 100);
  });

  it("skips unverified phones on lazy grant", async () => {
    const db = fakeDb([
      {
        id: "u1",
        phone_verified: false,
        free_energy: 0,
        free_grant_date: null,
        paid_energy: 0,
        sub_energy: 0,
      },
    ]);
    const result = await maybeGrantDailyEnergy(db, "u1", trNoon);
    assert.deepEqual(result, { granted: false, reason: "phone_unverified" });
  });

  it("forceGrantDaily re-grants without waiting for midnight", async () => {
    const db = fakeDb([
      {
        id: "u1",
        phone_verified: true,
        free_energy: 12,
        free_grant_date: "2026-11-16",
        paid_energy: 0,
        sub_energy: 0,
      },
    ]);
    const result = await forceGrantDaily(db, "u1", trNoon);
    assert.equal(result.granted, true);
    assert.equal(result.amount, 100);
    assert.equal(result.expiredPreviousFree, true);
    assert.equal(db.users[0]!.free_energy, 100);
  });

  it("batch job grants only users missing today's TR date", async () => {
    const db = fakeDb([
      {
        id: "a",
        phone_verified: true,
        free_energy: 5,
        free_grant_date: "2026-11-15",
        paid_energy: 0,
        sub_energy: 0,
      },
      {
        id: "b",
        phone_verified: true,
        free_energy: 100,
        free_grant_date: "2026-11-16",
        paid_energy: 0,
        sub_energy: 0,
      },
      {
        id: "c",
        phone_verified: false,
        free_energy: 0,
        free_grant_date: null,
        paid_energy: 0,
        sub_energy: 0,
      },
    ]);
    const job = await runDailyFreeEnergyJob(db, { now: trNoon });
    assert.equal(job.timezone, "Europe/Istanbul");
    assert.equal(job.date, "2026-11-16");
    assert.equal(job.amount, 100);
    assert.equal(job.scanned, 2);
    assert.equal(job.granted, 1);
    assert.equal(job.skippedAlreadyGranted, 1);
    assert.equal(db.users.find((u) => u.id === "a")!.free_energy, 100);
    assert.equal(db.users.find((u) => u.id === "b")!.free_energy, 100);
    assert.equal(db.users.find((u) => u.id === "c")!.free_energy, 0);
  });

  it("batch force re-applies expire-then-grant to all verified users", async () => {
    const db = fakeDb([
      {
        id: "a",
        phone_verified: true,
        free_energy: 7,
        free_grant_date: "2026-11-16",
        paid_energy: 10,
        sub_energy: 0,
      },
    ]);
    const job = await runDailyFreeEnergyJob(db, { now: trNoon, force: true });
    assert.equal(job.granted, 1);
    assert.equal(job.force, true);
    assert.equal(db.users[0]!.free_energy, 100);
    assert.equal(db.users[0]!.paid_energy, 10);
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
