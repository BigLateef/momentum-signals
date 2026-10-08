import { describe, it, expect } from "vitest";
import { withTimeout } from "@/lib/with-timeout";

// Regression suite for a real production bug: src/middleware.ts's session-
// revocation check (via src/app/api/internal/session-check/route.ts, on the
// Supabase/postgres.js driver path) had no timeout anywhere in the chain —
// a stale postgres.js connection on a warm serverless instance could hang a
// query indefinitely, which meant middleware had no way out until Vercel's
// hard 25s function kill, surfacing as a 504 with no clean redirect.
// Confirmed in production logs: bursts of "did not return an initial
// response within 25s" errors on /admin and /auth/dashboard, clustered
// together then recovering — consistent with one bad connection on one warm
// instance eventually cycling out.
//
// Fixed in three layers: postgres.js client config (idle_timeout,
// connect_timeout, max_lifetime — src/db/index.ts; deliberately NOT
// statement_timeout, see that file's comments for why it's a real risk with
// Supabase's pooler), this withTimeout wrapper around the DB call itself
// (session-check/route.ts), and an AbortSignal.timeout on middleware's
// fetch call to that route (src/middleware.ts). Do not remove any of the
// three — each guards against a hang happening at a different point in the
// chain — and do not add statement_timeout to the postgres.js client
// config without first confirming it's safe against your specific pooler.

describe("withTimeout", () => {
  it("resolves with the real value when the promise settles well within the timeout", async () => {
    const fast = new Promise<string>((resolve) => setTimeout(() => resolve("real result"), 20));
    await expect(withTimeout(fast, 500, "test")).resolves.toBe("real result");
  });

  it("rejects via the timeout — not by hanging — when the promise never settles at all", async () => {
    // This is the exact real-world case: a stale connection's query that
    // never resolves or rejects on its own.
    const hung = new Promise<string>(() => {});
    const start = Date.now();
    await expect(withTimeout(hung, 100, "test")).rejects.toThrow(/timed out/);
    expect(Date.now() - start).toBeLessThan(300); // generous margin over the 100ms timeout
  });

  it("propagates the real error when the promise rejects on its own before the timeout", async () => {
    const failing = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("connection refused")), 20));
    await expect(withTimeout(failing, 500, "test")).rejects.toThrow("connection refused");
  });

  it("includes the provided label in the timeout error message", async () => {
    const hung = new Promise<string>(() => {});
    await expect(withTimeout(hung, 50, "session-check DB query")).rejects.toThrow("session-check DB query");
  });
});
