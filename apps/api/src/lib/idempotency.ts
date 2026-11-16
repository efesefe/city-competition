/**
 * Process-local single-flight for identical idempotency keys.
 * Multi-instance correctness still comes from support_ledger UNIQUE + FOR UPDATE.
 */
const flights = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = flights.get(key);
  if (hit) return hit as Promise<T>;

  const pending = fn().finally(() => {
    if (flights.get(key) === pending) flights.delete(key);
  });
  flights.set(key, pending);
  return pending;
}

/** Test helper — clear in-flight map between cases. */
export function resetSingleFlightForTests() {
  flights.clear();
}
