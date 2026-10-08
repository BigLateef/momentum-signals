import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectDriver } from "@/db/raw-client";

let savedDbDriver: string | undefined;

beforeEach(() => {
  savedDbDriver = process.env.DB_DRIVER;
  delete process.env.DB_DRIVER;
});

afterEach(() => {
  if (savedDbDriver === undefined) delete process.env.DB_DRIVER;
  else process.env.DB_DRIVER = savedDbDriver;
});

describe("detectDriver — auto-detection from DATABASE_URL", () => {
  it("detects a Neon pooled connection string as neon", () => {
    expect(
      detectDriver(
        "postgresql://neondb_owner:pw@ep-cool-forest-12345678-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"
      )
    ).toBe("neon");
  });

  it("detects a Neon direct (non-pooled) connection string as neon", () => {
    expect(
      detectDriver("postgresql://neondb_owner:pw@ep-cool-forest-12345678.us-east-2.aws.neon.tech/neondb?sslmode=require")
    ).toBe("neon");
  });

  it("detects a Supabase transaction pooler URL as postgres", () => {
    expect(
      detectDriver("postgresql://postgres.abcdefghijklmnop:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres")
    ).toBe("postgres");
  });

  it("detects a Supabase session pooler URL as postgres", () => {
    expect(
      detectDriver("postgresql://postgres.abcdefghijklmnop:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres")
    ).toBe("postgres");
  });

  it("detects a Supabase direct connection URL as postgres", () => {
    expect(detectDriver("postgresql://postgres:pw@db.abcdefghijklmnop.supabase.co:5432/postgres")).toBe("postgres");
  });

  it("detects any other standard Postgres host (e.g. Railway) as postgres", () => {
    expect(detectDriver("postgresql://user:pw@my-railway-instance.railway.app:5432/railway")).toBe("postgres");
  });

  it("DB_DRIVER override wins even against a neon.tech host", () => {
    process.env.DB_DRIVER = "postgres";
    expect(detectDriver("postgresql://user:pw@ep-cool-forest-pooler.us-east-2.aws.neon.tech/neondb")).toBe("postgres");
  });

  it("DB_DRIVER override wins even against a non-Neon host", () => {
    process.env.DB_DRIVER = "neon";
    expect(detectDriver("postgresql://postgres@db.supabase.co:5432/postgres")).toBe("neon");
  });

  it("DB_DRIVER override is case-insensitive", () => {
    process.env.DB_DRIVER = "NEON";
    expect(detectDriver("postgresql://postgres@db.supabase.co:5432/postgres")).toBe("neon");
  });

  it("an invalid DB_DRIVER value falls back to auto-detection instead of throwing", () => {
    process.env.DB_DRIVER = "mysql";
    expect(detectDriver("postgresql://postgres@db.supabase.co:5432/postgres")).toBe("postgres");
    expect(detectDriver("postgresql://user@ep-x-pooler.neon.tech/db")).toBe("neon");
  });
});
