const SOUND_KEY = "captureCelebrationSound";

export function isCaptureSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setCaptureSoundEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "1" : "0");
  } catch {
    // Ignore quota / private-mode failures.
  }
}

/**
 * Short success tone. Skipped when the settings toggle is off or the tab is
 * hidden. Hardware mute silences Web Audio; iOS silent-switch detection is
 * not available to web apps.
 */
export function playCaptureSuccessSound(): void {
  if (!isCaptureSoundEnabled()) return;
  if (typeof document !== "undefined" && document.hidden) return;
  const AudioCtx =
    typeof window !== "undefined"
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      : undefined;
  if (!AudioCtx) return;
  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(523.25, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(784, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    osc.onended = () => {
      void ctx.close();
    };
  } catch {
    // Autoplay / mute / unsupported — fail closed.
  }
}

export function triggerCaptureHaptic(): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate([40, 30, 60]);
  } catch {
    // Unsupported platforms no-op.
  }
}
