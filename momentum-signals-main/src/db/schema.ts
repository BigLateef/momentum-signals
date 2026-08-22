import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  primaryKey,
  jsonb,
} from "drizzle-orm/pg-core";

// Verdicts a safety analysis can produce. Kept as a plain string union (not a
// pg enum) so new verdicts can be added without a migration.
export const SAFETY_VERDICTS = [
  "LOW_RISK",
  "CAUTION",
  "HIGH_RISK",
  "VERY_HIGH_RISK",
  "CRITICAL",
  "BLOCKED",
  "INSUFFICIENT_DATA",
] as const;
export type SafetyVerdict = (typeof SAFETY_VERDICTS)[number];

export const inviteCodes = pgTable("invite_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 10 }).notNull().unique(),
  createdBy: uuid("created_by"),
  isUsed: boolean("is_used").default(false).notNull(),
  usedBy: uuid("used_by").unique(),
  useCount: integer("use_count").default(0).notNull(),
  maxUses: integer("max_uses").default(1).notNull(),
  revoked: boolean("revoked").default(false).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const profiles = pgTable("profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  username: text("username").unique(),
  role: text("role", { enum: ["user", "admin"] }).default("user").notNull(),
  invitedBy: uuid("invited_by"),
  // Bumped by an admin to invalidate every JWT already issued to this user —
  // the session is checked against this value on every request.
  sessionVersion: integer("session_version").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastLogin: timestamp("last_login", { withTimezone: true }).defaultNow().notNull(),
});

export const signals = pgTable("signals", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenName: text("token_name").notNull(),
  ticker: text("ticker").notNull(),
  contractAddress: text("contract_address"),
  chain: text("chain").default("Solana").notNull(),
  exchange: text("exchange"),
  signalType: text("signal_type", {
    enum: ["BUY", "SELL", "ALERT", "LAUNCH"],
  }).notNull(),
  entryPrice: numeric("entry_price"),
  currentPrice: numeric("current_price"),
  targetPrice1: numeric("target_price_1"),
  targetPrice2: numeric("target_price_2"),
  stopLoss: numeric("stop_loss"),
  momentumScore: integer("momentum_score"),
  reason: text("reason"),
  chartUrl: text("chart_url"),
  confidence: text("confidence", { enum: ["LOW", "MEDIUM", "HIGH"] }),
  isActive: boolean("is_active").default(true).notNull(),
  // Cached summary from the KOL-holder check, e.g. "3 tracked KOLs · 4.1% supply"
  kolSummary: text("kol_summary"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),

  // --- Anti-rug / token safety (added by migration 003) ---
  safetyReportId: uuid("safety_report_id"),
  rugRiskScore: integer("rug_risk_score"), // 0-100, higher = riskier
  safetyScore: integer("safety_score"), // 0-100, higher = safer
  safetyVerdict: text("safety_verdict", { enum: SAFETY_VERDICTS }),
  safetyOverride: boolean("safety_override").default(false).notNull(),
  safetyOverrideReason: text("safety_override_reason"),
  safetyOverrideBy: uuid("safety_override_by"),
  safetyOverrideAt: timestamp("safety_override_at", { withTimezone: true }),
  safetyCheckedAt: timestamp("safety_checked_at", { withTimezone: true }),

  // --- Lifecycle extensions used by the safety/auto-trade upgrade ---
  // Marks TP1/TP2 hits so the lifecycle stage doesn't re-fire the same event.
  tp1HitAt: timestamp("tp1_hit_at", { withTimezone: true }),
  tp2HitAt: timestamp("tp2_hit_at", { withTimezone: true }),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  invalidationReason: text("invalidation_reason"),
});

// Lets users star/save signals to a personal watchlist
export const watchlist = pgTable(
  "watchlist",
  {
    userId: uuid("user_id").notNull(),
    signalId: uuid("signal_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.signalId] }),
  })
);

// Records every admin/system action for accountability.
export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: uuid("actor_id"), // null = system action (scanner, cron)
  actorLabel: text("actor_label"), // denormalized email/"system" snapshot, survives actor deletion
  action: text("action").notNull(), // e.g. "signal.post", "invite.revoke", "session.revoke"
  targetType: text("target_type"), // e.g. "signal", "invite_code", "profile"
  targetId: text("target_id"),
  metadata: text("metadata"), // JSON-stringified details
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Admin-curated list of known KOL (key opinion leader) wallets to check
// token holder lists against.
export const kolWallets = pgTable("kol_wallets", {
  id: uuid("id").defaultRandom().primaryKey(),
  chain: text("chain").notNull(),
  address: text("address").notNull(),
  label: text("label").notNull(),
  addedBy: uuid("added_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// One anti-rug / token-safety analysis snapshot. A token can have many rows
// over time (re-analysis); `signals.safetyReportId` points at the one that
// was current when the signal was created or last checked.
export const tokenSafetyReports = pgTable("token_safety_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  signalId: uuid("signal_id"), // nullable — a report can be run standalone via /api/safety/analyze
  tokenAddress: text("token_address").notNull(),
  chain: text("chain").notNull(),
  // Denormalized from checks.creatorAllocation's source data, when available —
  // lets deployerHistory/previousTokenLaunches query cheaply without scanning JSON.
  deployerAddress: text("deployer_address"),
  rugRiskScore: integer("rug_risk_score").notNull(), // 0-100, higher = riskier
  safetyScore: integer("safety_score").notNull(), // 0-100, higher = safer
  verdict: text("verdict", { enum: SAFETY_VERDICTS }).notNull(),
  checks: jsonb("checks").notNull(), // array of SafetyCheckResult (see src/lib/safety/types.ts)
  warnings: jsonb("warnings").notNull(), // array of human-readable warning strings
  dataSources: jsonb("data_sources").notNull(), // e.g. { rugcheck: "ok", dexscreener: "ok", goplus: "unavailable" }
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Every automated trade attempt — including ones that were skipped or
// dry-run — so the admin panel can show a full decision trail.
export const autoTradeExecutions = pgTable("auto_trade_executions", {
  id: uuid("id").defaultRandom().primaryKey(),
  signalId: uuid("signal_id").notNull(),
  action: text("action", { enum: ["BUY", "SELL"] }).notNull(),
  chain: text("chain").notNull(),
  tokenAddress: text("token_address").notNull(),
  baseCurrency: text("base_currency").notNull(), // SOL | USDC
  amountIn: numeric("amount_in"),
  amountOut: numeric("amount_out"),
  quotedPrice: numeric("quoted_price"),
  executedPrice: numeric("executed_price"),
  slippageBps: integer("slippage_bps"),
  transactionId: text("transaction_id"),
  status: text("status", {
    enum: [
      "ELIGIBLE",
      "SKIPPED",
      "DRY_RUN",
      "SUBMITTED",
      "CONFIRMED",
      "FAILED",
    ],
  }).notNull(),
  skipReason: text("skip_reason"),
  dryRun: boolean("dry_run").default(true).notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Lease-based lock for scheduled jobs. Neon's HTTP driver doesn't hold a
// persistent session, so a Postgres session-level advisory lock isn't usable
// across requests — this row-based lease is the safe equivalent for a
// serverless/HTTP-driver setup. See src/lib/cron-lock.ts.
export const cronLocks = pgTable("cron_locks", {
  name: text("name").primaryKey(), // e.g. "market-cycle", "monitoring-scheduler"
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
  runId: text("run_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
});

// Small key/value store for runtime-toggleable settings that shouldn't
// require a redeploy — currently the auto-trade emergency kill switch and
// the "unified scheduler is authoritative" flag.
export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
