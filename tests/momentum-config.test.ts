import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { computeMomentum, getMomentumConfig } from "@/lib/momentum";
import type { DexPair } from "@/lib/dexscreener";

// Every threshold in the momentum scanner used to be a hardcoded constant.
// Converted to env vars (MOMENTUM_*) so "how early/aggressively the scanner
// flags a token" can be tuned without a code change — this suite proves the
// defaults are byte-identical to the old hardcoded behavior (no unintended
// change for anyone who doesn't set any of these) and that overrides
// actually take effect on both the qualification threshold and the
// downstream calculation (target prices).

const ENV_KEYS = [
  "MOMENTUM_MIN_LIQUIDITY_USD",
  "MOMENTUM_MIN_VOLUME_24H_USD",
  "MOMENTUM_CONFIDENCE_HIGH_LIQUIDITY_USD",
  "MOMENTUM_CONFIDENCE_HIGH_VOLUME_USD",
  "MOMENTUM_CONFIDENCE_MEDIUM_LIQUIDITY_USD",
  "MOMENTUM_CONFIDENCE_MEDIUM_VOLUME_USD",
  "MOMENTUM_BUY_SCORE_THRESHOLD",
  "MOMENTUM_ALERT_SCORE_THRESHOLD",
  "MOMENTUM_TP1_MULTIPLIER",
  "MOMENTUM_TP2_MULTIPLIER",
  "MOMENTUM_STOP_LOSS_MULTIPLIER",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function samplePair(overrides: Partial<DexPair> = {}): DexPair {
  return {
    chainId: "solana",
    dexId: "raydium",
    pairAddress: "TestPairAddress111",
    baseToken: { address: "TestTokenAddress111", name: "Magatard", symbol: "Magatard" },
    priceUsd: "0.0001078",
    liquidity: { usd: 29_853 },
    volume: { h24: 240_596 },
    priceChange: { h1: 2.9, h6: 36.5 },
    txns: { h1: { buys: 50, sells: 47 } },
    ...overrides,
  };
}

describe("getMomentumConfig — defaults match the original hardcoded values", () => {
  it("returns every default matching the pre-existing hardcoded constant exactly", () => {
    const cfg = getMomentumConfig();
    expect(cfg.minLiquidityUsd).toBe(5_000);
    expect(cfg.minVolume24hUsd).toBe(10_000);
    expect(cfg.confidenceHighLiquidityUsd).toBe(50_000);
    expect(cfg.confidenceHighVolumeUsd).toBe(100_000);
    expect(cfg.confidenceMediumLiquidityUsd).toBe(15_000);
    expect(cfg.confidenceMediumVolumeUsd).toBe(30_000);
    expect(cfg.buyScoreThreshold).toBe(7);
    expect(cfg.alertScoreThreshold).toBe(5);
    expect(cfg.tp1Multiplier).toBe(1.15);
    expect(cfg.tp2Multiplier).toBe(1.3);
    expect(cfg.stopLossMultiplier).toBe(0.85);
  });

  it("falls back to the safe default when an env var is set to a non-numeric value", () => {
    process.env.MOMENTUM_MIN_LIQUIDITY_USD = "not-a-number";
    expect(getMomentumConfig().minLiquidityUsd).toBe(5_000);
  });
});

describe("computeMomentum — default behavior unchanged from the old hardcoded version", () => {
  it("returns null just under the default liquidity threshold, same as the old hardcoded check", () => {
    expect(computeMomentum(samplePair({ liquidity: { usd: 4_999 } }))).toBeNull();
  });

  it("produces a real result just over the default liquidity threshold", () => {
    expect(computeMomentum(samplePair({ liquidity: { usd: 5_001 } }))).not.toBeNull();
  });

  it("reproduces MEDIUM confidence for the exact real-world sample this feature was requested from", () => {
    // liquidity: 29853, volume: 240596 — the actual "Magatard" signal stats
    const result = computeMomentum(samplePair());
    expect(result?.confidence).toBe("MEDIUM");
  });
});

describe("computeMomentum — env var overrides actually take effect", () => {
  it("MOMENTUM_MIN_LIQUIDITY_USD raised via env var excludes a token that would have qualified under the default", () => {
    process.env.MOMENTUM_MIN_LIQUIDITY_USD = "50000";
    const cfg = getMomentumConfig();
    // 29,853 liquidity qualified under the default 5,000 threshold but not
    // under this raised 50,000 threshold.
    expect(computeMomentum(samplePair(), cfg)).toBeNull();
  });

  it("MOMENTUM_TP1_MULTIPLIER override changes the computed target price", () => {
    process.env.MOMENTUM_TP1_MULTIPLIER = "1.5";
    const cfg = getMomentumConfig();
    const result = computeMomentum(samplePair(), cfg);
    expect(result?.targetPrice1).toBeCloseTo(0.0001078 * 1.5, 10);
  });

  it("MOMENTUM_BUY_SCORE_THRESHOLD is read correctly from the env var", () => {
    process.env.MOMENTUM_BUY_SCORE_THRESHOLD = "3";
    expect(getMomentumConfig().buyScoreThreshold).toBe(3);
  });
});
