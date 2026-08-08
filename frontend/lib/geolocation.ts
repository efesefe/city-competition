/**
 * Geolocation wrapper — must only be called after required KVKK consents
 * (aydinlatma_metni + acik_riza_location) are recorded server-side.
 */
export function requestLocation(
  success: PositionCallback,
  error?: PositionErrorCallback,
  options?: PositionOptions,
): void {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    error?.({
      code: 2,
      message: "Geolocation unavailable",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError);
    return;
  }
  navigator.geolocation.getCurrentPosition(success, error, options);
}
