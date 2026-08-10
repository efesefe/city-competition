import { describe, expect, it } from "vitest";
import {
  displayedBalance,
  initialWalletState,
  walletReducer,
} from "./walletReducer";

describe("walletReducer", () => {
  it("applyOptimisticDelta then reconcile settles on authoritative balance", () => {
    let state = initialWalletState(1000);
    state = walletReducer(state, {
      type: "apply_optimistic",
      delta: -10,
      epoch: state.epoch,
    });
    expect(displayedBalance(state)).toBe(990);

    state = walletReducer(state, { type: "reconcile", balance: 990 });
    expect(displayedBalance(state)).toBe(990);
    expect(state.optimisticDelta).toBe(0);
  });

  it("reconcile before optimistic (stale epoch) does not permanently undercount", () => {
    let state = initialWalletState(1000);
    const staleEpoch = state.epoch;

    // Authoritative WS/REST lands first.
    state = walletReducer(state, { type: "reconcile", balance: 990 });
    expect(displayedBalance(state)).toBe(990);
    expect(state.epoch).toBe(staleEpoch + 1);

    // Late optimistic from the same spend uses the pre-reconcile epoch.
    state = walletReducer(state, {
      type: "apply_optimistic",
      delta: -10,
      epoch: staleEpoch,
    });
    expect(displayedBalance(state)).toBe(990);
    expect(state.optimisticDelta).toBe(0);
  });

  it("hydrate resets optimistic drift", () => {
    let state = initialWalletState(1000);
    state = walletReducer(state, {
      type: "apply_optimistic",
      delta: -50,
      epoch: state.epoch,
    });
    state = walletReducer(state, { type: "hydrate", balance: 800 });
    expect(displayedBalance(state)).toBe(800);
    expect(state.optimisticDelta).toBe(0);
  });
});
