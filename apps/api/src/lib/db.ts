import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { CITY_SEEDS } from "../data/city-seeds.js";
import { TEAM_BY_ALIAS, TEAMS } from "../data/teams.js";

const { Pool } = pg;

export type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;
export type Db = pg.Pool;

let pool: Db | null = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../migrations");

/** Neon / Fly MPG / local Postgres — required. */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required (Postgres). Example: postgres://city:city@127.0.0.1:5432/city_competition",
    );
  }
  return url;
}

export function getPool(): Db {
  if (pool) return pool;
  pool = new Pool({
    connectionString: databaseUrl(),
    // Neon / Fly often need SSL in prod; local docker does not.
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.PG_POOL_MAX || 10),
  });
  return pool;
}

export async function initDb(): Promise<Db> {
  const db = getPool();
  await migrate(db);
  await ensureSeedAndTunables(db);
  return db;
}

export async function closeDb(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}

export async function withTransaction<T>(
  db: Db,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function one<T extends pg.QueryResultRow>(
  q: Queryable,
  text: string,
  params?: unknown[],
): Promise<T | undefined> {
  const res = await q.query<T>(text, params);
  return res.rows[0];
}

export async function many<T extends pg.QueryResultRow>(
  q: Queryable,
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await q.query<T>(text, params);
  return res.rows;
}

async function migrate(database: Db) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const id = file;
    const applied = await one<{ id: string }>(
      database,
      `SELECT id FROM schema_migrations WHERE id = $1`,
      [id],
    );
    if (applied) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    await withTransaction(database, async (client) => {
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [id]);
    });
    console.info(`[db] applied migration ${id}`);
  }
}

async function ensureSeedAndTunables(database: Db) {
  const teamCount = await one<{ c: string }>(database, `SELECT COUNT(*)::text AS c FROM teams`);
  if (Number(teamCount?.c ?? 0) === 0) {
    await seed(database);
  }

  const actionCost = await one<{ value: string }>(
    database,
    `SELECT value FROM tunables WHERE key = $1`,
    ["action_cost"],
  );
  if (!actionCost) {
    await database.query(`INSERT INTO tunables (key, value) VALUES ($1, $2)`, [
      "action_cost",
      "15",
    ]);
    await database.query(`INSERT INTO tunables (key, value) VALUES ($1, $2)`, [
      "free_daily_grant",
      "100",
    ]);
  }
}

async function seed(database: Db) {
  await withTransaction(database, async (client) => {
    for (const t of TEAMS) {
      await client.query(
        `INSERT INTO teams (internal_id, public_alias, primary_color, secondary_color, big4)
         VALUES ($1, $2, $3, $4, $5)`,
        [t.internalId, t.publicAlias, t.primary, t.secondary, t.big4],
      );
    }

    for (const city of CITY_SEEDS) {
      let ownerId: string | null = null;
      let best = -1;
      for (const s of city.seeds) {
        const team = TEAM_BY_ALIAS.get(s.alias);
        if (!team) throw new Error(`Unknown alias in seed: ${s.alias}`);
        if (s.points > best) {
          best = s.points;
          ownerId = team.internalId;
        }
      }
      await client.query(`INSERT INTO cities (plate, name_tr, owner_team_id) VALUES ($1, $2, $3)`, [
        city.plate,
        city.nameTr,
        ownerId,
      ]);
      for (const s of city.seeds) {
        const team = TEAM_BY_ALIAS.get(s.alias)!;
        await client.query(
          `INSERT INTO city_support (city_plate, team_id, support) VALUES ($1, $2, $3)`,
          [city.plate, team.internalId, s.points],
        );
      }
    }
  });
  console.info("[db] seeded teams + 81 city ownership matrix");
}

export function trDateString(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export async function getActionCost(database: Queryable): Promise<number> {
  const row = await one<{ value: string }>(
    database,
    `SELECT value FROM tunables WHERE key = $1`,
    ["action_cost"],
  );
  return Number(row?.value ?? 15);
}

export async function getFreeGrant(database: Queryable): Promise<number> {
  const row = await one<{ value: string }>(
    database,
    `SELECT value FROM tunables WHERE key = $1`,
    ["free_daily_grant"],
  );
  return Number(row?.value ?? 100);
}
