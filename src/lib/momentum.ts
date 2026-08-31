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

const MIN_LIQUIDITY_USD = 5_000; // below this, prices are too easily manipulated
const MIN_VOLUME_24H_USD = 10_000;

/**
 * Heuristic momentum score, not financial advice or a guaranteed signal —
 * it's a starting point meant to be tuned against your own risk tolerance.
 *
 * Weighs three things:
 *  1. Short/medium-term price momentum (h1 + h6 % change)
 *  2. Volume-to-liquidity ratio (trading activity relative to pool depth)
 *  3. Buy/sell pressure (txn count skew toward buys)
 */
export function computeMomentum(pair: DexPair): MomentumResult | null {
  const price = parseFloat(pair.priceUsd ?? "0");
  const liquidity = pair.liquidity?.usd ?? 0;
  const volume24h = pair.volume?.h24 ?? 0;

  if (!price || liquidity < MIN_LIQUIDITY_USD || volume24h < MIN_VOLUME_24H_USD) {
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
  if (liquidity > 50_000 && volume24h > 100_000) confidence = "HIGH";
  else if (liquidity > 15_000 && volume24h > 30_000) confidence = "MEDIUM";

  // Only worth a signal if there's real upward momentum
  let signalType: "BUY" | "ALERT" | null = null;
  if (score >= 7 && h1 > 0) signalType = "BUY";
  else if (score >= 5) signalType = "ALERT";

  const reason = `Auto-detected: ${h1.toFixed(1)}% (1h) / ${h6.toFixed(1)}% (6h) price move, $${Math.round(
    volume24h
  ).toLocaleString()} 24h volume, $${Math.round(liquidity).toLocaleString()} liquidity, ${buys}:${sells} buy/sell (1h).`;

  return {
    score,
    confidence,
    signalType,
    entryPrice: price,
    targetPrice1: price * 1.15,
    targetPrice2: price * 1.3,
    stopLoss: price * 0.85,
    reason,
  };
}
