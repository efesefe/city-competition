/**
 * CC-37 — concurrent load/smoke for idempotent spend.
 *
 * Requires DATABASE_URL + REDIS_URL (local docker compose or equivalent).
 * Run: npm run test:spend-load
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { nanoid } from "nanoid";
import { buildApp } from "../app.js";
import { upsertPhoneUser } from "./auth.js";
import { closeDb, getPool, initDb, one } from "./db.js";
import { spendEnergy } from "./game.js";
import { resetSingleFlightForTests } from "./idempotency.js";
import { closeRedis, getRedis } from "./redis.js";

const PLATE_A = "99";
const PLATE_B = "98";
const TRIBE_A = "sl_galatasaray";
const TRIBE_B = "sl_fenerbahce";
const AMOUNT = 10;

type EnergyRow = {
  free_energy: number;
  paid_energy: number;
  sub_energy: number;
};

async function ensureSyntheticCity(plate: string, nameTr: string) {
  const db = getPool();
  await db.query(
    `INSERT INTO cities (plate, name_tr, owner_team_id)
     VALUES ($1, $2, NULL)
     ON CONFLICT (plate) DO UPDATE SET owner_team_id = NULL, name_tr = EXCLUDED.name_tr`,
    [plate, nameTr],
  );
  await db.query(`DELETE FROM support_ledger WHERE city_plate = $1`, [plate]);
  await db.query(`DELETE FROM city_support WHERE city_plate = $1`, [plate]);
}

async function createReadyUser(opts: {
  tribeId: string;
  paidEnergy: number;
  phoneSuffix: string;
}) {
  const db = getPool();
  const id = nanoid();
  const handle = `load_${id.slice(0, 8)}`;
  const phone = `+90555${opts.phoneSuffix.padStart(7, "0").slice(-7)}`;
  await db.query(
    `INSERT INTO users
       (id, handle, phone_e164, phone_verified, tribe_id,
        free_energy, paid_energy, sub_energy, created_at)
     VALUES ($1, $2, $3, TRUE, $4, 0, $5, 0, $6)`,
    [id, handle, phone, opts.tribeId, opts.paidEnergy, new Date().toISOString()],
  );
  return id;
}

async function energyOf(userId: string): Promise<number> {
  const row = await one<EnergyRow>(
    getPool(),
    `SELECT free_energy, paid_energy, sub_energy FROM users WHERE id = $1`,
    [userId],
  );
  assert.ok(row);
  return Number(row.free_energy) + Number(row.paid_energy) + Number(row.sub_energy);
}

async function supportOf(plate: string, tribeId: string): Promise<number> {
  const row = await one<{ support: number }>(
    getPool(),
    `SELECT support FROM city_support WHERE city_plate = $1 AND team_id = $2`,
    [plate, tribeId],
  );
  return Number(row?.support ?? 0);
}

async function ledgerCount(plate: string): Promise<number> {
  const row = await one<{ c: string }>(
    getPool(),
    `SELECT COUNT(*)::text AS c FROM support_ledger WHERE city_plate = $1`,
    [plate],
  );
  return Number(row?.c ?? 0);
}

async function ledgerCountForKey(key: string): Promise<number> {
  const row = await one<{ c: string }>(
    getPool(),
    `SELECT COUNT(*)::text AS c FROM support_ledger WHERE idempotency_key = $1`,
    [key],
  );
  return Number(row?.c ?? 0);
}

describe("spend idempotency under contention (CC-37)", () => {
  before(async () => {
    process.env.PG_POOL_MAX = process.env.PG_POOL_MAX || "40";
    await initDb();
    await getRedis();
    await ensureSyntheticCity(PLATE_A, "Load City A");
    await ensureSyntheticCity(PLATE_B, "Load City B");
  });

  after(async () => {
    await closeRedis();
    await closeDb();
  });

  test("same idempotency key: N concurrent calls debit once (single-flight)", async () => {
    resetSingleFlightForTests();
    await ensureSyntheticCity(PLATE_A, "Load City A");
    const userId = await createReadyUser({
      tribeId: TRIBE_A,
      paidEnergy: 500,
      phoneSuffix: String(Math.floor(Math.random() * 9_000_000)),
    });
    const key = `idem-same-${nanoid(12)}`;
    const N = 40;
    const beforeEnergy = await energyOf(userId);

    const results = await Promise.all(
      Array.from({ length: N }, () =>
        spendEnergy(getPool(), {
          userId,
          plate: PLATE_A,
          amount: AMOUNT,
          idempotencyKey: key,
          confirmed: true,
        }),
      ),
    );

    assert.equal(results.length, N);
    assert.ok(results.every((r) => r.ok));
    assert.equal(await ledgerCountForKey(key), 1);
    assert.equal(await ledgerCount(PLATE_A), 1);
    assert.equal(await energyOf(userId), beforeEnergy - AMOUNT);
    assert.equal(await supportOf(PLATE_A, TRIBE_A), AMOUNT);

    for (const r of results) {
      if (!r.ok) continue;
      if ("energySpent" in r) assert.equal(r.energySpent, AMOUNT);
      if ("supportCredited" in r) assert.equal(r.supportCredited, AMOUNT);
    }
  });

  test("same idempotency key: DB race without single-flight still one debit", async () => {
    resetSingleFlightForTests();
    await ensureSyntheticCity(PLATE_A, "Load City A");
    const userId = await createReadyUser({
      tribeId: TRIBE_A,
      paidEnergy: 500,
      phoneSuffix: String(Math.floor(Math.random() * 9_000_000)),
    });
    const key = `idem-race-${nanoid(12)}`;
    const N = 24;
    const beforeEnergy = await energyOf(userId);

    const results = await Promise.all(
      Array.from({ length: N }, () =>
        spendEnergy(getPool(), {
          userId,
          plate: PLATE_A,
          amount: AMOUNT,
          idempotencyKey: key,
          confirmed: true,
          bypassSingleFlight: true,
        }),
      ),
    );

    assert.ok(results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok)));
    const replays = results.filter((r) => r.ok && "idempotentReplay" in r && r.idempotentReplay);
    assert.ok(replays.length >= 1, "expected at least one idempotentReplay from the race");
    assert.equal(await ledgerCountForKey(key), 1);
    assert.equal(await energyOf(userId), beforeEnergy - AMOUNT);
    assert.equal(await supportOf(PLATE_A, TRIBE_A), AMOUNT);
  });

  test("distinct keys: concurrent spends tally and debit correctly", async () => {
    resetSingleFlightForTests();
    await ensureSyntheticCity(PLATE_A, "Load City A");
    const N = 25;
    const userId = await createReadyUser({
      tribeId: TRIBE_A,
      paidEnergy: N * AMOUNT + 50,
      phoneSuffix: String(Math.floor(Math.random() * 9_000_000)),
    });
    const beforeEnergy = await energyOf(userId);

    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        spendEnergy(getPool(), {
          userId,
          plate: PLATE_A,
          amount: AMOUNT,
          idempotencyKey: `idem-distinct-${i}-${nanoid(10)}`,
          confirmed: true,
        }),
      ),
    );

    assert.ok(results.every((r) => r.ok));
    assert.equal(await ledgerCount(PLATE_A), N);
    assert.equal(await energyOf(userId), beforeEnergy - N * AMOUNT);
    assert.equal(await supportOf(PLATE_A, TRIBE_A), N * AMOUNT);
  });

  test("rival tribes under contention: tallies add and owner follows strict lead", async () => {
    resetSingleFlightForTests();
    await ensureSyntheticCity(PLATE_B, "Load City B");

    const rounds = 12;
    const userA = await createReadyUser({
      tribeId: TRIBE_A,
      paidEnergy: rounds * AMOUNT + 50,
      phoneSuffix: String(Math.floor(Math.random() * 9_000_000)),
    });
    const userB = await createReadyUser({
      tribeId: TRIBE_B,
      paidEnergy: rounds * AMOUNT + 50,
      phoneSuffix: String(Math.floor(Math.random() * 9_000_000)),
    });

    const jobs: Promise<unknown>[] = [];
    for (let i = 0; i < rounds; i++) {
      jobs.push(
        spendEnergy(getPool(), {
          userId: userA,
          plate: PLATE_B,
          amount: AMOUNT,
          idempotencyKey: `rival-a-${i}-${nanoid(8)}`,
          confirmed: true,
        }),
      );
      jobs.push(
        spendEnergy(getPool(), {
          userId: userB,
          plate: PLATE_B,
          amount: AMOUNT,
          idempotencyKey: `rival-b-${i}-${nanoid(8)}`,
          confirmed: true,
        }),
      );
    }
    jobs.push(
      spendEnergy(getPool(), {
        userId: userA,
        plate: PLATE_B,
        amount: AMOUNT,
        idempotencyKey: `rival-a-extra-${nanoid(8)}`,
        confirmed: true,
      }),
    );

    const results = await Promise.all(jobs);
    assert.ok(results.every((r) => (r as { ok: boolean }).ok));

    const supportA = await supportOf(PLATE_B, TRIBE_A);
    const supportB = await supportOf(PLATE_B, TRIBE_B);
    assert.equal(supportA, (rounds + 1) * AMOUNT);
    assert.equal(supportB, rounds * AMOUNT);
    assert.ok(supportA > supportB);

    const city = await one<{ owner_team_id: string | null }>(
      getPool(),
      `SELECT owner_team_id FROM cities WHERE plate = $1`,
      [PLATE_B],
    );
    assert.equal(city?.owner_team_id, TRIBE_A);
    assert.equal(await ledgerCount(PLATE_B), rounds * 2 + 1);
  });

  test("HTTP smoke: concurrent same-key injects → one ledger row", async () => {
    resetSingleFlightForTests();
    await ensureSyntheticCity(PLATE_A, "Load City A");

    const db = getPool();
    const phone = `+90555${String(Math.floor(Math.random() * 9_000_000)).padStart(7, "0")}`;
    const { user, token } = await upsertPhoneUser(db, phone);
    await db.query(
      `UPDATE users SET tribe_id = $1, phone_verified = TRUE, paid_energy = 500, free_energy = 0, sub_energy = 0 WHERE id = $2`,
      [TRIBE_A, user.id],
    );

    const app = await buildApp({ db, logger: false, closeSharedResources: false });
    await app.ready();
    const key = `http-idem-${nanoid(12)}`;
    const N = 30;

    try {
      const responses = await Promise.all(
        Array.from({ length: N }, () =>
          app.inject({
            method: "POST",
            url: `/v1/cities/${PLATE_A}/spend`,
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            payload: { confirmed: true, idempotencyKey: key, amount: AMOUNT },
          }),
        ),
      );

      assert.ok(responses.every((r) => r.statusCode === 200), JSON.stringify(responses.map((r) => ({ s: r.statusCode, b: r.body }))));
      assert.equal(await ledgerCountForKey(key), 1);
      assert.equal(await supportOf(PLATE_A, TRIBE_A), AMOUNT);
      assert.equal(await energyOf(user.id), 500 - AMOUNT);
    } finally {
      await app.close();
    }
  });
});
