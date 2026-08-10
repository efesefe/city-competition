export const PERF_MODE_STORAGE_KEY = "cc_perf_mode";

export type PerformanceModePreference = "auto" | "on" | "off";

export type ChoroplethPerfConfig = {
  fadeDuration: number;
  antialias: boolean;
  maxTileCacheSize: number;
  geojsonTolerance: number;
  lineWidth: number;
  useSteppedOpacity: boolean;
};

const DEFAULT_PREF: PerformanceModePreference = "auto";
const LOW_MEMORY_GB = 4;

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

export function getDeviceMemoryGb(): number | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof mem === "number" && Number.isFinite(mem) ? mem : undefined;
}

export function isLowMemoryDevice(
  deviceMemoryGb: number | undefined = getDeviceMemoryGb(),
): boolean {
  return deviceMemoryGb !== undefined && deviceMemoryGb <= LOW_MEMORY_GB;
}

export function getPerformanceModePreference(): PerformanceModePreference {
  const raw = readStorage()?.getItem(PERF_MODE_STORAGE_KEY);
  if (raw === "auto" || raw === "on" || raw === "off") {
    return raw;
  }
  return DEFAULT_PREF;
}

export function setPerformanceModePreference(
  pref: PerformanceModePreference,
): void {
  readStorage()?.setItem(PERF_MODE_STORAGE_KEY, pref);
}

export function isPerformanceModeEnabled(
  preference: PerformanceModePreference = getPerformanceModePreference(),
  deviceMemoryGb: number | undefined = getDeviceMemoryGb(),
): boolean {
  if (preference === "on") {
    return true;
  }
  if (preference === "off") {
    return false;
  }
  return isLowMemoryDevice(deviceMemoryGb);
}

export function getChoroplethPerfConfig(
  enabled: boolean,
): ChoroplethPerfConfig {
  if (enabled) {
    return {
      fadeDuration: 0,
      antialias: false,
      maxTileCacheSize: 50,
      geojsonTolerance: 2,
      lineWidth: 0.6,
      useSteppedOpacity: true,
    };
  }
  return {
    fadeDuration: 300,
    antialias: true,
    maxTileCacheSize: 500,
    geojsonTolerance: 0.375,
    lineWidth: 1.2,
    useSteppedOpacity: false,
  };
}
