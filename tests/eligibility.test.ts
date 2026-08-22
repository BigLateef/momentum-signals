import { describe, it, expect } from "vitest";
import { evaluateEligibility, type EligibilityInput } from "@/lib/trading/eligibility";
import type { AutoTradeConfig } from "@/lib/trading/config";

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

function baseInput(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  const now = new Date("2026-08-20T12:00:00Z");
  return {
    signalType: "BUY",
    confidence: "HIGH",
    momentumScore: 9,
    signalCreatedAt: new Date(now.getTime() - 10_000), // 10s old
    entryPrice: 1,
    currentPrice: 1,
    config: baseConfig(),
    now,
    safetyVerdict: "LOW_RISK",
    safetyOverride: false,
    liquidityUsd: 50_000,
    slippageBps: 100,
    hasDuplicateExecution: false,
    dailyTradeCount: 0,
    dailyLossUsd: 0,
    walletConfigured: true,
    walletHasSufficientFunds: true,
    tokenBalance: null,
    ...overrides,
  };
}

describe("evaluateEligibility — buy-only vs buy-and-sell modes", () => {
  it("buy-only mode executes BUY/ALERT and ignores SELL", () => {
    const config = baseConfig({ buyEnabled: true, sellEnabled: false });
    expect(evaluateEligibility(baseInput({ signalType: "BUY", config })).eligible).toBe(true);
    expect(evaluateEligibility(baseInput({ signalType: "ALERT", config })).eligible).toBe(true);
    const sellResult = evaluateEligibility(
      baseInput({ signalType: "SELL", config, tokenBalance: 100 })
    );
    expect(sellResult.eligible).toBe(false);
    expect(sellResult.skipReason).toBe("SELL_DISABLED");
  });

  it("buy-and-sell mode allows both when their own rules pass", () => {
    const config = baseConfig({ buyEnabled: true, sellEnabled: true });
    expect(evaluateEligibility(baseInput({ signalType: "BUY", config })).eligible).toBe(true);
    expect(
      evaluateEligibility(baseInput({ signalType: "SELL", config, tokenBalance: 100 })).eligible
    ).toBe(true);
  });

  it("LAUNCH never trades in any mode", () => {
    const config = baseConfig({ buyEnabled: true, sellEnabled: true });
    const result = evaluateEligibility(baseInput({ signalType: "LAUNCH", config }));
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("SIGNAL_TYPE_NOT_TRADEABLE");
  });
});

describe("evaluateEligibility — price deviation", () => {
  it("passes when price is within the configured deviation", () => {
    const result = evaluateEligibility(baseInput({ entryPrice: 1, currentPrice: 1.04 }));
    expect(result.eligible).toBe(true);
  });

  it("skips with ENTRY_DEVIATION_EXCEEDED when price moved beyond the threshold", () => {
    const result = evaluateEligibility(
      baseInput({ entryPrice: 1, currentPrice: 1.10, config: baseConfig({ maxEntryDeviationPct: 5 }) })
    );
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("ENTRY_DEVIATION_EXCEEDED");
  });

  it("treats deviation as symmetric (a drop also counts)", () => {
    const result = evaluateEligibility(baseInput({ entryPrice: 1, currentPrice: 0.9 }));
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("ENTRY_DEVIATION_EXCEEDED");
  });
});

