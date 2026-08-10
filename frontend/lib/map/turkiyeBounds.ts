/**
 * Türkiye camera envelope for the city-granularity map.
 *
 * Source: padded OSM/admin envelope covering the mainland plus Aegean islands
 * and the eastern tip (approx. 25.5°E–45.0°E, 35.8°N–42.2°N), matching the
 * Track B product bounds. Slightly wider than the strict landmass so coast
 * labels are not clipped at the edge.
 */
export const TURKIYE_BOUNDS: [[number, number], [number, number]] = [
  [25.5, 35.8],
  [45.0, 42.2],
];

/**
 * maxBounds is padded beyond TURKIYE_BOUNDS so MapLibre fitBounds does not
 * fight the constraint on load / resize.
 */
export const TURKIYE_MAX_BOUNDS: [[number, number], [number, number]] = [
  [24.5, 34.8],
  [46.0, 43.2],
];

/** Country-wide fit — cannot zoom out past seeing the whole country. */
export const TURKIYE_MIN_ZOOM = 5;

/** City-label-readable ceiling — no street-level zoom in a city game. */
export const TURKIYE_MAX_ZOOM = 9;
