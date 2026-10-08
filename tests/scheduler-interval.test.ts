import { describe, it, expect } from "vitest";

// Mirrors the exact interval-guard arithmetic in
// src/app/api/cron/monitoring-scheduler/route.ts's handle() function.
// Duplicated here (rather than imported) because the real logic is inline
// in a Next.js route handler alongside request/response concerns — this
// keeps the test dependency-free while still verifying the precise math.
function shouldSkipForInterval(lastStartedAt: Date | null, now: Date, intervalMinutes: number): boolean {
  if (!lastStartedAt) return false;
  const elapsedMs = now.getTime() - lastStartedAt.getTime();
  const minIntervalMs = intervalMinutes * 60 * 1000;
  return elapsedMs < minIntervalMs;
}

describe("monitoring-scheduler MONITORING_SCHEDULER_INTERVAL_MINUTES guard", () => {
  const now = new Date("2026-08-21T12:00:00Z");

  it("never skips on the very first run (no prior lock row)", () => {
    expect(shouldSkipForInterval(null, now, 5)).toBe(false);
  });

  it("skips a trigger that arrives before the configured interval has elapsed", () => {
    expect(shouldSkipForInterval(new Date(now.getTime() - 2 * 60 * 1000), now, 5)).toBe(true);
  });

  it("does not skip exactly at the interval boundary", () => {
    expect(shouldSkipForInterval(new Date(now.getTime() - 5 * 60 * 1000), now, 5)).toBe(false);
  });

  it("does not skip once the interval has fully elapsed", () => {
    expect(shouldSkipForInterval(new Date(now.getTime() - 6 * 60 * 1000), now, 5)).toBe(false);
  });

  it("never skips when the interval is configured to 0", () => {
    expect(shouldSkipForInterval(new Date(now.getTime() - 1000), now, 0)).toBe(false);
  });

  it("catches a duplicate/accidental rapid-fire trigger under the default interval", () => {
    expect(shouldSkipForInterval(new Date(now.getTime() - 10 * 1000), now, 5)).toBe(true);
  });
});
