import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getChoroplethPerfConfig,
  getDeviceMemoryGb,
  getPerformanceModePreference,
  isLowMemoryDevice,
  isPerformanceModeEnabled,
  PERF_MODE_STORAGE_KEY,
  setPerformanceModePreference,
} from "./performanceMode";

type NavWithMemory = Navigator & { deviceMemory?: number };

function setDeviceMemory(value: number | undefined) {
  const nav = globalThis.navigator as NavWithMemory | undefined;
  if (!nav) {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: value === undefined ? {} : { deviceMemory: value },
    });
    return;
  }
  if (value === undefined) {
    delete nav.deviceMemory;
  } else {
    nav.deviceMemory = value;
  }
}

describe("performanceMode", () => {
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
    setDeviceMemory(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("treats deviceMemory <= 4 as low-memory", () => {
    expect(isLowMemoryDevice(2)).toBe(true);
    expect(isLowMemoryDevice(4)).toBe(true);
    expect(isLowMemoryDevice(8)).toBe(false);
    expect(isLowMemoryDevice(undefined)).toBe(false);
  });

  it("reads navigator.deviceMemory when present", () => {
    setDeviceMemory(2);
    expect(getDeviceMemoryGb()).toBe(2);
  });

  it("enables perf mode for low-memory profile under auto preference", () => {
    setPerformanceModePreference("auto");
    expect(isPerformanceModeEnabled("auto", 2)).toBe(true);
    expect(isPerformanceModeEnabled("auto", 8)).toBe(false);
  });

  it("on/off preference overrides the deviceMemory heuristic", () => {
    expect(isPerformanceModeEnabled("on", 8)).toBe(true);
    expect(isPerformanceModeEnabled("off", 2)).toBe(false);
  });

  it("persists preference in localStorage", () => {
    setPerformanceModePreference("on");
    expect(store.get(PERF_MODE_STORAGE_KEY)).toBe("on");
    expect(getPerformanceModePreference()).toBe("on");
  });

  it("returns reduced choropleth config when enabled", () => {
    const on = getChoroplethPerfConfig(true);
    const off = getChoroplethPerfConfig(false);
    expect(on.fadeDuration).toBe(0);
    expect(on.useSteppedOpacity).toBe(true);
    expect(on.geojsonTolerance).toBeGreaterThan(off.geojsonTolerance);
    expect(on.lineWidth).toBeLessThan(off.lineWidth);
    expect(off.useSteppedOpacity).toBe(false);
  });
});
