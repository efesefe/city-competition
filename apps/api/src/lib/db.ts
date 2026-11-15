import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CITY_SEEDS } from "../data/city-seeds.js";
import { TEAM_BY_ALIAS, TEAMS } from "../data/teams.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.resolve(__dirname, "../../data/slice.sqlite");

export type Db = Database.Database;

let db: Db | null = null;

export function getDb(): Db {
  if (db) return db;
  const dbPath = process.env.SQLITE_PATH || defaultDbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(database: Db) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      internal_id TEXT PRIMARY KEY,
      public_alias TEXT NOT NULL UNIQUE,
      primary_color TEXT NOT NULL,
      secondary_color TEXT NOT NULL,
      big4 INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cities (
      plate TEXT PRIMARY KEY,
      name_tr TEXT NOT NULL,
      owner_team_id TEXT REFERENCES teams(internal_id)
    );

    CREATE TABLE IF NOT EXISTS city_support (
      city_plate TEXT NOT NULL,
      team_id TEXT NOT NULL,
      support REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (city_plate, team_id),
      FOREIGN KEY (city_plate) REFERENCES cities(plate),
      FOREIGN KEY (team_id) REFERENCES teams(internal_id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL UNIQUE,
      phone_e164 TEXT UNIQUE,
      phone_verified INTEGER NOT NULL DEFAULT 0,
      tribe_id TEXT REFERENCES teams(internal_id),
      tribe_switched_at TEXT,
      free_energy REAL NOT NULL DEFAULT 0,
      paid_energy REAL NOT NULL DEFAULT 0,
      sub_energy REAL NOT NULL DEFAULT 0,
      free_grant_date TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      phone_e164 TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      city_plate TEXT NOT NULL,
      team_id TEXT NOT NULL,
      energy_spent REAL NOT NULL,
      support_credited REAL NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tunables (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const teamCount = database.prepare("SELECT COUNT(*) AS c FROM teams").get() as { c: number };
  if (teamCount.c === 0) {
    seed(database);
  }

  const actionCost = database.prepare("SELECT value FROM tunables WHERE key = ?").get("action_cost");
  if (!actionCost) {
    database.prepare("INSERT INTO tunables (key, value) VALUES (?, ?)").run("action_cost", "15");
    database.prepare("INSERT INTO tunables (key, value) VALUES (?, ?)").run("free_daily_grant", "100");
  }
}

function seed(database: Db) {
  const insertTeam = database.prepare(
    `INSERT INTO teams (internal_id, public_alias, primary_color, secondary_color, big4)
     VALUES (@internalId, @publicAlias, @primary, @secondary, @big4)`,
  );
  const insertCity = database.prepare(
    `INSERT INTO cities (plate, name_tr, owner_team_id) VALUES (?, ?, ?)`,
  );
  const insertSupport = database.prepare(
    `INSERT INTO city_support (city_plate, team_id, support) VALUES (?, ?, ?)`,
  );

  const tx = database.transaction(() => {
    for (const t of TEAMS) {
      insertTeam.run({
        internalId: t.internalId,
        publicAlias: t.publicAlias,
        primary: t.primary,
        secondary: t.secondary,
        big4: t.big4 ? 1 : 0,
      });
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
      insertCity.run(city.plate, city.nameTr, ownerId);
      for (const s of city.seeds) {
        const team = TEAM_BY_ALIAS.get(s.alias)!;
        insertSupport.run(city.plate, team.internalId, s.points);
      }
    }
  });
  tx();
}

export function trDateString(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function getActionCost(database: Db): number {
  const row = database.prepare("SELECT value FROM tunables WHERE key = ?").get("action_cost") as
    | { value: string }
    | undefined;
  return Number(row?.value ?? 15);
}

export function getFreeGrant(database: Db): number {
  const row = database
    .prepare("SELECT value FROM tunables WHERE key = ?")
    .get("free_daily_grant") as { value: string } | undefined;
  return Number(row?.value ?? 100);
}
