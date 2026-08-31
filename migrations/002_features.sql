-- Momentum Signals — migration for: audit log, KOL wallet tracking,
-- session revocation, and cached KOL summary on signals.
-- Safe to run on your existing database — everything here is additive.
-- Run in Neon's SQL editor, or: psql "$DATABASE_URL" -f migrations/002_features.sql

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE signals ADD COLUMN IF NOT EXISTS kol_summary TEXT;

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  actor_label TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kol_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  label TEXT NOT NULL,
  added_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kol_wallets_chain ON kol_wallets(chain);
