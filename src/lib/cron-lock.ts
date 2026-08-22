// A lease-based row lock, not a Postgres session-level advisory lock
// (pg_advisory_lock). Two independent reasons this app needs that instead:
//   1. Neon's HTTP driver (drizzle-orm/neon-http) issues each query as its
//      own HTTP request with no persistent session — an advisory lock can't
//      span multiple requests in that setup at all.
//   2. Even on a real TCP connection (Supabase or any other Postgres), this
//      app is meant to run behind a connection pooler in transaction mode
//      (Supabase's "Transaction pooler", PgBouncer, etc. — see README) for
//      serverless compatibility. Transaction-mode pooling can hand a
//      different underlying server connection to each statement, and
//      session-scoped advisory locks are tied to one specific connection —
//      so they silently stop working correctly under that kind of pooling
//      regardless of driver.
// A lease-based row lock (claim by writing a row with an expiry in the
// future, via a conditional INSERT) has neither problem — it works
// identically for both drivers and both connection topologies.

import { db } from "@/db";
import { cronLocks } from "@/db/schema";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";

export type LockHandle = { name: string; runId: string };

// Reads the most recent lock claim's start time for a given lock name,
// without acquiring it — used to enforce a minimum interval between runs
// (e.g. MONITORING_SCHEDULER_INTERVAL_MINUTES) independently of whether the
// previous run is still holding the lease.
export async function getLastRunStartedAt(name: string): Promise<Date | null> {
  const result = await db.execute(sql`SELECT started_at FROM cron_locks WHERE name = ${name}`);
  const rows = (result as any).rows ?? result;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const value = rows[0].started_at;
  return value ? new Date(value) : null;
}

export async function acquireLock(name: string, leaseSeconds: number): Promise<LockHandle | null> {
  const runId = randomUUID();
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + leaseSeconds * 1000);

  // Atomic claim: insert if the row doesn't exist, or steal it if the
  // existing lease has expired. If another run holds a live lease, the
  // WHERE clause on the DO UPDATE means the row is left untouched — the
  // RETURNING clause then reveals whether *we* actually got it.
  const result = await db.execute(sql`
    INSERT INTO cron_locks (name, locked_until, run_id, started_at)
    VALUES (${name}, ${lockedUntil.toISOString()}, ${runId}, ${now.toISOString()})
    ON CONFLICT (name) DO UPDATE
      SET locked_until = EXCLUDED.locked_until,
          run_id = EXCLUDED.run_id,
          started_at = EXCLUDED.started_at
      WHERE cron_locks.locked_until < ${now.toISOString()}
    RETURNING run_id
  `);

  const rows = (result as any).rows ?? result;
  const won = Array.isArray(rows) && rows.length > 0 && rows[0].run_id === runId;
  return won ? { name, runId } : null;
}

export async function releaseLock(handle: LockHandle | null): Promise<void> {
  if (!handle) return;
  try {
    // Only release if we still hold it (run_id matches) — prevents a slow
    // run from releasing a lease that's since been claimed by a newer run.
    await db.execute(sql`
      UPDATE cron_locks
      SET locked_until = NOW() - INTERVAL '1 second'
      WHERE name = ${handle.name} AND run_id = ${handle.runId}
    `);
  } catch (err) {
    console.error("Failed to release cron lock (it will expire naturally):", err);
  }
}

// Convenience wrapper: acquire, run, always release (even on throw).
export async function withLock<T>(
  name: string,
  leaseSeconds: number,
  fn: () => Promise<T>
): Promise<{ ran: true; result: T } | { ran: false; reason: "LOCKED" }> {
  const handle = await acquireLock(name, leaseSeconds);
  if (!handle) return { ran: false, reason: "LOCKED" };
  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    await releaseLock(handle);
  }
}
