import { db } from "@/db";
import { signals } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getAutoTradeConfig } from "@/lib/trading/config";
import { executeTradeForSignal, type ExecuteResult } from "@/lib/trading/executor";

export type AutoTradeStageResult = {
  configEnabled: boolean;
  evaluated: number;
  eligibleExecuted: number;
  skipped: number;
  failed: number;
  results: { signalId: string; ticker: string; result: ExecuteResult }[];
};

// Evaluates + (if eligible) executes auto-trades for a batch of signal ids —
// normally the ones the scan stage just posted, plus any SELL-eligible active
// signals so exits aren't limited to the moment a BUY was created.
export async function runAutoTradeStage(candidateSignalIds: string[]): Promise<AutoTradeStageResult> {
  const config = getAutoTradeConfig();
  if (!config.enabled || candidateSignalIds.length === 0) {
    return { configEnabled: config.enabled, evaluated: 0, eligibleExecuted: 0, skipped: 0, failed: 0, results: [] };
  }

  const rows = await db.select().from(signals).where(inArray(signals.id, candidateSignalIds));

  const results: AutoTradeStageResult["results"] = [];
  let eligibleExecuted = 0;
  let skipped = 0;
  let failed = 0;

  // Sequential on purpose — each execution touches the same burner wallet
  // (nonce/balance state), so concurrent execution risks nonce collisions
  // or double-spending the configured trade amount.
  for (const signal of rows) {
    try {
      const result = await executeTradeForSignal(signal.id);
      results.push({ signalId: signal.id, ticker: signal.ticker, result });
      if (result.status === "DRY_RUN" || result.status === "SUBMITTED" || result.status === "CONFIRMED") {
        eligibleExecuted++;
      } else if (result.status === "FAILED") {
        failed++;
      } else {
        skipped++;
      }
    } catch (err) {
      failed++;
      console.error(`Auto-trade stage failed for signal ${signal.id}:`, err);
    }
  }

  return {
    configEnabled: config.enabled,
    evaluated: rows.length,
    eligibleExecuted,
    skipped,
    failed,
    results,
  };
}
