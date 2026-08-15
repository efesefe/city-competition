import type { ConquestLogEntry, ConquestLogListResponse } from "@/lib/conquest-api";

export type UnreadSnapshot = {
  unread_count: number;
};

export function applyLiveFlip(snapshot: UnreadSnapshot): UnreadSnapshot {
  return { unread_count: snapshot.unread_count + 1 };
}

export function applyServerUnread(
  _snapshot: UnreadSnapshot,
  serverCount: number,
): UnreadSnapshot {
  const n = Number.isFinite(serverCount) ? Math.max(0, Math.floor(serverCount)) : 0;
  return { unread_count: n };
}

export function applyMarkAllRead(): UnreadSnapshot {
  return { unread_count: 0 };
}

export type ConquestLogVisitApi = {
  list: (limit: number, offset: number) => Promise<ConquestLogListResponse>;
  markReadAll: () => Promise<{ updated: number }>;
  unreadCount: () => Promise<{ unread_count: number }>;
};

export type ConquestLogVisitResult = {
  entries: ConquestLogEntry[];
  nextOffset: number | null;
  unreadCount: number;
};

/**
 * First-page load + mark-all-read + authoritative unread refresh.
 * Re-visits are safe: the backend cursor never moves backwards, so already-read
 * entries are not double-counted.
 */
export async function syncConquestLogVisit(
  api: ConquestLogVisitApi,
  pageSize = 20,
): Promise<ConquestLogVisitResult> {
  const page = await api.list(pageSize, 0);
  await api.markReadAll();
  const unread = await api.unreadCount();
  return {
    entries: page.entries,
    nextOffset:
      page.next_offset === undefined || page.next_offset === null
        ? null
        : page.next_offset,
    unreadCount: unread.unread_count,
  };
}
