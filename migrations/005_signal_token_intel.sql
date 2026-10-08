-- Momentum Signals — adds a per-signal market/identity snapshot used by the
-- richer signal cards and alerts (src/lib/signal-intel/).
--
-- Why a separate table instead of new columns on `signals`: the app's signals
-- queries use `select *`, so adding columns to `signals` would make every
-- existing read fail if this migration were ever missed or applied late. A
-- new table is only touched by best-effort code paths that degrade to
-- "market data unavailable" when it is absent — nothing existing depends on it.
--
-- One row per signal, overwritten by each price-refresh cycle while the
-- signal is active (and written once at scan time). `snapshot` is versioned
-- JSON (see TokenIntel in src/lib/signal-intel/types.ts); every field inside
-- is either a real DexScreener value or null — never defaulted or inferred.
--
-- Additive only — nothing dropped or altered. Safe to re-run (IF NOT EXISTS).
--
-- Apply the same way as 002-004: Supabase/Neon SQL editor, or
--   npx tsx src/db/run-migration.ts migrations/005_signal_token_intel.sql

CREATE TABLE IF NOT EXISTS signal_token_intel (
  signal_id   UUID PRIMARY KEY,
  snapshot    JSONB NOT NULL,
  source      TEXT NOT NULL DEFAULT 'dexscreener',
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ROLLBACK (manual — run only if you need to fully revert this migration)
-- ============================================================
-- DROP TABLE IF EXISTS signal_token_intel;
