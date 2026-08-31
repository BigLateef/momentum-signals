import type { SafetyVerdict } from "@/db/schema";
import { verdictAllowsAutoAction } from "@/lib/safety/score";
import {
  actionEnabled,
  meetsConfidence,
  signalTypeToAction,
  type AutoTradeConfig,
  type Confidence,
} from "./config";

export type EligibilityInput = {
  signalType: string; // BUY | SELL | ALERT | LAUNCH
  confidence: Confidence | null;
  momentumScore: number | null;
  signalCreatedAt: Date;
  entryPrice: number | null;
  currentPrice: number | null;
  config: AutoTradeConfig;
  now: Date;

  safetyVerdict: SafetyVerdict | null;
  safetyOverride: boolean;

  liquidityUsd: number | null;
  slippageBps: number | null;

  hasDuplicateExecution: boolean;
  dailyTradeCount: number;
  dailyLossUsd: number;

  walletConfigured: boolean;
  walletHasSufficientFunds: boolean;
  // Only relevant for SELL — does the burner wallet actually hold the token.
  tokenBalance: number | null;
};

export type EligibilityResult = {
  eligible: boolean;
  action: "BUY" | "SELL" | null;
  skipReason?: string;
};

// A signal's `chain` field ("Solana", "BNB", or any other value this app
// scans but doesn't support auto-trading on) must match the single chain
// AUTO_TRADE_CHAIN is configured for — this app only ever runs one live
// burner wallet on one chain at a time, never trades cross-chain. Pulled out
// as its own pure function (previously inlined directly in
// src/lib/trading/executor.ts, gated behind a DB call to fetch the signal
// first) so it's unit-testable without a database.
export function isChainConfiguredForAutoTrade(
  signalChain: string | null | undefined,
  config: Pick<AutoTradeConfig, "chain">
): boolean {
  const chainKey = signalChain === "BNB" ? "BNB" : signalChain === "Solana" ? "SOLANA" : null;
  return chainKey !== null && chainKey === config.chain;
}

// Whether the eligibility rules engine should treat the burner wallet as
// "configured" and "funded" for a given evaluation. Dry-run structurally
// never signs or broadcasts a transaction (see executor.ts's
// `if (config.dryRun)` branch, which returns before either
// executeJupiterSwap or executePancakeSwap is ever called), so it has no
// real need for a private key, wallet configuration, or funds —
// WALLET_NOT_CONFIGURED and INSUFFICIENT_WALLET_BALANCE must never block a
// dry-run evaluation. Live execution (dryRun === false) still requires the
// real check.
//
// THIS WAS A REAL PRODUCTION BUG ONCE: dry-run BUY/ALERT evaluations were
// incorrectly skipped with WALLET_NOT_CONFIGURED / INSUFFICIENT_WALLET_BALANCE
// before this function existed, because executor.ts passed the real wallet
// check into eligibility unconditionally regardless of dry-run. Do not
// revert this to an unconditional `isWalletConfigured(...)` call — see
// tests/dry-run-wallet.test.ts, which exists specifically to catch that
// regression.
export function resolveWalletEligibility(dryRun: boolean, realWalletConfigured: boolean): boolean {
  return dryRun ? true : realWalletConfigured;
}

export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const action = signalTypeToAction(input.signalType);

  // 1. Signal type must map to an action at all (LAUNCH never trades).
  if (!action) {
    return { eligible: false, action: null, skipReason: "SIGNAL_TYPE_NOT_TRADEABLE" };
  }

  // 2. That action must be independently enabled (buy-only mode ignores SELL, etc).
  if (!input.config.enabled) {
    return { eligible: false, action, skipReason: "AUTO_TRADE_DISABLED" };
  }
  if (!actionEnabled(input.config, action)) {
    return { eligible: false, action, skipReason: `${action}_DISABLED` };
  }

  // 3. Confidence must meet the configured minimum.
  if (!meetsConfidence(input.confidence, input.config.minConfidence)) {
    return { eligible: false, action, skipReason: "CONFIDENCE_BELOW_THRESHOLD" };
  }

  // 4. Momentum score must meet the configured minimum.
  if (input.momentumScore == null || input.momentumScore < input.config.minMomentumScore) {
    return { eligible: false, action, skipReason: "MOMENTUM_BELOW_THRESHOLD" };
  }

  // 5. Signal must be fresh.
  const ageSeconds = (input.now.getTime() - input.signalCreatedAt.getTime()) / 1000;
  if (ageSeconds > input.config.maxSignalAgeSeconds) {
    return { eligible: false, action, skipReason: "SIGNAL_STALE" };
  }

  // 6. Price must not have moved beyond the configured deviation from entry.
  if (input.entryPrice != null && input.currentPrice != null && input.entryPrice > 0) {
    const deviationPct = (Math.abs(input.currentPrice - input.entryPrice) / input.entryPrice) * 100;
    if (deviationPct > input.config.maxEntryDeviationPct) {
      return { eligible: false, action, skipReason: "ENTRY_DEVIATION_EXCEEDED" };
    }
  }

  // 7. Safety verdict must allow automatic action (honors admin override).
  const safety = verdictAllowsAutoAction(input.safetyVerdict ?? "INSUFFICIENT_DATA", input.safetyOverride);
  if (!safety.allowed) {
    return { eligible: false, action, skipReason: "SAFETY_BLOCKED" };
  }

  // 8. Liquidity enforcement — independent toggle. When disabled, don't
  // block, but the caller is expected to record that the check was skipped.
  if (input.config.enforceLiquidity) {
    if (input.liquidityUsd == null || input.liquidityUsd < input.config.minLiquidityUsd) {
      return { eligible: false, action, skipReason: "LIQUIDITY_TOO_LOW" };
    }
  }

  // 9. Slippage enforcement — independent toggle.
  if (input.config.enforceSlippage) {
    if (input.slippageBps == null || input.slippageBps > input.config.maxSlippageBps) {
      return { eligible: false, action, skipReason: "SLIPPAGE_TOO_HIGH" };
    }
  }

  // 10. No duplicate execution for this signal+action.
  if (input.hasDuplicateExecution) {
    return { eligible: false, action, skipReason: "DUPLICATE_EXECUTION" };
  }

  // 11. Daily trade/loss limits.
  if (input.dailyTradeCount >= input.config.maxDailyTrades) {
    return { eligible: false, action, skipReason: "DAILY_TRADE_LIMIT_REACHED" };
  }
  if (input.dailyLossUsd >= input.config.maxDailyLossUsd) {
    return { eligible: false, action, skipReason: "DAILY_LOSS_LIMIT_REACHED" };
  }

  // 12. Wallet must be configured and funded.
  if (!input.walletConfigured) {
    return { eligible: false, action, skipReason: "WALLET_NOT_CONFIGURED" };
  }
  if (!input.walletHasSufficientFunds) {
    return { eligible: false, action, skipReason: "INSUFFICIENT_WALLET_BALANCE" };
  }

  // 13. SELL requires the wallet to actually hold the token.
  if (action === "SELL" && (input.tokenBalance == null || input.tokenBalance <= 0)) {
    return { eligible: false, action, skipReason: "NO_TOKEN_BALANCE_TO_SELL" };
  }

  return { eligible: true, action };
}
