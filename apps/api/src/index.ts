import { buildApp } from "./app.js";
import { startBus } from "./lib/bus.js";
import { initDb } from "./lib/db.js";
import { warmDigestCache } from "./lib/game.js";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
  const db = await initDb();
  await startBus();
  const warmed = await warmDigestCache(db);
  console.info(`[digest] warmed Redis cache with ${warmed} cities`);
  const app = await buildApp({ db, logger: true });
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`City Competition API on http://${HOST}:${PORT} (Postgres + Redis + WS digest)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
