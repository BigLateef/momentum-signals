-- Momentum Signals — one-time Neon setup script
-- Run this in the Neon SQL editor, or via `psql $DATABASE_URL -f schema.sql`

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  username TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  invited_by UUID REFERENCES profiles(id),
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(10) UNIQUE NOT NULL,
  created_by UUID REFERENCES profiles(id),
  is_used BOOLEAN NOT NULL DEFAULT false,
  used_by UUID UNIQUE REFERENCES profiles(id),
  use_count INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER NOT NULL DEFAULT 1,
  revoked BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  contract_address TEXT,
  chain TEXT NOT NULL DEFAULT 'Solana',
  exchange TEXT,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('BUY', 'SELL', 'ALERT', 'LAUNCH')),
  entry_price NUMERIC,
  current_price NUMERIC,
  target_price_1 NUMERIC,
  target_price_2 NUMERIC,
  stop_loss NUMERIC,
  momentum_score INTEGER CHECK (momentum_score >= 1 AND momentum_score <= 10),
  reason TEXT,
  chart_url TEXT,
  confidence TEXT CHECK (confidence IN ('LOW', 'MEDIUM', 'HIGH')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  kol_summary TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS watchlist (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, signal_id)
);

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

CREATE INDEX IF NOT EXISTS idx_signals_chain ON signals(chain);
CREATE INDEX IF NOT EXISTS idx_signals_type ON signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kol_wallets_chain ON kol_wallets(chain);

-- After creating your first account, promote it to admin:
-- UPDATE profiles SET role = 'admin' WHERE email = 'your-email@domain.com';
