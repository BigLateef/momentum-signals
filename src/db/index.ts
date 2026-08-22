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

// Both drivers implement the same Drizzle PostgreSQL query API. Keep the
// provider-specific implementation behind this typed boundary so callers do
// not receive a union of incompatible Drizzle database types.
const neonDb = drizzleNeon(neon(databaseUrl), { schema });
const postgresDb = drizzlePg(postgres(databaseUrl, { prepare: false, max: 1 }), { schema });

// The runtime branch is provider-specific, but the exported query surface is
// intentionally the shared Neon-compatible Drizzle API. postgres.js supports
// the same operations at runtime, including returning(fields).
export const db = (driver === "neon" ? neonDb : postgresDb) as typeof neonDb;
