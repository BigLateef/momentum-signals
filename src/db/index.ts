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
const rawDb =
  driver === "neon"
    ? drizzleNeon(neon(databaseUrl), { schema })
    : drizzlePg(postgres(databaseUrl, { prepare: false, max: 1 }), { schema });

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
