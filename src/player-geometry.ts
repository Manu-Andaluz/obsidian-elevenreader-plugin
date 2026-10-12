export const SKIP_SECONDS = [5, 10, 15] as const;
export type SkipSeconds = (typeof SKIP_SECONDS)[number];
export const DEFAULT_SKIP_SECONDS: SkipSeconds = 10;

export function normalizeSkipSeconds(value: unknown): SkipSeconds {
  if (value === 5 || value === 10 || value === 15) return value;
  return DEFAULT_SKIP_SECONDS;
}

export function skipTo(current: number, duration: number, delta: number): number {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrent = Number.isFinite(current) ? current : 0;
  const safeDelta = Number.isFinite(delta) ? delta : 0;
  return clamp(safeCurrent + safeDelta, 0, safeDuration);
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const secs = whole % 60;
  const mins = Math.floor(whole / 60) % 60;
  const hours = Math.floor(whole / 3600);
  const ss = secs.toString().padStart(2, "0");
  if (hours > 0) return `${hours}:${mins.toString().padStart(2, "0")}:${ss}`;
  return `${mins}:${ss}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampPosition(
  left: number,
  top: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 8,
): { left: number; top: number } {
  const maxLeft = Math.max(margin, viewportWidth - width - margin);
  const maxTop = Math.max(margin, viewportHeight - height - margin);
  return {
    left: clamp(left, margin, maxLeft),
    top: clamp(top, margin, maxTop),
  };
}
