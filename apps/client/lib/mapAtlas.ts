import raw from "../assets/turkiye-provinces.json";

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

export function provinceStyle(
  plate: string,
  colorByPlate: Map<string, string>,
  selectedPlate?: string | null,
  pulsePlates?: Set<string>,
): ProvincePaint {
  const fill = colorByPlate.get(plate) || "#2a3f36";
  const selected = selectedPlate === plate;
  const pulse = pulsePlates?.has(plate) ?? false;
  return {
    fill,
    fillOpacity: selected ? 1 : pulse ? 0.95 : 0.88,
    stroke: selected ? "#f4e7c5" : "#0a1620",
    strokeWidth: selected ? 2.2 : 0.6,
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
