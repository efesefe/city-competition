import type { ActivityFeedItem } from "@/lib/activity-feed-api";
import type { ActivityFeedMessage } from "@/lib/realtimeSocket";

export const ACTIVITY_FEED_CAP = 50;

/** API returns newest-first; the ticker scrolls oldest → newest (entry on the right). */
export function toChronological(
  events: ActivityFeedItem[],
): ActivityFeedItem[] {
  return events.slice().reverse();
}

/**
 * Append a live item at the scroll entry edge. Duplicates are ignored.
 * When over cap, drop the oldest (leftmost) items.
 */
export function appendActivityItem(
  items: ActivityFeedItem[],
  incoming: ActivityFeedItem,
  cap = ACTIVITY_FEED_CAP,
): ActivityFeedItem[] {
  if (items.some((item) => item.id === incoming.id)) {
    return items;
  }
  const next = [...items, incoming];
  if (next.length <= cap) {
    return next;
  }
  return next.slice(next.length - cap);
}

export function activityFeedFromSocket(
  msg: ActivityFeedMessage,
): ActivityFeedItem {
  return {
    id: msg.id,
    kind: msg.kind,
    il_code: msg.il_code,
    city_name: msg.city_name,
    tribe_id: msg.tribe_id,
    previous_tribe_id: msg.previous_tribe_id ?? null,
    credits: msg.credits,
    was_derbi_bonus: msg.was_derbi_bonus,
    occurred_at: msg.occurred_at,
  };
}
