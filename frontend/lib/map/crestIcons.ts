import type { Map as MaplibreMap } from "maplibre-gl";
import type { Tribe } from "@/lib/tribes-api";
import { tribeCrestInitial } from "@/lib/tribeCrest";

export function tribeCrestImageId(tribeId: string): string {
  return `tribe-crest-${tribeId}`;
}

const SIZE = 64;

function parseHexRgb(color: string): [number, number, number] | null {
  const trimmed = color.trim();
  const m6 = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
  if (m6) {
    const n = parseInt(m6[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  const m3 = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (m3) {
    const [r, g, b] = m3[1].split("").map((c) => parseInt(c + c, 16));
    return [r, g, b];
  }
  return null;
}

function isDarkFill(hex: string): boolean {
  const rgb = parseHexRgb(hex);
  if (!rgb) {
    return false;
  }
  const [r, g, b] = rgb.map((c) => c / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.22;
}

/**
 * Rasterize a monogram disc and register it on the map once per tribe id.
 * Backend has no crest_asset_url yet — generated icons stand in for Track B.
 */
export function ensureTribeCrestImage(
  map: MaplibreMap,
  tribe: Pick<Tribe, "id" | "short_name" | "display_name" | "slug" | "primary_color">,
): string {
  const imageId = tribeCrestImageId(tribe.id);
  if (map.hasImage(imageId)) {
    return imageId;
  }

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return imageId;
  }

  const fill = tribe.primary_color?.trim() || "#6b7280";
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r = SIZE / 2 - 2;
  const dark = isDarkFill(fill);

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();

  // Outer light ring so dark tribe discs stay visible on dark city fills.
  ctx.lineWidth = dark ? 4.5 : 3;
  ctx.strokeStyle = dark ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.85)";
  ctx.stroke();

  if (dark) {
    ctx.beginPath();
    ctx.arc(cx, cy, r - 3.5, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.stroke();
  }

  const initial = tribeCrestInitial(tribe);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${initial.length > 2 ? 18 : 22}px "Segoe UI", "Helvetica Neue", sans-serif`;
  if (dark) {
    ctx.shadowColor = "rgba(0,0,0,0.65)";
    ctx.shadowBlur = 3;
  }
  ctx.fillText(initial, cx, cy + 1);

  const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
  map.addImage(imageId, imageData, { pixelRatio: 2 });
  return imageId;
}
