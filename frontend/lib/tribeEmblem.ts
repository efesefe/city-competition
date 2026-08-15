import type { Tribe } from "@/lib/tribes-api";
import {
  contrastRatio,
  tribeAccentColor,
  tribeCrestInitial,
} from "@/lib/tribeCrest";

export type TribeEmblemKey =
  | "lion"
  | "canary"
  | "eagle"
  | "storm"
  | "wave"
  | "compass"
  | "sun"
  | "crocodile"
  | "mountain"
  | "crescent";

export type EmblemGlyph = {
  paths: string[];
  fillRule?: CanvasFillRule;
};

/** Original silhouettes — not official club marks. */
export const TRIBE_EMBLEM_BY_SLUG: Record<string, TribeEmblemKey> = {
  "kizil-ruzgar": "lion",
  "sari-dalga": "canary",
  "siyah-gelgit": "eagle",
  "bordo-firtina": "storm",
  "turkuaz-ufuk": "wave",
  "kirmizi-pusula": "compass",
  "turuncu-sahil": "sun",
  "yesil-ovalar": "crocodile",
  "lacivert-zirve": "mountain",
  "mor-isik": "crescent",
};

const VIEWBOX = 24;

export const EMBLEM_GLYPHS: Record<TribeEmblemKey, EmblemGlyph> = {
  lion: {
    paths: [
      "M9.1 5.4 7.2 2.6 10.9 4.3c.7-1 2.5-1 3.2 0L17.8 2.6 15.9 5.4c3.5 1.6 5.6 5.2 4.8 9.1C19.6 19.2 15.2 22 11.2 21 7 20 4.5 15.5 5.5 11.1 6.1 8.6 7.4 6.6 9.1 5.4z",
    ],
  },
  canary: {
    paths: [
      "M3.4 13.1C4.2 8.8 8.3 6.5 12.6 7.3c2.1-2.3 6.1-1.9 7.7 1.2L23 9.6l-2.7 1.7c.8 3 .9 6.1-2.5 8.1l1.5 3.1-3.4-1.9c-3.1 1-6.6-.7-8.3-3.8L2.2 16.4z",
    ],
  },
  eagle: {
    paths: [
      "M11.2 4.2 12.4 2.4 14.6 3.8 13.2 5.6 18.8 4.8 22 9.2 16.4 11 20.4 15.6 15.2 14.4 16.4 20.2 12 16.8 7.6 20.2 8.8 14.4 3.6 15.6 7.6 11 2 9.2 5.2 4.8 10.8 5.6Z",
    ],
  },
  storm: {
    paths: [
      "M14.2 2.1 6.1 13.1h5.1L8.3 21.9 18.4 10.2h-5.1z",
    ],
  },
  wave: {
    paths: [
      "M2 11c3.5-4 6.5-4 10 0s6.5 4 10 0v6.4c-3.5 4-6.5 4-10 0s-6.5-4-10 0z",
    ],
  },
  compass: {
    paths: [
      "M12 1.6 14.7 9.5 22.4 12 14.7 14.5 12 22.4 9.3 14.5 1.6 12 9.3 9.5z",
    ],
  },
  sun: {
    paths: [
      "M12 8.15a3.85 3.85 0 1 0 .01 0z",
      "M12 1.7 13.2 6.5h-2.4zM18.05 3.55 16.2 7.55l-1.7-1.7zM22.3 12 17.5 13.2v-2.4zM18.05 20.45 14.5 18.15l1.7-1.7zM12 22.3 10.8 17.5h2.4zM5.95 20.45 7.8 16.45l1.7 1.7zM1.7 12 6.5 10.8v2.4zM5.95 3.55 9.5 5.85l-1.7 1.7z",
    ],
  },
  crocodile: {
    paths: [
      "M1.6 13.1 5.8 11.2c3.1-1.3 7.2-1.5 11 0l3.6-2.1 2.6 2.7-2.4 1.4c1.4.6 2.1 2.2.9 3.4l-4.4-.8-1.3 3-2.1-3.1-1.8 3.1-1.9-3.1-2.4 1.2.8-2.2z",
    ],
  },
  mountain: {
    paths: [
      "M1.7 20.2 8.3 8.1 11.6 13.9 15.1 5.4 22.3 20.2z",
    ],
  },
  crescent: {
    fillRule: "evenodd",
    paths: [
      "M15.1 3.5A9.1 9.1 0 1 0 15.1 20.5 7.15 7.15 0 1 1 15.1 3.5Z",
    ],
  },
};

const MIN_MARK_CONTRAST = 3;
const MARK_WHITE = "#ffffff";
const MARK_DARK = "#111111";

export function tribeEmblemKey(
  slug: string | null | undefined,
): TribeEmblemKey | null {
  if (!slug) {
    return null;
  }
  return TRIBE_EMBLEM_BY_SLUG[slug] ?? null;
}

export function tribeEmblemGlyph(
  slug: string | null | undefined,
): EmblemGlyph | null {
  const key = tribeEmblemKey(slug);
  return key ? EMBLEM_GLYPHS[key] : null;
}

/**
 * Mark color on a tribe primary fill. White when it contrasts;
 * otherwise secondary, then near-black (yellow crests, etc.).
 */
export function tribeMarkColor(
  tribe:
    | Pick<Tribe, "primary_color" | "secondary_color">
    | null
    | undefined,
): string {
  const fill = tribeAccentColor(tribe);
  const whiteRatio = contrastRatio(MARK_WHITE, fill);
  if (whiteRatio != null && whiteRatio >= MIN_MARK_CONTRAST) {
    return MARK_WHITE;
  }
  const secondary = tribe?.secondary_color?.trim();
  if (secondary) {
    const secondaryRatio = contrastRatio(secondary, fill);
    if (secondaryRatio != null && secondaryRatio >= MIN_MARK_CONTRAST) {
      return secondary;
    }
  }
  return MARK_DARK;
}

export function tribeEmblemFallback(
  tribe: Pick<Tribe, "short_name" | "display_name" | "slug">,
): string {
  return tribeCrestInitial(tribe);
}

/** Paint a glyph into a canvas, centered at (cx, cy) with the given pixel size. */
export function fillEmblemGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: EmblemGlyph,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  if (typeof Path2D === "undefined") {
    return;
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(size / VIEWBOX, size / VIEWBOX);
  ctx.translate(-VIEWBOX / 2, -VIEWBOX / 2);
  ctx.fillStyle = color;
  const rule = glyph.fillRule ?? "nonzero";
  for (const d of glyph.paths) {
    ctx.fill(new Path2D(d), rule);
  }
  ctx.restore();
}
