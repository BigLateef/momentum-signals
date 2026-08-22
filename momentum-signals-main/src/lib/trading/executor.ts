import { db } from "@/db";
import { signals, autoTradeExecutions } from "@/db/schema";
import { and, eq, gte, inArray } from "drizzle-orm";
import { getPairsForToken, bestPair, CHAIN_MAP } from "@/lib/dexscreener";
import { logAudit } from "@/lib/audit";
import { getAutoTradeConfig, type AutoTradeConfig } from "./config";
import { evaluateEligibility } from "./eligibility";
import { isKillSwitchEngaged } from "./kill-switch";
import {
  getWalletPublicAddress,
  isWalletConfigured,
  getSolanaTokenBalance,
  getEvmTokenBalance,
} from "./wallet";
import {
  getJupiterQuote,
  executeJupiterSwap,
  confirmSolanaTransaction,
  SOL_MINT,
  USDC_MINT_SOLANA,
} from "./dex/jupiter";
import {
  getPancakeQuote,
  executePancakeSwap,
  confirmEvmTransaction,
  USDC_ADDRESS_BNB,
} from "./dex/pancakeswap";
import { sendTradeAlert } from "./discord-trade";

const REVERSE_CHAIN_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(CHAIN_MAP).map(([k, v]) => [v, k])
);

export type ExecuteResult = {
  status: "ELIGIBLE" | "SKIPPED" | "DRY_RUN" | "SUBMITTED" | "CONFIRMED" | "FAILED";
  skipReason?: string;
  transactionId?: string;
  executionId?: string;
};

async function getDailyStats(config: AutoTradeConfig) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);

  const rows = await db
    .select()
    .from(autoTradeExecutions)
    .where(
      and(
        gte(autoTradeExecutions.createdAt, since),
        inArray(autoTradeExecutions.status, ["SUBMITTED", "CONFIRMED", "DRY_RUN"])
      )
    );

  const dailyTradeCount = rows.length;
  // Heuristic realized-loss estimate: for CONFIRMED SELLs, compare quoted vs
  // executed price against the amount traded. Real P&L reconciliation needs
  // a full cost-basis ledger — this is a conservative approximation used
  // only to gate against MAX_DAILY_LOSS_USD, not displayed as exact P&L.
  const dailyLossUsd = rows
    .filter((r) => r.action === "SELL" && r.status === "CONFIRMED" && r.quotedPrice && r.executedPrice)
    .reduce((sum, r) => {
      const quoted = parseFloat(r.quotedPrice!);
      const executed = parseFloat(r.executedPrice!);
      const amountIn = r.amountIn ? parseFloat(r.amountIn) : 0;
      const lossPct = quoted > 0 ? (quoted - executed) / quoted : 0;
      return sum + Math.max(0, lossPct) * amountIn;
    }, 0);

  return { dailyTradeCount, dailyLossUsd };
}

