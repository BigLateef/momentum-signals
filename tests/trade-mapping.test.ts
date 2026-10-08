import { describe, it, expect } from "vitest";
import { signalTypeToAction, actionEnabled, meetsConfidence, type AutoTradeConfig } from "@/lib/trading/config";

describe("signalTypeToAction", () => {
  it("maps BUY -> BUY", () => {
    expect(signalTypeToAction("BUY")).toBe("BUY");
  });
  it("maps ALERT -> BUY", () => {
    expect(signalTypeToAction("ALERT")).toBe("BUY");
  });
  it("maps SELL -> SELL", () => {
    expect(signalTypeToAction("SELL")).toBe("SELL");
  });
  it("maps LAUNCH -> null (never trades)", () => {
    expect(signalTypeToAction("LAUNCH")).toBeNull();
  });
});

function baseConfig(overrides: Partial<AutoTradeConfig> = {}): AutoTradeConfig {
  return {
    enabled: true,
    dryRun: true,
    buyEnabled: true,
    sellEnabled: false,
    chain: "SOLANA",
    baseCurrency: "SOL",
    minConfidence: "MEDIUM",
    minMomentumScore: 8,
    maxSignalAgeSeconds: 60,
    maxEntryDeviationPct: 5,
    enforceLiquidity: true,
    minLiquidityUsd: 25000,
    enforceSlippage: true,
    maxSlippageBps: 500,
    amountSol: 0.05,
    amountUsdc: 10,
    maxDailyTrades: 10,
    maxDailyLossUsd: 50,
    dedupeWindowSeconds: 3600,
    ...overrides,
  };
}

describe("actionEnabled (buy-only vs buy-and-sell modes)", () => {
  it("buy-only mode: BUY enabled, SELL disabled", () => {
    const config = baseConfig({ buyEnabled: true, sellEnabled: false });
    expect(actionEnabled(config, "BUY")).toBe(true);
    expect(actionEnabled(config, "SELL")).toBe(false);
  });

  it("buy-and-sell mode: both enabled", () => {
    const config = baseConfig({ buyEnabled: true, sellEnabled: true });
    expect(actionEnabled(config, "BUY")).toBe(true);
    expect(actionEnabled(config, "SELL")).toBe(true);
  });

  it("sell-only mode: BUY disabled, SELL enabled", () => {
    const config = baseConfig({ buyEnabled: false, sellEnabled: true });
    expect(actionEnabled(config, "BUY")).toBe(false);
    expect(actionEnabled(config, "SELL")).toBe(true);
  });
});

describe("meetsConfidence", () => {
  it("ranks LOW < MEDIUM < HIGH", () => {
    expect(meetsConfidence("LOW", "MEDIUM")).toBe(false);
    expect(meetsConfidence("MEDIUM", "MEDIUM")).toBe(true);
    expect(meetsConfidence("HIGH", "MEDIUM")).toBe(true);
  });
  it("returns false for null confidence", () => {
    expect(meetsConfidence(null, "LOW")).toBe(false);
  });
});
