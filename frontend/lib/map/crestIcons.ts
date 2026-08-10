import type { Map as MaplibreMap } from "maplibre-gl";
import type { Tribe } from "@/lib/tribes-api";
import { tribeCrestInitial } from "@/lib/tribeCrest";

export function tribeCrestImageId(tribeId: string): string {
  return `tribe-crest-${tribeId}`;
}

const SIZE = 64;

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

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.stroke();

  const initial = tribeCrestInitial(tribe);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${initial.length > 2 ? 18 : 22}px "Segoe UI", "Helvetica Neue", sans-serif`;
  ctx.fillText(initial, cx, cy + 1);

  const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
  map.addImage(imageId, imageData, { pixelRatio: 2 });
  return imageId;
}
