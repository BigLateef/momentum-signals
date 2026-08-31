// Lets this app run against either Neon (HTTP driver, no persistent
// connection — what it was built for) or Supabase/any standard Postgres
// (real TCP connection via postgres.js) without maintaining two copies of
// the app's query logic. See src/db/driver-detect.ts for detectDriver
// itself — it lives in its own zero-dependency file so src/middleware.ts
// (Edge runtime) can import it without also pulling in this file's
// createStatementRunner, which references "postgres" (Node-only, not
// Edge-compatible). Do not move detectDriver back into this file.
export { detectDriver, type DbDriver } from "./driver-detect";
import { detectDriver } from "./driver-detect";

// Used only by the one-off migration scripts (src/db/migrate.ts,
// src/db/run-migration.ts), which need to run whole raw SQL statements
// outside of Drizzle's query builder. The app's actual runtime query layer
// is src/db/index.ts, which talks to Drizzle directly per-driver instead of
// going through this generic runner (keeps the hot path un-abstracted).
export async function createStatementRunner(databaseUrl: string) {
  const driver = detectDriver(databaseUrl);

  if (driver === "neon") {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(databaseUrl);
    return {
      driver,
      run: (statement: string, params?: unknown[]) => sql(statement, params ?? []),
      // Neon's HTTP driver has no persistent connection to close.
      close: async () => {},
    };
  }

  const { default: postgres } = await import("postgres");
  // prepare:false is required for Supabase's transaction pooler (pgbouncer
  // in transaction mode doesn't support prepared statements) and is
  // harmless against a direct connection or session pooler too, so it's
  // left on unconditionally rather than trying to detect which mode the
  // person picked.
  const sql = postgres(databaseUrl, { prepare: false, max: 1 });
  return {
    driver,
    // sql.unsafe(query, params) still binds params as real query parameters
    // (not string interpolation) even though the query text itself bypasses
    // postgres.js's tagged-template builder — same safety guarantee as the
    // neon branch above, just a different call shape.
    run: (statement: string, params?: unknown[]) => sql.unsafe(statement, params as any),
    // postgres.js holds a real TCP socket open — must be closed explicitly
    // or a one-off script will hang after finishing instead of exiting.
    close: () => sql.end({ timeout: 5 }),
  };
}
