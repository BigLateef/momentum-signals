import type { DexPair } from "./dexscreener";

export type MomentumResult = {
  score: number; // 1-10
  confidence: "LOW" | "MEDIUM" | "HIGH";
  signalType: "BUY" | "ALERT" | null; // null = doesn't qualify for a signal
  entryPrice: number;
  targetPrice1: number;
  targetPrice2: number;
  stopLoss: number;
  reason: string;
};

export type MomentumConfig = {
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  confidenceHighLiquidityUsd: number;
  confidenceHighVolumeUsd: number;
  confidenceMediumLiquidityUsd: number;
  confidenceMediumVolumeUsd: number;
  buyScoreThreshold: number;
  alertScoreThreshold: number;
  tp1Multiplier: number;
  tp2Multiplier: number;
  stopLossMultiplier: number;
};

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// How early/aggressively the scanner flags a token as having real momentum —
// tunable via env vars instead of fixed in code. Every default below matches
// this app's original hardcoded constant exactly, so leaving all of these
// unset changes nothing. Deliberately NOT exposed here: the internal scoring
// weights (h1/h6 blend, volume-ratio cap, buy-pressure multiplier) — those
// are the shape of the formula itself, not a threshold a person would
// reasonably want to retune from an env var, and making them configurable
// risks producing a nonsensical score (e.g. weights that don't sum sensibly)
// with no clear benefit over the values already tuned here.
export function getMomentumConfig(): MomentumConfig {
  return {
    minLiquidityUsd: num("MOMENTUM_MIN_LIQUIDITY_USD", 5_000),
    minVolume24hUsd: num("MOMENTUM_MIN_VOLUME_24H_USD", 10_000),
    confidenceHighLiquidityUsd: num("MOMENTUM_CONFIDENCE_HIGH_LIQUIDITY_USD", 50_000),
    confidenceHighVolumeUsd: num("MOMENTUM_CONFIDENCE_HIGH_VOLUME_USD", 100_000),
    confidenceMediumLiquidityUsd: num("MOMENTUM_CONFIDENCE_MEDIUM_LIQUIDITY_USD", 15_000),
    confidenceMediumVolumeUsd: num("MOMENTUM_CONFIDENCE_MEDIUM_VOLUME_USD", 30_000),
    buyScoreThreshold: num("MOMENTUM_BUY_SCORE_THRESHOLD", 7),
    alertScoreThreshold: num("MOMENTUM_ALERT_SCORE_THRESHOLD", 5),
    tp1Multiplier: num("MOMENTUM_TP1_MULTIPLIER", 1.15),
    tp2Multiplier: num("MOMENTUM_TP2_MULTIPLIER", 1.3),
    stopLossMultiplier: num("MOMENTUM_STOP_LOSS_MULTIPLIER", 0.85),
  };
}

/**
 * Heuristic momentum score, not financial advice or a guaranteed signal —
 * it's a starting point meant to be tuned against your own risk tolerance.
 *
 * Weighs three things:
 *  1. Short/medium-term price momentum (h1 + h6 % change)
 *  2. Volume-to-liquidity ratio (trading activity relative to pool depth)
 *  3. Buy/sell pressure (txn count skew toward buys)
 *
 * `config` defaults to reading live env vars via getMomentumConfig() on
 * every call (not cached at module load), so a config change takes effect
 * on the next scan without a redeploy needing anything special — same
 * pattern as src/lib/trading/config.ts's getAutoTradeConfig(). Pass an
 * explicit config (e.g. in a test) to override that.
 */
export function computeMomentum(pair: DexPair, config: MomentumConfig = getMomentumConfig()): MomentumResult | null {
  const price = parseFloat(pair.priceUsd ?? "0");
  const liquidity = pair.liquidity?.usd ?? 0;
  const volume24h = pair.volume?.h24 ?? 0;

  if (!price || liquidity < config.minLiquidityUsd || volume24h < config.minVolume24hUsd) {
    return null; // too thin/illiquid to trust the price action
  }

  const h1 = pair.priceChange?.h1 ?? 0;
  const h6 = pair.priceChange?.h6 ?? 0;

  // Momentum component: weight recent (h1) moves more than h6, cap contribution at 5 pts
  const momentumRaw = h1 * 0.65 + h6 * 0.35;
  const momentumPts = Math.max(0, Math.min(5, momentumRaw / 6));

  // Volume/liquidity ratio component: healthy turnover without being a liquidity trap
  const volLiqRatio = volume24h / liquidity;
  const volumePts = Math.max(0, Math.min(3, volLiqRatio));

  // Buy/sell pressure component
  const buys = pair.txns?.h1?.buys ?? 0;
  const sells = pair.txns?.h1?.sells ?? 0;
  const totalTxns = buys + sells;
  const buyRatio = totalTxns > 0 ? buys / totalTxns : 0.5;
  const pressurePts = Math.max(0, (buyRatio - 0.5) * 4); // 0 at 50/50, up to 2 at 100% buys

  const rawScore = momentumPts + volumePts + pressurePts;
  const score = Math.max(1, Math.min(10, Math.round(rawScore)));

  let confidence: "LOW" | "MEDIUM" | "HIGH" = "LOW";
  if (liquidity > config.confidenceHighLiquidityUsd && volume24h > config.confidenceHighVolumeUsd) confidence = "HIGH";
  else if (liquidity > config.confidenceMediumLiquidityUsd && volume24h > config.confidenceMediumVolumeUsd)
    confidence = "MEDIUM";

  // Only worth a signal if there's real upward momentum
  let signalType: "BUY" | "ALERT" | null = null;
  if (score >= config.buyScoreThreshold && h1 > 0) signalType = "BUY";
  else if (score >= config.alertScoreThreshold) signalType = "ALERT";

  const reason = `Auto-detected: ${h1.toFixed(1)}% (1h) / ${h6.toFixed(1)}% (6h) price move, $${Math.round(
    volume24h
  ).toLocaleString()} 24h volume, $${Math.round(liquidity).toLocaleString()} liquidity, ${buys}:${sells} buy/sell (1h).`;

  return {
    score,
    confidence,
    signalType,
    entryPrice: price,
    targetPrice1: price * config.tp1Multiplier,
    targetPrice2: price * config.tp2Multiplier,
    stopLoss: price * config.stopLossMultiplier,
    reason,
  };
}
