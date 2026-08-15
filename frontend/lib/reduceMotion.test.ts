import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isReduceMotionSettingEnabled,
  prefersOsReducedMotion,
  REDUCE_MOTION_STORAGE_KEY,
  setReduceMotionSettingEnabled,
  shouldReduceMotion,
} from "./reduceMotion";

function setMatchMedia(matches: boolean) {
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? matches : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }),
  });
}

describe("reduceMotion", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
    });
    setMatchMedia(false);
  });

  afterEach(() => {
    setMatchMedia(false);
  });

  it("defaults the in-app setting to off", () => {
    expect(isReduceMotionSettingEnabled()).toBe(false);
    expect(shouldReduceMotion()).toBe(false);
  });

  it("persists the in-app opt-in", () => {
    setReduceMotionSettingEnabled(true);
    expect(store.get(REDUCE_MOTION_STORAGE_KEY)).toBe("1");
    expect(isReduceMotionSettingEnabled()).toBe(true);
    expect(shouldReduceMotion()).toBe(true);
    setReduceMotionSettingEnabled(false);
    expect(store.get(REDUCE_MOTION_STORAGE_KEY)).toBe("0");
    expect(isReduceMotionSettingEnabled()).toBe(false);
  });

  it("honors the OS media query even when the setting is off", () => {
    setMatchMedia(true);
    expect(prefersOsReducedMotion()).toBe(true);
    expect(isReduceMotionSettingEnabled()).toBe(false);
    expect(shouldReduceMotion()).toBe(true);
  });
});
