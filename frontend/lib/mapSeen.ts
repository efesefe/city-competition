export const MAP_SEEN_KEY = "cc_map_seen";
export const PUSH_PROMPT_DISMISSED_KEY = "cc_push_prompt_dismissed";

export function wasMapSeenBefore(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MAP_SEEN_KEY) === "1";
}

export function markMapSeen(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MAP_SEEN_KEY, "1");
}

export function isPushPromptDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PUSH_PROMPT_DISMISSED_KEY) === "1";
}

export function dismissPushPrompt(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PUSH_PROMPT_DISMISSED_KEY, "1");
}
