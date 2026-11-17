/** Apply SQL migrations + seed if empty. Safe to re-run. */
import "./loadEnv.js";
import { closeDb, initDb } from "./lib/db.js";

const db = await initDb();
console.info("Migrations + seed check complete.");
await closeDb();
process.exit(0);
