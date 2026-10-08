-- Momentum Signals — migration for: anti-rug/token safety analysis,
-- configurable automated trading via a burner wallet, and the consolidated
-- market-cycle / monitoring-scheduler cron jobs.
--
-- Everything here is additive (new tables, new nullable/defaulted columns).
-- Safe to run on your existing database without downtime.
--
-- Run in Neon's SQL editor, or: psql "$DATABASE_URL" -f migrations/003_safety_and_trading.sql

-- ============================================================
-- 1. Token safety reports
-- ============================================================
CREATE TABLE IF NOT EXISTS token_safety_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID,
  token_address TEXT NOT NULL,
  chain TEXT NOT NULL,
  deployer_address TEXT,
  rug_risk_score INTEGER NOT NULL,
  safety_score INTEGER NOT NULL,
  verdict TEXT NOT NULL CHECK (
    verdict IN (
      'LOW_RISK', 'CAUTION', 'HIGH_RISK', 'VERY_HIGH_RISK',
      'CRITICAL', 'BLOCKED', 'INSUFFICIENT_DATA'
    )
  ),
  checks JSONB NOT NULL,
  warnings JSONB NOT NULL,
  data_sources JSONB NOT NULL,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_safety_reports_token_chain
  ON token_safety_reports(token_address, chain, analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_safety_reports_signal
  ON token_safety_reports(signal_id);
CREATE INDEX IF NOT EXISTS idx_safety_reports_deployer
  ON token_safety_reports(deployer_address, chain);

-- ============================================================
-- 2. Safety fields on signals
-- ============================================================
ALTER TABLE signals ADD COLUMN IF NOT EXISTS safety_report_id UUID;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS rug_risk_score INTEGER;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS safety_score INTEGER;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS safety_verdict TEXT;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS safety_override BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS safety_override_reason TEXT;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS safety_override_by UUID;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS safety_override_at TIMESTAMPTZ;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS safety_checked_at TIMESTAMPTZ;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS tp1_hit_at TIMESTAMPTZ;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS tp2_hit_at TIMESTAMPTZ;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS invalidation_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'signals_safety_verdict_check'
  ) THEN
    ALTER TABLE signals ADD CONSTRAINT signals_safety_verdict_check
      CHECK (
        safety_verdict IS NULL OR safety_verdict IN (
          'LOW_RISK', 'CAUTION', 'HIGH_RISK', 'VERY_HIGH_RISK',
          'CRITICAL', 'BLOCKED', 'INSUFFICIENT_DATA'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_signals_safety_verdict ON signals(safety_verdict);

-- ============================================================
-- 3. Auto-trade executions
-- ============================================================
CREATE TABLE IF NOT EXISTS auto_trade_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL')),
  chain TEXT NOT NULL,
  token_address TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  amount_in NUMERIC,
  amount_out NUMERIC,
  quoted_price NUMERIC,
  executed_price NUMERIC,
  slippage_bps INTEGER,
  transaction_id TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('ELIGIBLE', 'SKIPPED', 'DRY_RUN', 'SUBMITTED', 'CONFIRMED', 'FAILED')
  ),
  skip_reason TEXT,
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_exec_signal ON auto_trade_executions(signal_id);
CREATE INDEX IF NOT EXISTS idx_trade_exec_status_created ON auto_trade_executions(status, created_at DESC);
-- Enforces "no duplicate execution" at the DB level for anything that made it
-- past ELIGIBLE/SKIPPED (i.e. an actual submitted/dry-run attempt per signal+action).
CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_exec_signal_action_live
  ON auto_trade_executions(signal_id, action)
  WHERE status IN ('DRY_RUN', 'SUBMITTED', 'CONFIRMED');

-- ============================================================
-- 4. Cron lock (lease-based — see src/lib/cron-lock.ts for why this is a
--    table instead of pg_advisory_lock: Neon's HTTP driver has no
--    persistent session to hold a session-level lock across requests)
-- ============================================================
CREATE TABLE IF NOT EXISTS cron_locks (
  name TEXT PRIMARY KEY,
  locked_until TIMESTAMPTZ NOT NULL,
  run_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL
);

-- ============================================================
-- 5. System settings (kill switch, scheduler authority flag)
-- ============================================================
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the kill switch OFF (auto-trade blocked) and legacy-cron-active ON,
-- i.e. safe defaults that don't change behavior until an admin opts in.
INSERT INTO system_settings (key, value)
VALUES ('auto_trade_kill_switch', 'false')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- ROLLBACK (manual — run only if you need to fully revert this migration)
-- ============================================================
-- DROP TABLE IF EXISTS auto_trade_executions;
-- DROP TABLE IF EXISTS token_safety_reports;
-- DROP TABLE IF EXISTS cron_locks;
-- DROP TABLE IF EXISTS system_settings;
-- ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_safety_verdict_check;
-- ALTER TABLE signals
--   DROP COLUMN IF EXISTS safety_report_id,
--   DROP COLUMN IF EXISTS rug_risk_score,
--   DROP COLUMN IF EXISTS safety_score,
--   DROP COLUMN IF EXISTS safety_verdict,
--   DROP COLUMN IF EXISTS safety_override,
--   DROP COLUMN IF EXISTS safety_override_reason,
--   DROP COLUMN IF EXISTS safety_override_by,
--   DROP COLUMN IF EXISTS safety_override_at,
--   DROP COLUMN IF EXISTS safety_checked_at,
--   DROP COLUMN IF EXISTS tp1_hit_at,
--   DROP COLUMN IF EXISTS tp2_hit_at,
--   DROP COLUMN IF EXISTS invalidated_at,
--   DROP COLUMN IF EXISTS invalidation_reason;
-- Note: rolling back does NOT re-enable live trading or change any env vars.
-- After rollback, redeploy a build from before this upgrade, or remove the
-- new route files under src/app/api/safety, src/app/api/triggers/safety.ts,
-- src/app/api/triggers/execute-trade, src/app/api/cron/market-cycle,
-- src/app/api/cron/monitoring-scheduler and src/lib/safety, src/lib/trading,
-- src/lib/cycle.
