// Deliberately a standalone file with ZERO imports. This is the only DB-layer
// module that src/middleware.ts (Edge runtime) is allowed to import — every
// other file under src/db/ eventually imports "postgres" and/or
// "@neondatabase/serverless", and Next's Edge bundler statically traces the
// whole module graph reachable from an Edge file, not just the exports that
// file actually calls. Even a *dynamic* `await import("postgres")` inside an
// unrelated function in the same file is enough to make Next flag Node-only
// built-ins (net, tls, fs, ...) as unsupported in the Edge Runtime — it
// happened in production once already (see git history / build log from
// 2026-08-22), which is why this function lives alone in its own file rather
// than sitting next to createStatementRunner in raw-client.ts.
export type DbDriver = "neon" | "postgres";

export function detectDriver(databaseUrl: string): DbDriver {
  const override = process.env.DB_DRIVER?.toLowerCase();
  if (override === "neon" || override === "postgres") return override;
  // Neon's HTTP driver only speaks to Neon's own endpoint — every other
  // provider (Supabase, Railway, RDS, plain self-hosted Postgres, etc.)
  // needs a real TCP connection, so "postgres" is the safe default guess.
  return databaseUrl.includes(".neon.tech") ? "neon" : "postgres";
}