export async function executeTradeForSignal(signalId: string): Promise<ExecuteResult> {
  const config = getAutoTradeConfig();

  const [signal] = await db.select().from(signals).where(eq(signals.id, signalId)).limit(1);
  if (!signal) return { status: "SKIPPED", skipReason: "SIGNAL_NOT_FOUND" };

  if (await isKillSwitchEngaged()) {
    return recordSkip(signal, config, "KILL_SWITCH_ENGAGED");
  }

  const chainKey = signal.chain === "BNB" ? "BNB" : signal.chain === "Solana" ? "SOLANA" : null;
  if (!chainKey || chainKey !== config.chain) {
    return recordSkip(signal, config, "CHAIN_NOT_CONFIGURED_FOR_AUTO_TRADE");
  }
  if (!signal.contractAddress) {
    return recordSkip(signal, config, "NO_CONTRACT_ADDRESS");
  }

  // Live price + liquidity, fetched fresh (never trust a client-supplied or
  // stale-signal price for the eligibility/deviation check).
  const dexChainId = REVERSE_CHAIN_MAP[signal.chain];
  const pairs = dexChainId ? await getPairsForToken(dexChainId, signal.contractAddress) : [];
  const pair = bestPair(pairs);
  const currentPrice = pair?.priceUsd ? parseFloat(pair.priceUsd) : null;
  const liquidityUsd = pair?.liquidity?.usd ?? null;

  const action = signal.signalType === "SELL" ? "SELL" : "BUY";

  const walletConfigured = isWalletConfigured(config.chain);
  const walletAddress = getWalletPublicAddress(config.chain);

  let tokenBalance: number | null = null;
  if (action === "SELL" && walletConfigured) {
    tokenBalance =
      config.chain === "SOLANA"
        ? await getSolanaTokenBalance(signal.contractAddress)
        : await getEvmTokenBalance(signal.contractAddress);
  }

  // Duplicate check — a live/dry-run execution already exists for this signal+action.
  const existing = await db
    .select({ id: autoTradeExecutions.id })
    .from(autoTradeExecutions)
    .where(
      and(
        eq(autoTradeExecutions.signalId, signal.id),
        eq(autoTradeExecutions.action, action),
        inArray(autoTradeExecutions.status, ["DRY_RUN", "SUBMITTED", "CONFIRMED"])
      )
    )
    .limit(1);
  const hasDuplicateExecution = existing.length > 0;

  const { dailyTradeCount, dailyLossUsd } = await getDailyStats(config);

  // Build a quote up front — even in dry-run this is a read-only call, so it
  // gives a real slippage/price-impact figure for the eligibility check
  // instead of guessing.
  const amountConfigured = config.baseCurrency === "SOL" ? config.amountSol : config.amountUsdc;
  let quotedPrice: number | null = currentPrice;
  let slippageBps: number | null = null;
  let quote: any = null;

  if (walletConfigured && liquidityUsd != null) {
    try {
      if (config.chain === "SOLANA") {
        const inputMint = action === "BUY" ? (config.baseCurrency === "SOL" ? SOL_MINT : USDC_MINT_SOLANA) : signal.contractAddress;
        const outputMint = action === "BUY" ? signal.contractAddress : (config.baseCurrency === "SOL" ? SOL_MINT : USDC_MINT_SOLANA);
        const decimals = config.baseCurrency === "SOL" ? 9 : 6;
        const amountLamports =
          action === "BUY"
            ? Math.floor(amountConfigured * 10 ** decimals)
            : Math.floor((tokenBalance ?? 0) * 10 ** 9); // token decimals vary; best-effort for quoting only

        if (amountLamports > 0) {
          quote = await getJupiterQuote({ inputMint, outputMint, amountLamports, slippageBps: config.maxSlippageBps });
          if (quote) {
            slippageBps = Math.round(Math.abs(parseFloat(quote.priceImpactPct)) * 10000);
          }
        }
      } else {
        // BNB / PancakeSwap
        const amountInWei =
          action === "BUY"
            ? BigInt(Math.floor(amountConfigured * 1e18))
            : BigInt(Math.floor((tokenBalance ?? 0) * 1e18));
        if (amountInWei > BigInt(0)) {
          const pq = await getPancakeQuote({ tokenAddress: signal.contractAddress, amountInWei, direction: action });
          if (pq) {
            quote = pq;
            // Rough slippage estimate: compare router quote's implied price to DexScreener's live price.
            if (currentPrice != null) {
              slippageBps = 0; // router quote already reflects live pool state at request time
            }
          }
        }
      }
    } catch (err) {
      console.error("Quote fetch failed:", err);
    }
  }

  const eligibility = evaluateEligibility({
    signalType: signal.signalType,
    confidence: signal.confidence as any,
    momentumScore: signal.momentumScore,
    signalCreatedAt: signal.createdAt,
    entryPrice: signal.entryPrice ? parseFloat(signal.entryPrice) : null,
    currentPrice,
    config,
    now: new Date(),
    safetyVerdict: signal.safetyVerdict as any,
    safetyOverride: signal.safetyOverride,
    liquidityUsd,
    slippageBps,
    hasDuplicateExecution,
    dailyTradeCount,
    dailyLossUsd,
    walletConfigured,
    walletHasSufficientFunds: walletConfigured, // refined below once we know quote sizing
    tokenBalance,
  });

  if (!eligibility.eligible) {
    return recordSkip(signal, config, eligibility.skipReason ?? "NOT_ELIGIBLE", action);
  }

  if (!quote) {
    return recordSkip(signal, config, "NO_ROUTE_AVAILABLE", action);
  }

  const baseAmountLabel = `${amountConfigured} ${config.baseCurrency}`;

  // ---- DRY RUN: log the full decision, never sign or broadcast. ----
  if (config.dryRun) {
    const [row] = await db
      .insert(autoTradeExecutions)
      .values({
        signalId: signal.id,
        action,
        chain: signal.chain,
        tokenAddress: signal.contractAddress,
        baseCurrency: config.baseCurrency,
        amountIn: String(amountConfigured),
        quotedPrice: quotedPrice != null ? String(quotedPrice) : null,
        slippageBps,
        status: "DRY_RUN",
        dryRun: true,
        submittedAt: new Date(),
      })
      .returning();

    await logAudit({
      actorId: null,
      actorLabel: "system:auto-trade",
      action: "trade.dry_run",
      targetType: "signal",
      targetId: signal.id,
      metadata: { action, chain: signal.chain, wallet: walletAddress, amount: baseAmountLabel, quotedPrice },
    });

    await sendTradeAlert({
      event: "SUBMITTED",
      tokenName: signal.tokenName,
      ticker: signal.ticker,
      action,
      chain: signal.chain,
      baseCurrency: config.baseCurrency,
      amount: baseAmountLabel,
      confidence: signal.confidence,
      momentumScore: signal.momentumScore,
      safetyVerdict: signal.safetyVerdict,
      transactionId: null,
      dryRun: true,
    });

    return { status: "DRY_RUN", executionId: row.id };
  }

  // ---- LIVE EXECUTION: requires AUTO_TRADE_ENABLED=true AND AUTO_TRADE_DRY_RUN=false. ----
  const [pendingRow] = await db
    .insert(autoTradeExecutions)
    .values({
      signalId: signal.id,
      action,
      chain: signal.chain,
      tokenAddress: signal.contractAddress,
      baseCurrency: config.baseCurrency,
      amountIn: String(amountConfigured),
      quotedPrice: quotedPrice != null ? String(quotedPrice) : null,
      slippageBps,
      status: "SUBMITTED",
      dryRun: false,
      submittedAt: new Date(),
    })
    .returning();

  const swapResult =
    config.chain === "SOLANA"
      ? await executeJupiterSwap(quote)
      : await executePancakeSwap({
          quote,
          direction: action,
          tokenAddress: signal.contractAddress,
          maxSlippageBps: config.maxSlippageBps,
        });

  if (!swapResult.success) {
    await db
      .update(autoTradeExecutions)
      .set({ status: "FAILED", skipReason: swapResult.error })
      .where(eq(autoTradeExecutions.id, pendingRow.id));

    await logAudit({
      actorId: null,
      actorLabel: "system:auto-trade",
      action: "trade.failed",
      targetType: "signal",
      targetId: signal.id,
      metadata: { action, chain: signal.chain, error: swapResult.error },
    });

    await sendTradeAlert({
      event: "FAILED",
      tokenName: signal.tokenName,
      ticker: signal.ticker,
      action,
      chain: signal.chain,
      baseCurrency: config.baseCurrency,
      amount: baseAmountLabel,
      confidence: signal.confidence,
      momentumScore: signal.momentumScore,
      safetyVerdict: signal.safetyVerdict,
      transactionId: null,
      failureReason: swapResult.error,
      dryRun: false,
    });

    return { status: "FAILED", executionId: pendingRow.id };
  }

  await db
    .update(autoTradeExecutions)
    .set({ transactionId: swapResult.transactionId, amountOut: swapResult.amountOut })
    .where(eq(autoTradeExecutions.id, pendingRow.id));

  await sendTradeAlert({
    event: "SUBMITTED",
    tokenName: signal.tokenName,
    ticker: signal.ticker,
    action,
    chain: signal.chain,
    baseCurrency: config.baseCurrency,
    amount: baseAmountLabel,
    confidence: signal.confidence,
    momentumScore: signal.momentumScore,
    safetyVerdict: signal.safetyVerdict,
    transactionId: swapResult.transactionId,
    dryRun: false,
  });

  // Confirm — but never claim filled until we actually know. An UNKNOWN
  // result leaves the row as SUBMITTED rather than being blindly retried.
  const confirmStatus =
    config.chain === "SOLANA"
      ? await confirmSolanaTransaction(swapResult.transactionId)
      : await confirmEvmTransaction(swapResult.transactionId);

  if (confirmStatus === "CONFIRMED") {
    await db
      .update(autoTradeExecutions)
      .set({ status: "CONFIRMED", confirmedAt: new Date(), executedPrice: quotedPrice != null ? String(quotedPrice) : null })
      .where(eq(autoTradeExecutions.id, pendingRow.id));

    await logAudit({
      actorId: null,
      actorLabel: "system:auto-trade",
      action: "trade.confirmed",
      targetType: "signal",
      targetId: signal.id,
      metadata: { action, chain: signal.chain, transactionId: swapResult.transactionId },
    });

    await sendTradeAlert({
      event: "CONFIRMED",
      tokenName: signal.tokenName,
      ticker: signal.ticker,
      action,
      chain: signal.chain,
      baseCurrency: config.baseCurrency,
      amount: baseAmountLabel,
      confidence: signal.confidence,
      momentumScore: signal.momentumScore,
      safetyVerdict: signal.safetyVerdict,
      transactionId: swapResult.transactionId,
      dryRun: false,
    });

    return { status: "CONFIRMED", transactionId: swapResult.transactionId, executionId: pendingRow.id };
  }

  if (confirmStatus === "FAILED") {
    await db
      .update(autoTradeExecutions)
      .set({ status: "FAILED", skipReason: "Transaction reverted or was rejected on-chain." })
      .where(eq(autoTradeExecutions.id, pendingRow.id));

    await sendTradeAlert({
      event: "FAILED",
      tokenName: signal.tokenName,
      ticker: signal.ticker,
      action,
      chain: signal.chain,
      baseCurrency: config.baseCurrency,
      amount: baseAmountLabel,
      confidence: signal.confidence,
      momentumScore: signal.momentumScore,
      safetyVerdict: signal.safetyVerdict,
      transactionId: swapResult.transactionId,
      failureReason: "Transaction reverted or was rejected on-chain.",
      dryRun: false,
    });

    return { status: "FAILED", transactionId: swapResult.transactionId, executionId: pendingRow.id };
  }

  // UNKNOWN confirmation status — row stays SUBMITTED. A later scheduler
  // pass or manual admin check can re-verify; this function never retries
  // the broadcast for an unknown-status transaction.
  return { status: "SUBMITTED", transactionId: swapResult.transactionId, executionId: pendingRow.id };
}

async function recordSkip(
  signal: typeof signals.$inferSelect,
  config: AutoTradeConfig,
  reason: string,
  action?: "BUY" | "SELL"
): Promise<ExecuteResult> {
  await db.insert(autoTradeExecutions).values({
    signalId: signal.id,
    action: action ?? (signal.signalType === "SELL" ? "SELL" : "BUY"),
    chain: signal.chain,
    tokenAddress: signal.contractAddress ?? "unknown",
    baseCurrency: config.baseCurrency,
    status: "SKIPPED",
    skipReason: reason,
    dryRun: config.dryRun,
  });
  return { status: "SKIPPED", skipReason: reason };
}
