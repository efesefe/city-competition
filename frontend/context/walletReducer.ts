export type WalletState = {
  /** Last authoritative balance from the server. */
  serverBalance: number;
  /** Unconfirmed optimistic deltas (e.g. −10 while a spend is in flight). */
  optimisticDelta: number;
  /**
   * Bumped on every reconcile. Optimistic applies capture the epoch at call
   * time so a late apply after an authoritative reconcile is ignored.
   */
  epoch: number;
};

export type WalletAction =
  | { type: "hydrate"; balance: number }
  | { type: "apply_optimistic"; delta: number; epoch: number }
  | { type: "reconcile"; balance: number };

export function initialWalletState(balance = 0): WalletState {
  return { serverBalance: balance, optimisticDelta: 0, epoch: 0 };
}

/** Balance shown in the UI = server + outstanding optimistic deltas. */
export function displayedBalance(state: WalletState): number {
  return state.serverBalance + state.optimisticDelta;
}

export function walletReducer(
  state: WalletState,
  action: WalletAction,
): WalletState {
  switch (action.type) {
    case "hydrate":
      return {
        serverBalance: action.balance,
        optimisticDelta: 0,
        epoch: state.epoch,
      };
    case "apply_optimistic":
      if (action.epoch < state.epoch) {
        return state;
      }
      return {
        ...state,
        optimisticDelta: state.optimisticDelta + action.delta,
      };
    case "reconcile":
      return {
        serverBalance: action.balance,
        optimisticDelta: 0,
        epoch: state.epoch + 1,
      };
    default:
      return state;
  }
}
