export type CaptureToastItem = {
  id: string;
  il_code: string;
  city_name: string;
  previous_tribe_id: string | null;
  new_tribe_id: string;
  occurred_at: string;
  was_derbi_bonus: boolean;
};

export type ToastQueueState = {
  active: CaptureToastItem | null;
  pending: CaptureToastItem[];
};

export function emptyToastQueue(): ToastQueueState {
  return { active: null, pending: [] };
}

/** FIFO enqueue. Duplicate ids are ignored. Never drops a new distinct item. */
export function enqueueToast(
  state: ToastQueueState,
  item: CaptureToastItem,
): ToastQueueState {
  if (state.active?.id === item.id) {
    return state;
  }
  if (state.pending.some((p) => p.id === item.id)) {
    return state;
  }
  if (!state.active) {
    return { active: item, pending: [] };
  }
  return { active: state.active, pending: [...state.pending, item] };
}

/** Advance to the next queued toast, or clear when the queue is empty. */
export function dismissActiveToast(state: ToastQueueState): ToastQueueState {
  if (state.pending.length === 0) {
    return { active: null, pending: [] };
  }
  const [next, ...rest] = state.pending;
  return { active: next, pending: rest };
}

export function queuedCount(state: ToastQueueState): number {
  return (state.active ? 1 : 0) + state.pending.length;
}
