# Handoff — Momentum Signals

This file exists so anyone picking up this project from the zip — a friend, a
collaborator, another AI assistant, future-you — can get oriented without
needing the original chat history. It's written as of the state in this
zip; if you change things, keep this updated or it'll mislead the next
person.

## What this is

A Next.js 14 / Drizzle / TypeScript crypto momentum-signal platform. It
scans DexScreener for tokens with real price/volume momentum, runs anti-rug
safety checks (RugCheck.xyz for Solana, GoPlus Security for EVM chains),
posts signals to an invite-only dashboard, and can optionally auto-trade
qualifying signals through a burner wallet — dry-run by default, live
trading requires two separate env vars to both be explicitly true.

Deployed on **Vercel** (project `momentum-signals`), database on
**Supabase or Neon** (the app auto-detects which from `DATABASE_URL`'s
hostname — see "Database" below), cron scheduling via **cron-job.org**
hitting `/api/cron/monitoring-scheduler`.

## Current state (last known, as of this zip)

- **Deployed and live.** Vercel auto-deploys from `main` on push — confirmed
  working (there was a multi-day gap at one point where fixes sat in a zip
  and never got pushed; don't assume code in this zip is what's actually
  running in production without checking Vercel's Deployments tab).
- **Database is Supabase** (confirmed — migrations were applied through
  Supabase's own SQL editor). All three migrations (`002`, `003`, `004`)
  are confirmed applied in production.
- **`AUTO_TRADE_ENABLED=true`, `AUTO_TRADE_DRY_RUN=true`** in the live
  Vercel env — auto-trading is active but dry-run only, meaning it can log
  what it *would* do without ever signing or broadcasting a transaction.
- **Open question, actively being diagnosed:** no real `DRY_RUN` execution
  had been confirmed in the admin panel after ~13 days of this being live,
  despite signals reaching the quote-fetch stage (`NO_ROUTE_AVAILABLE`
  showing up, which only happens after a signal clears safety, confidence,
  momentum, and liquidity checks). Two live possibilities, not yet
  resolved:
  1. Current thresholds (`AUTO_TRADE_MOMENTUM_SCORE=8`,
     `AUTO_TRADE_CONFIDENCE=MEDIUM`, etc.) are simply stricter than what
     real market conditions are producing right now — not a bug.
  2. Something still blocking execution that hasn't been found yet.
  
  **The diagnostic in progress:** temporarily set
  `AUTO_TRADE_MOMENTUM_SCORE=3`, `AUTO_TRADE_CONFIDENCE=LOW`,
  `AUTO_TRADE_ENFORCE_LIQUIDITY=false`, `AUTO_TRADE_ENFORCE_SLIPPAGE=false`
  for a short window. If a `DRY_RUN` result appears, the pipeline works and
  it was just threshold tuning. If it still never fires with everything
  this loose, there's a real remaining bug. **Whoever picks this up: check
  whether this experiment was ever run and what it showed before assuming
  either conclusion.**

## Architecture at a glance

```
Scanner (DexScreener) → Momentum scoring → Safety analysis (RugCheck/GoPlus)
  → Signal created/published → Auto-trade eligibility check → dry-run or live execution
```

- **`src/db/`** — dual database driver. `driver-detect.ts` is a
  zero-dependency pure function (`detectDriver()`) deliberately kept
  separate from everything else in `src/db/` because `src/middleware.ts`
  (Edge Runtime) imports only from this file — importing from
  `raw-client.ts` instead once broke production by pulling `postgres.js`'s
  Node-only internals into the Edge bundle. `index.ts` is the app's main
  Drizzle instance; it's cast to one canonical type (`PostgresJsDatabase`)
  rather than letting the Neon/Postgres ternary produce a TypeScript union,
  which previously broke `.returning()` calls across ~12 unrelated files.
- **`src/lib/safety/`** — the anti-rug engine. `checks.ts` runs ~22
  individual checks; anything neither provider can answer honestly reports
  `UNKNOWN`, never a fabricated PASS. **RugCheck's exact response field
  shape is still only partially verified** — only `mintAuthority`/
  `freezeAuthority` were confirmed and fixed against a real production
  response (top-level fields, not nested under `.token` as originally
  guessed). Top-holder shape, LP-lock fields, holder count, and creator
  balance are still unverified. If safety verdicts still look wrong, check
  `providers/rugcheck.ts`'s raw-response capture first (see below) before
  guessing at field names again.
- **`src/lib/trading/`** — the auto-trade engine. `eligibility.ts` is a
  pure, fully unit-tested decision function — always extend it with new
  tests rather than hand-waving a fix. `executor.ts` wires it up to real
  DB/network calls. Jupiter (Solana) and PancakeSwap (BNB) adapters are in
  `dex/` — both are real, complete code but have never been exercised
  against a live RPC by whoever built this (no network access in the dev
  sandbox used).
- **`src/lib/cycle/`** — the unified scheduler's stages.
  `/api/cron/monitoring-scheduler` is the **only recommended production
  cron target**. Legacy routes (`/api/cron/scan`, `/api/cron/update-prices`,
  `/api/cron/market-cycle`) still exist for manual/rollback use but
  automatically no-op once `MONITORING_SCHEDULER_ENABLED=true`.
- **`src/middleware.ts`** — session-revocation check on every `/admin` and
  `/auth/dashboard` request. Branches by DB driver: Neon queries directly
  (Edge-compatible, zero risk); Supabase/Postgres delegates to
  `/api/internal/session-check` (a Node.js-runtime route, since
  `postgres.js` can't run in Edge). This whole chain has three layers of
  timeout (`src/db/index.ts`'s connection config, `src/lib/with-timeout.ts`
  wrapping the DB query, `AbortSignal.timeout` on middleware's own fetch) —
  added after repeated intermittent 504s traced to a stale Supabase
  connection hanging indefinitely. **Deliberately does NOT set
  `statement_timeout`** on the postgres.js client — there's a real,
  confirmed risk of Supabase's PgBouncer-family pooler rejecting it as an
  unrecognized startup parameter, which would break every connection
  outright. Don't add it back without checking that first.

## Debugging RugCheck/GoPlus field-mapping issues

If a safety check shows `UNKNOWN` even though "Provider status" in the
report says `ok` (meaning the fetch succeeded but a specific field wasn't
where the code expected it): open any signal's safety report in the admin
panel and use **"Copy report"** — it includes the actual raw provider
response whenever one was captured (`raw_provider_responses` column,
migration `004`). Compare that raw JSON against what `checks.ts` reads. This
exists specifically because the original RugCheck integration was written
from general knowledge rather than a tested live response, and got several
field names wrong — don't repeat that by guessing at new field names
without a real sample.

## Known bugs already fixed — do not reintroduce

- Dry-run auto-trade evaluations must never require a real burner wallet.
  `WALLET_NOT_CONFIGURED`/`INSUFFICIENT_WALLET_BALANCE` must be bypassed in
  dry-run (`resolveWalletEligibility()` in `eligibility.ts`) — only live
  execution needs the real wallet check.
- RugCheck's `mintAuthority`/`freezeAuthority` are top-level response
  fields, not nested under `.token`. A check must never resolve to `PASS`
  just because the field is absent — stay `UNKNOWN` unless a real value
  (including an explicit `null`, which means "confirmed renounced") is
  actually found.
- A `null` `slippageBps` (no quote/route obtained at all) must report
  `NO_ROUTE_AVAILABLE`, never `SLIPPAGE_TOO_HIGH` — those are different
  failure modes and conflating them was actively misleading during
  debugging.
- `src/middleware.ts` (Edge Runtime) must never import from any file that
  also imports `postgres.js`, even via an unused dynamic import — keep
  DB-driver detection in its own zero-dependency file.
- `src/db/index.ts`'s exported `db` must stay cast to one single type —
  letting the Neon/Postgres ternary produce a TypeScript union breaks
  `.returning()` calls app-wide.

Full list with more context: see the "Known bugs not to reintroduce" line in
project memory, or just read the comments at each fix site above — they're
written for exactly this situation.

## Deploying

```
git add -A && git commit -m "..." && git push
```

Vercel's GitHub integration deploys automatically. **Verify the deployment
actually landed** (Deployments tab, check the commit hash) — this has
silently not happened before.

## Applying a migration (no `psql` install needed)

```
npm install
export DATABASE_URL="postgresql://...your Supabase or Neon connection string..."
npx tsx src/db/run-migration.ts migrations/004_safety_raw_debug.sql
```

Or paste the SQL directly into Supabase's own SQL Editor (Project → SQL
Editor → New query → paste → Run) if you don't have a terminal handy — all
three migrations are short, additive, and safe to re-run (`IF NOT EXISTS`
throughout).

## Verification limitations — read before trusting anything in this repo blindly

Every fix in this codebase was verified by: TypeScript syntax checking
(`tsc --noResolve`, isolates real syntax errors without needing
`node_modules`), import-graph resolution scripts, and isolated unit-test
harnesses executed directly with `node --experimental-transform-types`
against the real, unmodified source files (not reimplementations). **None
of it has been through a real `npm install` + `npm run build` + `npm test`**
— the development environment used to build this had no network access to
the npm registry. The `tests/*.test.ts` files are real and should pass
under `npm test`, but this has never actually been confirmed by running
that command for real.

**First thing to do with this zip:** `npm install && npm test && npm run
build`. If anything fails, that's the actual, trustworthy signal — fix it
before assuming any of the above holds.

## Where to look for more detail

- `README.md` — feature-level documentation (safety system, auto-trading
  config, cron consolidation, API routes).
- `.env.example` — every environment variable this app reads, documented,
  with defaults.
- `migrations/` — each file's header comment explains why it exists.

## Signal card/alert redesign (migration 005)
- New: `src/lib/signal-intel/*` (pure builders/formatters/view-model; `store.ts` is the only DB code and is best-effort), `src/components/signal/*`, rewritten `SignalCard`, `signal_token_intel` table, display-only `data` on safety checks.
- GET /api/signals now also returns `tokenIntel` and a compact `safety` summary (no raw provider responses).
- Unchanged: auth, scanner thresholds, safety scoring/verdicts, eligibility, execution, alert gating/timing.
- Not integrated yet: supply, ATH/drawdown, bundler/sniper counts — see docs/SIGNAL_INTEL.md.
