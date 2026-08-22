import fs from "node:fs";
import path from "node:path";
import { createStatementRunner } from "./raw-client";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  const { driver, run, close } = await createStatementRunner(process.env.DATABASE_URL);
  console.log(`Using ${driver} driver (auto-detected from DATABASE_URL; override with DB_DRIVER=neon|postgres).`);

  const schemaPath = path.join(process.cwd(), "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf-8");

  // Split on semicolons that end a statement (naive but fine for this schema file)
  const statements = schemaSql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  try {
    for (const statement of statements) {
      console.log("Running:", statement.slice(0, 60).replace(/\n/g, " "), "...");
      await run(statement);
    }
    console.log("✅ Schema applied.");
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
