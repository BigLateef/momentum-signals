import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getAutoTradeConfig } from "@/lib/trading/config";

const ENV_KEYS = [
  "AUTO_TRADE_ENABLED",
  "AUTO_TRADE_DRY_RUN",
  "AUTO_TRADE_BUY_ENABLED",
  "AUTO_TRADE_SELL_ENABLED",
  "AUTO_TRADE_CHAIN",
  "AUTO_TRADE_BASE_CURRENCY",
  "AUTO_TRADE_CONFIDENCE",
  "AUTO_TRADE_MOMENTUM_SCORE",
  "AUTO_TRADE_MAX_SIGNAL_AGE_SECONDS",
  "AUTO_TRADE_MAX_ENTRY_DEVIATION_PCT",
  "AUTO_TRADE_ENFORCE_LIQUIDITY",
  "AUTO_TRADE_MIN_LIQUIDITY_USD",
  "AUTO_TRADE_ENFORCE_SLIPPAGE",
  "AUTO_TRADE_MAX_SLIPPAGE_BPS",
];

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("getAutoTradeConfig — safe defaults", () => {
  it("defaults to disabled and dry-run when no env vars are set", () => {
    const config = getAutoTradeConfig();
    expect(config.enabled).toBe(false);
    expect(config.dryRun).toBe(true);
  });

  it("defaults buy enabled, sell disabled (buy-only out of the box)", () => {
    const config = getAutoTradeConfig();
    expect(config.buyEnabled).toBe(true);
    expect(config.sellEnabled).toBe(false);
  });

  it("live trading requires BOTH enabled=true and dryRun=false to be set explicitly", () => {
    process.env.AUTO_TRADE_ENABLED = "true";
    // dry run not set — must still default true, never silently go live
    const config = getAutoTradeConfig();
    expect(config.enabled).toBe(true);
    expect(config.dryRun).toBe(true);
  });
});

describe("getAutoTradeConfig — parsing", () => {
  it("reads independent liquidity/slippage enforcement toggles", () => {
    process.env.AUTO_TRADE_ENFORCE_LIQUIDITY = "false";
    process.env.AUTO_TRADE_ENFORCE_SLIPPAGE = "true";
    const config = getAutoTradeConfig();
    expect(config.enforceLiquidity).toBe(false);
    expect(config.enforceSlippage).toBe(true);
  });

  it("falls back to SOLANA/SOL/MEDIUM for invalid enum values", () => {
    process.env.AUTO_TRADE_CHAIN = "ETHEREUM";
    process.env.AUTO_TRADE_BASE_CURRENCY = "ETH";
    process.env.AUTO_TRADE_CONFIDENCE = "ULTRA";
    const config = getAutoTradeConfig();
    expect(config.chain).toBe("SOLANA");
    expect(config.baseCurrency).toBe("SOL");
    expect(config.minConfidence).toBe("MEDIUM");
  });

  it("accepts BNB/USDC/HIGH when explicitly valid", () => {
    process.env.AUTO_TRADE_CHAIN = "BNB";
    process.env.AUTO_TRADE_BASE_CURRENCY = "USDC";
    process.env.AUTO_TRADE_CONFIDENCE = "HIGH";
    const config = getAutoTradeConfig();
    expect(config.chain).toBe("BNB");
    expect(config.baseCurrency).toBe("USDC");
    expect(config.minConfidence).toBe("HIGH");
  });
});
