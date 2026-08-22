import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import postgres from "postgres";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { detectDriver } from "./raw-client";

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
export const db =
  driver === "neon"
    ? drizzleNeon(neon(databaseUrl), { schema })
    : drizzlePg(postgres(databaseUrl, { prepare: false, max: 1 }), { schema });
