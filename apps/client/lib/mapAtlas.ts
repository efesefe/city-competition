import raw from "../assets/turkiye-provinces.json";
import { colors } from "./theme";

export type ProvinceFeature = {
  plate: string;
  nameTr: string;
  path: string;
};

export type ProvincesAtlas = {
  viewBox: string;
  features: ProvinceFeature[];
};

export const EXPECTED_PROVINCE_COUNT = 81;
export const DEFAULT_VIEW_BOX = "0 0 1000 480";

function normalizeAtlas(input: unknown): ProvincesAtlas {
  const data = (input ?? {}) as Partial<ProvincesAtlas>;
  const viewBox =
    typeof data.viewBox === "string" && data.viewBox.trim().length > 0
      ? data.viewBox.trim()
      : DEFAULT_VIEW_BOX;

  const features: ProvinceFeature[] = [];
  const seen = new Set<string>();
  if (Array.isArray(data.features)) {
    for (const item of data.features) {
      if (!item || typeof item !== "object") continue;
      const plate = typeof item.plate === "string" ? item.plate.trim() : "";
      const path = typeof item.path === "string" ? item.path.trim() : "";
      if (!plate || !path || seen.has(plate)) continue;
      seen.add(plate);
      features.push({
        plate,
        nameTr: typeof item.nameTr === "string" && item.nameTr.trim() ? item.nameTr.trim() : plate,
        path,
      });
    }
  }

  return { viewBox, features };
}

/** Validated 81-province atlas; empty `features` means asset failed to load/parse. */
export const atlas: ProvincesAtlas = normalizeAtlas(raw);

export const atlasReady = atlas.features.length > 0;

export function parseViewBox(viewBox: string): { x: number; y: number; w: number; h: number } {
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
    return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
  }
  return { x: 0, y: 0, w: 1000, h: 480 };
}

export type ProvincePaint = {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
};

/**
 * Floodlight Night ownership paint.
 * Contested soft pulse is a separate overlay (accent wash) — not badges.
 */
export function provinceStyle(
  plate: string,
  colorByPlate: Map<string, string>,
  selectedPlate?: string | null,
  pulsePlates?: Set<string>,
  spotlightPlates?: Set<string>,
): ProvincePaint {
  const fill = colorByPlate.get(plate) || colors.mapBase;
  const selected = selectedPlate === plate;
  const pulse = pulsePlates?.has(plate) ?? false;
  const spotlight = spotlightPlates?.has(plate) ?? false;

  // Match-day spotlight: cool floodlight stroke (retinted off gold).
  if (spotlight && !selected) {
    return {
      fill,
      fillOpacity: pulse ? 0.92 : 0.82,
      stroke: colors.ink,
      strokeWidth: 2.2,
    };
  }
  return {
    fill,
    fillOpacity: selected ? 0.95 : pulse ? 0.9 : 0.82,
    // Selected rim is vermillion path stroke (Floodlight accent) — never a bbox rect.
    // A top SelectionBorder overlay also redraws this rim so neighbors don't cover it.
    stroke: selected ? colors.accent : colors.mapStroke,
    strokeWidth: selected ? 2.4 : 0.7,
  };
}

export function paintEquals(a: ProvincePaint, b: ProvincePaint): boolean {
  return (
    a.fill === b.fill &&
    a.fillOpacity === b.fillOpacity &&
    a.stroke === b.stroke &&
    a.strokeWidth === b.strokeWidth
  );
}

/** Pick up to `limit` hottest contested plates (tight lead margin + rival pressure). */
export function selectContestedPlates(
  digest: { plate: string; leadMargin?: number; rivalSupport?: number; leadSupport?: number }[],
  limit = 3,
): Set<string> {
  const scored = digest
    .filter((c) => c?.plate && typeof c.rivalSupport === "number" && (c.rivalSupport ?? 0) > 0)
    .map((c) => {
      const margin =
        typeof c.leadMargin === "number"
          ? Math.abs(c.leadMargin)
          : Math.max(0, (c.leadSupport ?? 0) - (c.rivalSupport ?? 0));
      const rival = c.rivalSupport ?? 0;
      // Lower margin + higher rival = hotter fight.
      const heat = rival / (1 + margin);
      return { plate: c.plate, heat, margin };
    })
    .filter((c) => c.heat > 0)
    .sort((a, b) => b.heat - a.heat || a.margin - b.margin);

  return new Set(scored.slice(0, limit).map((c) => c.plate));
}
