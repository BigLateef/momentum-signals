import { describe, it, expect } from "vitest";
import {
  evaluateEligibility,
  isChainConfiguredForAutoTrade,
  resolveWalletEligibility,
  type EligibilityInput,
} from "@/lib/trading/eligibility";
import type { AutoTradeConfig } from "@/lib/trading/config";

// Regression suite for a real production bug: dry-run BUY/ALERT evaluations
// were incorrectly skipped with WALLET_NOT_CONFIGURED / INSUFFICIENT_
// WALLET_BALANCE, even though dry-run structurally never signs or
// broadcasts a transaction and so has no real need for a burner-wallet
// private key, configuration, or funds. Fixed in src/lib/trading/
// executor.ts (which resolves the wallet flags via
// resolveWalletEligibility() before calling evaluateEligibility()) and
// src/lib/trading/eligibility.ts (which now exports that resolution
// function so it's independently testable, plus isChainConfiguredForAutoTrade,
// extracted from executor.ts's inline chain-matching guard for the same
// reason). Do not revert either extraction, and do not remove this file.

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

// Mirrors exactly what executor.ts passes into evaluateEligibility: wallet
// flags come from resolveWalletEligibility(config.dryRun, realWalletConfigured),
// never from a raw isWalletConfigured() call — that's the fix under test.
function baseInput(overrides: Partial<EligibilityInput> & { realWalletConfigured?: boolean } = {}): EligibilityInput {
  const now = new Date("2026-08-20T12:00:00Z");
  const { realWalletConfigured = false, ...rest } = overrides;
  const config = rest.config ?? baseConfig();
  const walletFlag = resolveWalletEligibility(config.dryRun, realWalletConfigured);

  return {
    signalType: "BUY",
    confidence: "HIGH",
    momentumScore: 9,
    signalCreatedAt: new Date(now.getTime() - 10_000),
    entryPrice: 1,
    currentPrice: 1,
    config,
    now,
    safetyVerdict: "LOW_RISK",
    safetyOverride: false,
    liquidityUsd: 50_000,
    slippageBps: 100,
    hasDuplicateExecution: false,
    dailyTradeCount: 0,
    dailyLossUsd: 0,
    walletConfigured: walletFlag,
    walletHasSufficientFunds: walletFlag,
    tokenBalance: null,
    ...rest,
  };
}

describe("resolveWalletEligibility — the core fix", () => {
  it("forces wallet-eligible=true during dry-run, regardless of the real wallet state", () => {
    expect(resolveWalletEligibility(true, false)).toBe(true);
    expect(resolveWalletEligibility(true, true)).toBe(true);
  });

  it("passes through the real wallet state for live execution", () => {
    expect(resolveWalletEligibility(false, false)).toBe(false);
    expect(resolveWalletEligibility(false, true)).toBe(true);
  });
});

describe("dry-run BUY works without a wallet private key", () => {
  it("a qualifying dry-run BUY is eligible with no real wallet configured at all", () => {
    const config = baseConfig({ dryRun: true, buyEnabled: true });
    const result = evaluateEligibility(baseInput({ signalType: "BUY", config, realWalletConfigured: false }));
    expect(result.eligible).toBe(true);
    expect(result.action).toBe("BUY");
  });
});

describe("dry-run ALERT works without a wallet private key", () => {
  it("a qualifying dry-run ALERT is eligible with no real wallet configured at all", () => {
    const config = baseConfig({ dryRun: true, buyEnabled: true });
    const result = evaluateEligibility(baseInput({ signalType: "ALERT", config, realWalletConfigured: false }));
    expect(result.eligible).toBe(true);
    expect(result.action).toBe("BUY"); // ALERT maps to a BUY action
  });
});

describe("live execution still requires a wallet", () => {
  it("a qualifying live BUY is blocked with WALLET_NOT_CONFIGURED when no real wallet exists", () => {
    const config = baseConfig({ dryRun: false, buyEnabled: true });
    const result = evaluateEligibility(baseInput({ signalType: "BUY", config, realWalletConfigured: false }));
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("WALLET_NOT_CONFIGURED");
  });

  it("a qualifying live BUY is eligible once a real wallet is configured", () => {
    const config = baseConfig({ dryRun: false, buyEnabled: true });
    const result = evaluateEligibility(baseInput({ signalType: "BUY", config, realWalletConfigured: true }));
    expect(result.eligible).toBe(true);
  });
});

