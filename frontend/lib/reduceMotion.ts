export const REDUCE_MOTION_STORAGE_KEY = "cc_reduce_motion";

function readStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** OS-level `prefers-reduced-motion: reduce`. */
export function prefersOsReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** In-app opt-in stored in localStorage (independent of the OS media query). */
export function isReduceMotionSettingEnabled(): boolean {
  return readStorage()?.getItem(REDUCE_MOTION_STORAGE_KEY) === "1";
}

export function setReduceMotionSettingEnabled(on: boolean): void {
  try {
    readStorage()?.setItem(REDUCE_MOTION_STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Ignore quota / private-mode failures.
  }
}

/**
 * True when the OS asks for reduced motion or the user enabled the
 * Settings toggle. Decorative motion (ambient sprites, derby pulse, ticker
 * autoscroll) must check this before animating.
 */
export function shouldReduceMotion(): boolean {
  return prefersOsReducedMotion() || isReduceMotionSettingEnabled();
}
