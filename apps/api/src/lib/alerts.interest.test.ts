import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAttackInterests } from "./alerts.js";
import type { Queryable } from "./db.js";

function mockDb(handlers: Array<{ match: RegExp; rows: unknown[] }>): Queryable {
  return {
    query: async (text: string) => {
      const hit = handlers.find((h) => h.match.test(text));
      if (!hit) throw new Error(`unexpected query: ${text}`);
      return { rows: hit.rows, rowCount: hit.rows.length };
    },
  } as Queryable;
}

describe("resolveAttackInterests", () => {
  it("returns owned members and 24h spenders with owned winning on overlap", async () => {
    const db = mockDb([
      {
        match: /FROM users\s+WHERE tribe_id/,
        rows: [
          { id: "owner-1", tribe_id: "tribe_a" },
          { id: "both-user", tribe_id: "tribe_a" },
        ],
      },
      {
        match: /FROM support_ledger/,
        rows: [
          { id: "spent-1", tribe_id: "tribe_c" },
          { id: "both-user", tribe_id: "tribe_a" },
        ],
      },
    ]);

    const interests = await resolveAttackInterests(db, {
      plate: "35",
      spenderUserId: "attacker",
      spenderTribeId: "tribe_b",
      ownerTribeId: "tribe_a",
      now: new Date("2026-11-16T12:00:00.000Z"),
    });

    const byId = Object.fromEntries(interests.map((i) => [i.userId, i.scope]));
    assert.equal(byId["owner-1"], "owned");
    assert.equal(byId["both-user"], "owned");
    assert.equal(byId["spent-1"], "spent_24h");
    assert.equal(interests.length, 3);
  });

  it("skips owned scope when spender already owns the city", async () => {
    const db = mockDb([
      {
        match: /FROM support_ledger/,
        rows: [{ id: "rival-spender-friend", tribe_id: "tribe_c" }],
      },
    ]);

    const interests = await resolveAttackInterests(db, {
      plate: "06",
      spenderUserId: "attacker",
      spenderTribeId: "tribe_a",
      ownerTribeId: "tribe_a",
    });

    assert.deepEqual(interests, [
      { userId: "rival-spender-friend", tribeId: "tribe_c", scope: "spent_24h" },
    ]);
  });
});
