/**
 * Floodlight Night — Season 0 visual tokens (D2 lock).
 * Source of truth for roles/hex: store docs/visual-direction.md
 * W4 tokens; W5 guest map loads Unbounded/Figtree via expo-font in `_layout`.
 */

export const colors = {
  bg: "#070B12",
  bgElevated: "#0C121C",
  surface: "#121A26",
  surfaceRaised: "#1A2433",
  stroke: "#2A3548",
  ink: "#E8EEF6",
  inkDim: "#C5CEDC",
  muted: "#8B97A8",
  mutedDim: "#5C6778",
  accent: "#FF2D55",
  accentPressed: "#D91F45",
  accentSoft: "rgba(255, 45, 85, 0.16)",
  danger: "#FF6A3D",
  success: "#3DDC97",
  mapBase: "#0A1018",
  mapStroke: "#3A465C",
  overlayScrim: "rgba(7, 11, 18, 0.55)",
} as const;

/** Family names after expo-font load (W4 follow-up). */
export const fonts = {
  display: "Unbounded",
  displayBold: "Unbounded",
  body: "Figtree",
  bodyMedium: "Figtree",
  bodySemiBold: "Figtree",
  bodyBold: "Figtree",
} as const;

export const type = {
  brand: {
    fontFamily: fonts.display,
    fontSize: 30,
    fontWeight: "800" as const,
    color: colors.ink,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 24,
    fontWeight: "700" as const,
    color: colors.ink,
  },
  headline: {
    fontFamily: fonts.body,
    fontSize: 18,
    fontWeight: "600" as const,
    color: colors.ink,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: "400" as const,
    color: colors.inkDim,
  },
  meta: {
    fontFamily: fonts.body,
    fontSize: 12,
    fontWeight: "500" as const,
    color: colors.muted,
  },
  cta: {
    fontFamily: fonts.body,
    fontSize: 16,
    fontWeight: "700" as const,
    color: colors.ink,
  },
  tabular: {
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: "600" as const,
    color: colors.ink,
    fontVariant: ["tabular-nums"] as const,
  },
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
} as const;

/** Durations in ms — match visual-direction motion budget. */
export const motion = {
  flipTweenMs: 340,
  sheetEnterMs: 220,
  contestedPulseMs: 1800,
} as const;

export type ThemeColors = typeof colors;
export type ThemeFonts = typeof fonts;

export const theme = {
  colors,
  fonts,
  type,
  space,
  radii,
  motion,
} as const;

export default theme;
