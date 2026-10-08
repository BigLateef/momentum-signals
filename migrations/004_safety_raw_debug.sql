-- Momentum Signals — adds a debug column for capturing the most recent raw
-- provider response (RugCheck/GoPlus) alongside each safety analysis.
--
-- Why: the original RugCheck field mapping (src/lib/safety/providers/
-- rugcheck.ts) was written from general knowledge of what a "rug check" API
-- would plausibly return, never validated against a live response. In
-- production, requests succeeded (HTTP 200) but almost every field the app
-- tried to read came back empty — meaning the real response shape didn't
-- match what was assumed. This column captures the raw response text so it
-- can be pulled via the app's own Safety Report UI ("Copy report" button)
-- and used to fix field mappings definitively, without needing terminal or
-- curl access on a mobile-only workflow.
--
-- Additive only — new nullable column, nothing dropped or recreated. Safe
-- to run without downtime.
--
-- Run in Neon's SQL editor or via: npx tsx src/db/run-migration.ts migrations/004_safety_raw_debug.sql

ALTER TABLE token_safety_reports ADD COLUMN IF NOT EXISTS raw_provider_responses JSONB;

-- ============================================================
-- ROLLBACK (manual — run only if you need to fully revert this migration)
-- ============================================================
-- ALTER TABLE token_safety_reports DROP COLUMN IF EXISTS raw_provider_responses;
