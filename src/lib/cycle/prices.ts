import { db } from "@/db";
import { signals } from "@/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { getPairsForToken, bestPair, CHAIN_MAP } from "@/lib/dexscreener";

const REVERSE_CHAIN_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(CHAIN_MAP).map(([k, v]) => [v, k])
);

export type PriceRefreshResult = {
  checked: number;
  updated: number;
  deactivated: number;
  // Live pair data keyed by signal id, so a later stage (lifecycle,
  // auto-trade) can reuse the same fetch instead of hitting DexScreener again.
  pairsBySignalId: Record<string, { price: number; liquidityUsd: number | null }>;
};

export async function runPriceRefreshStage(): Promise<PriceRefreshResult> {
  const active = await db
    .select()
    .from(signals)
    .where(and(eq(signals.isActive, true), isNotNull(signals.contractAddress)));

  const results = await Promise.all(
    active.map(async (signal) => {
      const chainId = REVERSE_CHAIN_MAP[signal.chain];
      if (!chainId || !signal.contractAddress) return null;
      try {
        const pairs = await getPairsForToken(chainId, signal.contractAddress);
        const pair = bestPair(pairs);
        const price = parseFloat(pair?.priceUsd ?? "");
        if (!pair || Number.isNaN(price)) return null;
        return { signal, price, liquidityUsd: pair.liquidity?.usd ?? null };
      } catch {
        return null;
      }
    })
  );

  let updated = 0;
  let deactivated = 0;
  const pairsBySignalId: PriceRefreshResult["pairsBySignalId"] = {};

  for (const result of results) {
    if (!result) continue;
    const { signal, price, liquidityUsd } = result;
    pairsBySignalId[signal.id] = { price, liquidityUsd };

    const stop = signal.stopLoss ? parseFloat(signal.stopLoss) : null;
    const shouldDeactivate = stop != null && price <= stop;

    await db
      .update(signals)
      .set({
        currentPrice: String(price),
        isActive: shouldDeactivate ? false : signal.isActive,
      })
      .where(eq(signals.id, signal.id));

    updated++;
    if (shouldDeactivate) deactivated++;
  }

  return { checked: active.length, updated, deactivated, pairsBySignalId };
}

export type LifecycleResult = {
  checked: number;
  tp1Hits: number;
  tp2Hits: number;
  stopLossHits: number;
  invalidated: number;
};

// Marks TP1/TP2 hits (new — the pre-upgrade lifecycle only tracked stop-loss
// deactivation) and invalidates signals whose liquidity has collapsed, using
// the price/liquidity data the refresh stage already fetched this run.
export async function runLifecycleStage(
  pairsBySignalId: PriceRefreshResult["pairsBySignalId"]
): Promise<LifecycleResult> {
  const active = await db.select().from(signals).where(eq(signals.isActive, true));

  let tp1Hits = 0;
  let tp2Hits = 0;
  let stopLossHits = 0;
  let invalidated = 0;

  for (const signal of active) {
    const live = pairsBySignalId[signal.id];
    if (!live) continue;

    const tp1 = signal.targetPrice1 ? parseFloat(signal.targetPrice1) : null;
    const tp2 = signal.targetPrice2 ? parseFloat(signal.targetPrice2) : null;
    const stop = signal.stopLoss ? parseFloat(signal.stopLoss) : null;

    const updates: Partial<typeof signals.$inferInsert> = {};

    if (tp1 != null && live.price >= tp1 && !signal.tp1HitAt) {
      updates.tp1HitAt = new Date();
      tp1Hits++;
    }
    if (tp2 != null && live.price >= tp2 && !signal.tp2HitAt) {
      updates.tp2HitAt = new Date();
      updates.isActive = false;
      tp2Hits++;
    }
    if (stop != null && live.price <= stop && signal.isActive) {
      // Already handled by the price-refresh stage's isActive flip, but keep
      // an explicit count here for the stage health report.
      stopLossHits++;
    }

    // Liquidity-collapse invalidation: a real anti-rug signal, distinct from
    // hitting the stop-loss price.
    if (
      live.liquidityUsd != null &&
      live.liquidityUsd < 1_000 &&
      signal.isActive &&
      !signal.invalidatedAt
    ) {
      updates.isActive = false;
      updates.invalidatedAt = new Date();
      updates.invalidationReason = "Liquidity collapsed below $1,000 — likely rug/abandonment.";
      invalidated++;
    }

    if (Object.keys(updates).length > 0) {
      await db.update(signals).set(updates).where(eq(signals.id, signal.id));
    }
  }

  return { checked: active.length, tp1Hits, tp2Hits, stopLossHits, invalidated };
}
