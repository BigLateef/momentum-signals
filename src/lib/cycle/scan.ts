import { db } from "@/db";
import { signals, kolWallets } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";
import {
  getLatestBoostedTokens,
  getPairsForToken,
  bestPair,
  CHAIN_MAP,
  DexPair,
} from "@/lib/dexscreener";
import { computeMomentum } from "@/lib/momentum";
import { enrichReasonWithMistral } from "@/lib/mistral";
import { checkKolHoldings, summarizeKolMatches } from "@/lib/kol";
import { logAudit } from "@/lib/audit";
import { sendDiscordAlert } from "@/lib/discord";

const DEDUPE_WINDOW_HOURS = 6;
const MAX_TOKENS_PER_RUN = 15;

async function evaluateToken(
  token: { chainId: string; tokenAddress: string },
  chain: string
): Promise<{ token: typeof token; chain: string; pair: DexPair | null }> {
  try {
    const pairs = await getPairsForToken(token.chainId, token.tokenAddress);
    return { token, chain, pair: bestPair(pairs) };
  } catch {
    return { token, chain, pair: null };
  }
}

// Result type shared with the market-cycle/monitoring-scheduler stage report.
export type ScanStageResult = {
  scanned: number;
  posted: number;
  postedDetails: string[];
  skipped: number;
  // Raw candidate list so a caller (e.g. the auto-trade stage) can act on the
  // same tokens without re-scanning DexScreener.
  postedSignalIds: string[];
};

export async function runScanStage(): Promise<ScanStageResult> {
  const boosted = (await getLatestBoostedTokens())
    .filter((t) => CHAIN_MAP[t.chainId])
    .slice(0, MAX_TOKENS_PER_RUN);

  const cutoff = new Date(Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000);
  const skipped: string[] = [];

  const evaluated = await Promise.all(
    boosted.map((token) => evaluateToken(token, CHAIN_MAP[token.chainId]))
  );

  const allWallets = await db.select().from(kolWallets);
  const walletsByChain: Record<string, { address: string; label: string }[]> = {};
  for (const w of allWallets) {
    (walletsByChain[w.chain] ??= []).push({ address: w.address, label: w.label });
  }

  const candidates: {
    token: (typeof boosted)[number];
    chain: string;
    pair: DexPair;
    momentum: NonNullable<ReturnType<typeof computeMomentum>>;
  }[] = [];

  for (const { token, chain, pair } of evaluated) {
    if (!pair) {
      skipped.push(`${token.tokenAddress} (no pair data)`);
      continue;
    }

    const momentum = computeMomentum(pair);
    if (!momentum || !momentum.signalType) {
      skipped.push(`${pair.baseToken.symbol} (below momentum threshold)`);
      continue;
    }

    const recent = await db
      .select({ id: signals.id })
      .from(signals)
      .where(
        and(
          eq(signals.contractAddress, token.tokenAddress),
          eq(signals.chain, chain),
          eq(signals.isActive, true),
          gt(signals.createdAt, cutoff)
        )
      )
      .limit(1);

    if (recent.length > 0) {
      skipped.push(`${pair.baseToken.symbol} (already posted recently)`);
      continue;
    }

    candidates.push({ token, chain, pair, momentum });
  }

  const enrichedCandidates = await Promise.all(
    candidates.map(async ({ token, chain, pair, momentum }) => {
      const h1 = pair.priceChange?.h1 ?? 0;
      const h6 = pair.priceChange?.h6 ?? 0;
      const buys = pair.txns?.h1?.buys ?? 0;
      const sells = pair.txns?.h1?.sells ?? 0;

      const [enrichedReason, kolMatches] = await Promise.all([
        enrichReasonWithMistral({
          tokenName: pair.baseToken.name,
          ticker: pair.baseToken.symbol,
          chain,
          signalType: momentum.signalType!,
          priceChange1h: h1,
          priceChange6h: h6,
          volume24h: pair.volume?.h24 ?? 0,
          liquidity: pair.liquidity?.usd ?? 0,
          buys,
          sells,
          fallbackReason: momentum.reason,
        }),
        checkKolHoldings(chain, token.tokenAddress, walletsByChain[chain] ?? []),
      ]);

      return {
        token,
        chain,
        pair,
        momentum,
        reason: enrichedReason,
        kolSummary: summarizeKolMatches(kolMatches),
      };
    })
  );

  // NOTE: signals are inserted here WITHOUT a safety check yet — the
  // safety-analysis stage runs immediately after in market-cycle/the
  // scheduler and updates the same row. The legacy /api/cron/scan route
  // (kept for rollback) does not run a safety stage, so signals it posts
  // stay safety-unchecked until an admin or the scheduler analyzes them.
  const posted: string[] = [];
  const postedSignalIds: string[] = [];
  for (const c of enrichedCandidates) {
    const [inserted] = await db
      .insert(signals)
      .values({
        tokenName: c.pair.baseToken.name,
        ticker: c.pair.baseToken.symbol,
        contractAddress: c.token.tokenAddress,
        chain: c.chain,
        exchange: c.pair.dexId,
        signalType: c.momentum.signalType!,
        entryPrice: String(c.momentum.entryPrice),
        currentPrice: String(c.momentum.entryPrice),
        targetPrice1: String(c.momentum.targetPrice1),
        targetPrice2: String(c.momentum.targetPrice2),
        stopLoss: String(c.momentum.stopLoss),
        momentumScore: c.momentum.score,
        reason: c.reason,
        chartUrl: c.pair.url,
        confidence: c.momentum.confidence,
        kolSummary: c.kolSummary,
      })
      .returning();

    await sendDiscordAlert(inserted); // unchanged existing HIGH-confidence signal alert behavior
    posted.push(`${c.pair.baseToken.symbol} (score ${c.momentum.score}, ${c.momentum.signalType})`);
    postedSignalIds.push(inserted.id);
  }

  if (posted.length > 0) {
    await logAudit({
      actorId: null,
      actorLabel: "system:scanner",
      action: "scan.posted",
      targetType: "signal",
      metadata: { count: posted.length, tokens: posted },
    });
  }

  return {
    scanned: evaluated.length,
    posted: posted.length,
    postedDetails: posted,
    skipped: skipped.length,
    postedSignalIds,
  };
}
