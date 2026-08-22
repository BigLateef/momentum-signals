// Central parser for every AUTO_TRADE_* env var. Nothing here executes a
// trade — it only turns env strings into a typed config object with the
// documented defaults, which is intentionally conservative:
// AUTO_TRADE_ENABLED and AUTO_TRADE_DRY_RUN default to the safest state
// (disabled / dry-run) so a missing env var never silently enables live
// trading.

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null) return fallback;
  return v.toLowerCase() === "true";
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export type AutoTradeChain = "SOLANA" | "BNB";
export type BaseCurrency = "SOL" | "USDC";
export type Confidence = "LOW" | "MEDIUM" | "HIGH";

export type AutoTradeConfig = {
  enabled: boolean;
  dryRun: boolean;
  buyEnabled: boolean;
  sellEnabled: boolean;
  chain: AutoTradeChain;
  baseCurrency: BaseCurrency;
  minConfidence: Confidence;
  minMomentumScore: number;
  maxSignalAgeSeconds: number;
  maxEntryDeviationPct: number;
  enforceLiquidity: boolean;
  minLiquidityUsd: number;
  enforceSlippage: boolean;
  maxSlippageBps: number;
  amountSol: number;
  amountUsdc: number;
  maxDailyTrades: number;
  maxDailyLossUsd: number;
  dedupeWindowSeconds: number;
};

const CONFIDENCE_RANK: Record<Confidence, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export function meetsConfidence(actual: Confidence | null, required: Confidence): boolean {
  if (!actual) return false;
  return CONFIDENCE_RANK[actual] >= CONFIDENCE_RANK[required];
}

export function getAutoTradeConfig(): AutoTradeConfig {
  const chain = (process.env.AUTO_TRADE_CHAIN ?? "SOLANA").toUpperCase();
  const baseCurrency = (process.env.AUTO_TRADE_BASE_CURRENCY ?? "SOL").toUpperCase();
  const confidence = (process.env.AUTO_TRADE_CONFIDENCE ?? "MEDIUM").toUpperCase();

  return {
    // Safest possible defaults: trading is OFF and, even if turned on,
    // DRY_RUN defaults to true so a config mistake can't broadcast a trade.
    enabled: bool("AUTO_TRADE_ENABLED", false),
    dryRun: bool("AUTO_TRADE_DRY_RUN", true),
    buyEnabled: bool("AUTO_TRADE_BUY_ENABLED", true),
    sellEnabled: bool("AUTO_TRADE_SELL_ENABLED", false),
    chain: (chain === "BNB" ? "BNB" : "SOLANA") as AutoTradeChain,
    baseCurrency: (baseCurrency === "USDC" ? "USDC" : "SOL") as BaseCurrency,
    minConfidence: (["LOW", "MEDIUM", "HIGH"].includes(confidence) ? confidence : "MEDIUM") as Confidence,
    minMomentumScore: num("AUTO_TRADE_MOMENTUM_SCORE", 8),
    maxSignalAgeSeconds: num("AUTO_TRADE_MAX_SIGNAL_AGE_SECONDS", 60),
    maxEntryDeviationPct: num("AUTO_TRADE_MAX_ENTRY_DEVIATION_PCT", 5),
    enforceLiquidity: bool("AUTO_TRADE_ENFORCE_LIQUIDITY", true),
    minLiquidityUsd: num("AUTO_TRADE_MIN_LIQUIDITY_USD", 25_000),
    enforceSlippage: bool("AUTO_TRADE_ENFORCE_SLIPPAGE", true),
    maxSlippageBps: num("AUTO_TRADE_MAX_SLIPPAGE_BPS", 500),
    amountSol: num("AUTO_TRADE_AMOUNT_SOL", 0.05),
    amountUsdc: num("AUTO_TRADE_AMOUNT_USDC", 10),
    maxDailyTrades: num("AUTO_TRADE_MAX_DAILY_TRADES", 10),
    maxDailyLossUsd: num("AUTO_TRADE_MAX_DAILY_LOSS_USD", 50),
    dedupeWindowSeconds: num("AUTO_TRADE_DEDUPE_WINDOW_SECONDS", 3600),
  };
}

// Maps a signal type to the trade action it represents, or null if it should
// never generate a trade (LAUNCH signals are informational only).
export function signalTypeToAction(signalType: string): "BUY" | "SELL" | null {
  if (signalType === "BUY" || signalType === "ALERT") return "BUY";
  if (signalType === "SELL") return "SELL";
  return null; // LAUNCH
}

// Whether the config's buy/sell toggles allow this action at all — independent
// of every other eligibility rule.
export function actionEnabled(config: AutoTradeConfig, action: "BUY" | "SELL"): boolean {
  if (action === "BUY") return config.buyEnabled;
  return config.sellEnabled;
}
