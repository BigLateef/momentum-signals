// Applies a single raw SQL migration file (from /migrations) to the live
// database — Neon or Supabase (or any standard Postgres), auto-detected
// from DATABASE_URL, or forced with DB_DRIVER=neon|postgres. No `psql`
// client install needed in Termux, and no web SQL editor needed either.
//
// Usage:
//   npx tsx src/db/run-migration.ts migrations/003_safety_and_trading.sql
//
// This does NOT use drizzle-kit's migration system — this project's numbered
// /migrations/*.sql files are raw, hand-written, additive SQL applied
// out-of-band (see src/db/migrate.ts for the separate initial-schema.sql
// bootstrap script, which is a different file). Statements are split on
// semicolons; the migration files in this repo avoid semicolons inside
// string literals/function bodies, so the naive split below is safe for them
// specifically — it is not a general-purpose SQL parser.
import fs from "node:fs";
import path from "node:path";
import { createStatementRunner } from "./raw-client";

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error("Usage: npx tsx src/db/run-migration.ts <path-to-migration.sql>");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Export it first: export DATABASE_URL='postgresql://...'");
  }

  const migrationPath = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
  const sqlText = fs.readFileSync(migrationPath, "utf-8");

  // Strip full-line comments, then split into statements on semicolons.
  // DO $$ ... $$ blocks (used for the conditional CHECK constraint) contain
  // semicolons internally, so they're detected and kept whole.
  const withoutComments = sqlText
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  const statements: string[] = [];
  let buffer = "";
  let inDollarBlock = false;
  for (const chunk of withoutComments.split(/(?<=;)/)) {
    buffer += chunk;
    if (/DO\s+\$\$/i.test(buffer) && !inDollarBlock) inDollarBlock = true;
    if (inDollarBlock && /\$\$\s*;\s*$/.test(buffer.trim())) {
      inDollarBlock = false;
      statements.push(buffer.trim());
      buffer = "";
      continue;
    }
    if (!inDollarBlock && buffer.trim().endsWith(";")) {
      statements.push(buffer.trim());
      buffer = "";
    }
  }
  if (buffer.trim()) statements.push(buffer.trim());

  const { driver, run, close } = await createStatementRunner(process.env.DATABASE_URL);
  console.log(`Using ${driver} driver (auto-detected from DATABASE_URL; override with DB_DRIVER=neon|postgres).`);
  console.log(`Applying ${migrationPath} — ${statements.length} statement(s)...`);

  try {
    for (const [i, statement] of statements.entries()) {
      if (!statement || statement.startsWith("--")) continue;
      const preview = statement.replace(/\s+/g, " ").slice(0, 70);
      console.log(`[${i + 1}/${statements.length}] ${preview}...`);
      await run(statement);
    }
    console.log("✅ Migration applied successfully.");
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