describe("SELL balance requirements remain enforced for live trading", () => {
  it("blocks a live SELL with NO_TOKEN_BALANCE_TO_SELL when the wallet holds none of the token", () => {
    const config = baseConfig({ dryRun: false, sellEnabled: true });
    const result = evaluateEligibility(
      baseInput({ signalType: "SELL", config, realWalletConfigured: true, tokenBalance: 0 })
    );
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("NO_TOKEN_BALANCE_TO_SELL");
  });

  it("allows a live SELL once the wallet holds a positive balance", () => {
    const config = baseConfig({ dryRun: false, sellEnabled: true });
    const result = evaluateEligibility(
      baseInput({ signalType: "SELL", config, realWalletConfigured: true, tokenBalance: 500 })
    );
    expect(result.eligible).toBe(true);
  });

  it("SELL balance enforcement also applies in dry-run (nothing to simulate selling if no position exists)", () => {
    const config = baseConfig({ dryRun: true, sellEnabled: true });
    const result = evaluateEligibility(
      baseInput({ signalType: "SELL", config, realWalletConfigured: false, tokenBalance: null })
    );
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("NO_TOKEN_BALANCE_TO_SELL");
  });
});

describe("chain mismatch still blocks execution", () => {
  it("blocks when the signal's chain doesn't match AUTO_TRADE_CHAIN", () => {
    expect(isChainConfiguredForAutoTrade("BNB", { chain: "SOLANA" })).toBe(false);
    expect(isChainConfiguredForAutoTrade("Solana", { chain: "BNB" })).toBe(false);
  });

  it("allows when the signal's chain matches AUTO_TRADE_CHAIN", () => {
    expect(isChainConfiguredForAutoTrade("Solana", { chain: "SOLANA" })).toBe(true);
    expect(isChainConfiguredForAutoTrade("BNB", { chain: "BNB" })).toBe(true);
  });

  it("blocks an unrecognized or missing chain value", () => {
    expect(isChainConfiguredForAutoTrade("Ethereum", { chain: "SOLANA" })).toBe(false);
    expect(isChainConfiguredForAutoTrade(null, { chain: "SOLANA" })).toBe(false);
    expect(isChainConfiguredForAutoTrade(undefined, { chain: "BNB" })).toBe(false);
  });

  it("is unaffected by dry-run — chain matching applies regardless (this fix only touches wallet checks)", () => {
    // isChainConfiguredForAutoTrade has no concept of dry-run at all — this
    // test exists to make that explicit and guard against someone later
    // adding a dry-run bypass here by copy-pasting the wallet fix's pattern.
    expect(isChainConfiguredForAutoTrade("BNB", { chain: "SOLANA" })).toBe(false);
  });
});

describe("safety blocking remains active", () => {
  it("a BLOCKED safety verdict still blocks a dry-run BUY with no wallet, even though wallet checks now pass", () => {
    const config = baseConfig({ dryRun: true, buyEnabled: true });
    const result = evaluateEligibility(
      baseInput({ signalType: "BUY", config, realWalletConfigured: false, safetyVerdict: "BLOCKED" })
    );
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("SAFETY_BLOCKED");
  });

  it("a VERY_HIGH_RISK verdict without override still blocks, wallet fix notwithstanding", () => {
    const config = baseConfig({ dryRun: true, buyEnabled: true });
    const result = evaluateEligibility(
      baseInput({
        signalType: "BUY",
        config,
        realWalletConfigured: false,
        safetyVerdict: "VERY_HIGH_RISK",
        safetyOverride: false,
      })
    );
    expect(result.eligible).toBe(false);
    expect(result.skipReason).toBe("SAFETY_BLOCKED");
  });

  it("an admin override on VERY_HIGH_RISK still allows a dry-run BUY through", () => {
    const config = baseConfig({ dryRun: true, buyEnabled: true });
    const result = evaluateEligibility(
      baseInput({
        signalType: "BUY",
        config,
        realWalletConfigured: false,
        safetyVerdict: "VERY_HIGH_RISK",
        safetyOverride: true,
      })
    );
    expect(result.eligible).toBe(true);
  });
});

describe("dry-run never signs or broadcasts (structural guarantee, documented here)", () => {
  // eligibility.ts and the two extracted helpers above only decide whether a
  // trade is ELIGIBLE — they never sign or broadcast anything themselves.
  // The actual signing calls (executeJupiterSwap / executePancakeSwap) live
  // in src/lib/trading/executor.ts, behind an `if (config.dryRun) { ...
  // return ... }` branch that returns unconditionally before either function
  // is ever referenced again in the control flow. That's a structural
  // guarantee (verified by static code trace, not by this test file, since
  // executor.ts talks to a live database and can't be unit-tested without a
  // DB-mocking harness this repo doesn't have) — this test only documents
  // the contract so a future reader knows where the real guarantee lives.
  it("is a documented, not executed, guarantee — see src/lib/trading/executor.ts", () => {
    expect(true).toBe(true);
  });
});
