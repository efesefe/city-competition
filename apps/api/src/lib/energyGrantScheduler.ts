import type { Db } from "./db.js";
import { runDailyFreeEnergyJob } from "./energy.js";
import { msUntilNextTrMidnight, trDateString, TR_TIMEZONE } from "./trTime.js";

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

/**
 * In-process TR-midnight free-energy job.
 *
 * Arms a timer for the next 00:00 Europe/Istanbul, runs the batch grant,
 * then re-arms. Also usable immediately via {@link kickEnergyGrantJob}.
 *
 * Enable with `ENERGY_GRANT_SCHEDULER=true` (off by default so local API
 * boots stay quiet; Fly can set the flag when ready).
 */
export function startEnergyGrantScheduler(db: Db, log: Logger): () => void {
  if (process.env.ENERGY_GRANT_SCHEDULER !== "true") {
    log.info(
      { timezone: TR_TIMEZONE },
      "energy grant scheduler idle (set ENERGY_GRANT_SCHEDULER=true to arm TR midnight)",
    );
    return () => undefined;
  }

  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let lastRunDate: string | null = null;

  const arm = () => {
    if (stopped) return;
    const wait = msUntilNextTrMidnight();
    // Cap sleep chunks so process restarts / clock skew still re-evaluate soon.
    const chunk = Math.min(wait || 1000, 60_000);
    log.info(
      { timezone: TR_TIMEZONE, waitMs: wait, chunkMs: chunk, nextTrDate: trDateString(new Date(Date.now() + wait)) },
      "energy grant scheduler armed",
    );
    timer = setTimeout(() => {
      void tick();
    }, chunk);
  };

  const tick = async () => {
    if (stopped) return;
    const today = trDateString();
    const wait = msUntilNextTrMidnight();
    // Only run the batch when we are at/near the boundary or have never run today.
    if (wait === 0 || lastRunDate !== today) {
      if (lastRunDate !== today) {
        try {
          const result = await runDailyFreeEnergyJob(db, { now: new Date() });
          lastRunDate = result.date;
          log.info(result, "energy grant job completed");
        } catch (err) {
          log.error({ err }, "energy grant job failed");
        }
      }
    }
    arm();
  };

  arm();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** Manual / HTTP kick — same batch path the scheduler uses. */
export async function kickEnergyGrantJob(
  db: Db,
  opts: { force?: boolean; now?: Date } = {},
) {
  return runDailyFreeEnergyJob(db, opts);
}