describe("evaluateEligibility — liquidity/slippage enforcement toggles", () => {
  it("blocks on thin liquidity when enforcement is on", () => {
    const result = evaluateEligibility(
      baseInput({ liquidityUsd: 1000, config: baseConfig({ enforceLiquidity: true, minLiquidityUsd: 25000 }) })
    );
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("LIQUIDITY_TOO_LOW");
  });

  it("does not block on thin liquidity when enforcement is off", () => {
    const result = evaluateEligibility(
      baseInput({ liquidityUsd: 1000, config: baseConfig({ enforceLiquidity: false }) })
    );
    expect(result.eligible).toBe(true);
  });

  it("blocks on high slippage when enforcement is on", () => {
    const result = evaluateEligibility(
      baseInput({ slippageBps: 900, config: baseConfig({ enforceSlippage: true, maxSlippageBps: 500 }) })
    );
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("SLIPPAGE_TOO_HIGH");
  });

  it("does not block on high slippage when enforcement is off", () => {
    const result = evaluateEligibility(
      baseInput({ slippageBps: 900, config: baseConfig({ enforceSlippage: false }) })
    );
    expect(result.eligible).toBe(true);
  });

  it("liquidity and slippage toggles are independent of each other", () => {
    const result = evaluateEligibility(
      baseInput({
        liquidityUsd: 1000,
        slippageBps: 900,
        config: baseConfig({ enforceLiquidity: false, enforceSlippage: true, maxSlippageBps: 500 }),
      })
    );
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("SLIPPAGE_TOO_HIGH");
  });
});

describe("evaluateEligibility — deduplication", () => {
  it("blocks when a duplicate execution already exists", () => {
    const result = evaluateEligibility(baseInput({ hasDuplicateExecution: true }));
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("DUPLICATE_EXECUTION");
  });
});

describe("evaluateEligibility — daily limits", () => {
  it("blocks once the daily trade count is reached", () => {
    const result = evaluateEligibility(
      baseInput({ dailyTradeCount: 10, config: baseConfig({ maxDailyTrades: 10 }) })
    );
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("DAILY_TRADE_LIMIT_REACHED");
  });

  it("blocks once the daily loss limit is reached", () => {
    const result = evaluateEligibility(
      baseInput({ dailyLossUsd: 50, config: baseConfig({ maxDailyLossUsd: 50 }) })
    );
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("DAILY_LOSS_LIMIT_REACHED");
  });
});

describe("evaluateEligibility — safety verdict gating", () => {
  it("blocks on a BLOCKED verdict even with override=true", () => {
    const result = evaluateEligibility(baseInput({ safetyVerdict: "BLOCKED", safetyOverride: true }));
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("SAFETY_BLOCKED");
  });

  it("blocks VERY_HIGH_RISK without override, allows with override", () => {
    const noOverride = evaluateEligibility(baseInput({ safetyVerdict: "VERY_HIGH_RISK", safetyOverride: false }));
    expect(noOverride.eligible).toBe(false);
    const withOverride = evaluateEligibility(baseInput({ safetyVerdict: "VERY_HIGH_RISK", safetyOverride: true }));
    expect(withOverride.eligible).toBe(true);
  });
});

describe("evaluateEligibility — SELL requires a held token balance", () => {
  it("blocks a SELL when the wallet holds none of the token", () => {
    const config = baseConfig({ sellEnabled: true });
    const result = evaluateEligibility(baseInput({ signalType: "SELL", config, tokenBalance: 0 }));
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("NO_TOKEN_BALANCE_TO_SELL");
  });

  it("allows a SELL when the wallet holds the token", () => {
    const config = baseConfig({ sellEnabled: true });
    const result = evaluateEligibility(baseInput({ signalType: "SELL", config, tokenBalance: 500 }));
    expect(result.eligible).toBe(true);
  });
});

describe("evaluateEligibility — freshness and momentum/confidence thresholds", () => {
  it("blocks a stale signal", () => {
    const now = new Date("2026-08-20T12:00:00Z");
    const result = evaluateEligibility(
      baseInput({ now, signalCreatedAt: new Date(now.getTime() - 120_000), config: baseConfig({ maxSignalAgeSeconds: 60 }) })
    );
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("SIGNAL_STALE");
  });

  it("blocks below the configured momentum threshold", () => {
    const result = evaluateEligibility(baseInput({ momentumScore: 5, config: baseConfig({ minMomentumScore: 8 }) }));
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("MOMENTUM_BELOW_THRESHOLD");
  });

  it("blocks below the configured confidence threshold", () => {
    const result = evaluateEligibility(baseInput({ confidence: "LOW", config: baseConfig({ minConfidence: "HIGH" }) }));
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("CONFIDENCE_BELOW_THRESHOLD");
  });
});
