import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import postgres from "postgres";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { detectDriver } from "./driver-detect";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const databaseUrl = process.env.DATABASE_URL;
const driver = detectDriver(databaseUrl);

// Neon path (default, unchanged from before): HTTP driver, no persistent
// connection — the fit for Vercel serverless functions this app was
// originally built around.
//
// Postgres path (Supabase or any other standard Postgres): real TCP
// connection via postgres.js. max:1 keeps each serverless invocation to a
// single connection so a burst of cold starts can't exhaust your
// provider's connection limit — point DATABASE_URL at a pooled connection
// string (Supabase's "Transaction pooler", port 6543; or Neon's own
// "-pooler" endpoint if you ever switch DB_DRIVER=postgres against Neon)
// rather than a direct one. prepare:false is required for pgbouncer
// transaction-mode pooling and harmless otherwise.
//
// idle_timeout / connect_timeout / max_lifetime: found necessary in
// production (repeated, intermittent 504s from src/middleware.ts — "did not
// return an initial response within 25s" — clustered in bursts then
// recovering, consistent with one warm serverless instance's single
// long-lived connection going stale and every query on it hanging instead
// of erroring). Without these, a stale connection has no way to
// self-correct — the client just waits forever for a response that isn't
// coming, and nothing times out until Vercel's hard 25s function kill.
// idle_timeout forces the connection closed (and a fresh one opened) after
// a period of inactivity; max_lifetime forces periodic reconnection even
// under constant use; connect_timeout bounds how long establishing a new
// connection itself is allowed to take.
//
// Deliberately NOT setting statement_timeout here, even though it would be
// the more direct server-side fix for a hung query specifically: it isn't
// in postgres.js's documented connection-options list (only idle_timeout/
// connect_timeout/max_lifetime are), and there are confirmed real-world
// reports of PgBouncer-family poolers — which is what Supabase's pooler is
// — rejecting an unrecognized statement_timeout startup parameter outright
// ("unsupported startup parameter: statement_timeout"), which would fail
// EVERY connection, not just fail to apply a timeout. That's a much worse
// outcome than the intermittent hang this is meant to fix, so this relies
// instead on the client-side timeout in
// src/app/api/internal/session-check/route.ts (src/lib/with-timeout.ts) to
// bound an individual query, plus idle_timeout/max_lifetime here to keep
// recycling connections so a bad one doesn't persist indefinitely. If you
// ever want real server-side query cancellation, do it via Supabase's own
// dashboard-level statement timeout setting (if offered) rather than a
// client-supplied startup parameter.
const rawDb =
  driver === "neon"
    ? drizzleNeon(neon(databaseUrl), { schema })
    : drizzlePg(
        postgres(databaseUrl, {
          prepare: false,
          max: 1,
          idle_timeout: 20,
          connect_timeout: 10,
          max_lifetime: 60 * 30,
        }),
        { schema }
      );

// IMPORTANT: cast to a single canonical type rather than letting TypeScript
// infer `NeonHttpDatabase<Schema> | PostgresJsDatabase<Schema>` from the
// ternary above. A union of two different Drizzle adapter types breaks
// TypeScript's call-signature resolution on chained builder methods
// elsewhere in the app (confirmed in production: `.returning({ email:
// profiles.email })` in src/app/api/admin/revoke-session/route.ts failed to
// compile with "Expected 0 arguments, but got 1" once `db` became a union —
// that file was never touched by this change, the union type broke it).
// Both adapters extend the same PgDatabase base and support an identical
// query-building surface for every CRUD operation this app actually uses;
// the cast just gives every caller one consistent type to check against
// instead of TypeScript intersecting two almost-but-not-quite-identical
// overload sets. `as unknown as` is required (not a plain `as`) because the
// two concrete types aren't directly assignable to each other despite being
// behaviorally interchangeable here.
//
// One real (not just cosmetic) difference between the two drivers exists:
// drizzle-orm/neon-http's db.transaction() throws at runtime, because
// Neon's HTTP driver has no persistent connection to hold a BEGIN/COMMIT
// across — postgres-js supports transactions fine. The cast above would
// hide that difference from the type checker if any code called
// db.transaction() while running on the Neon driver. Checked: nothing in
// this codebase calls db.transaction() anywhere (grepped before adding this
// cast), so that gap is currently inert — but it's the one thing to be
// aware of if you ever add a multi-statement transaction and only test it
// against Supabase/postgres.js, since it would silently fail against Neon.
export const db = rawDb as unknown as PostgresJsDatabase<typeof schema>;
