import { db } from "@/db";
import { signals } from "@/db/schema";
import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { analyzeToken } from "@/lib/safety/analyze";
import { BLOCKING_VERDICTS } from "@/lib/safety/score";
import { logAudit } from "@/lib/audit";

const RECHECK_STALE_AFTER_MS = 30 * 60 * 1000; // re-analyze active signals every 30 min
const MAX_RECHECKS_PER_RUN = 10; // keep the stage inside the function timeout

export type SafetyStageResult = {
  analyzed: number;
  blockedPublication: string[]; // ticker list
  requiresOverride: string[];
  errors: number;
};

// Analyzes every newly-posted signal id, plus a small batch of active
// signals whose safety data has gone stale. Signals whose verdict comes
// back BLOCKED / CRITICAL / INSUFFICIENT_DATA (and have no admin override)
// are deactivated — the closest honest equivalent to "blocking publication"
// available in a post-insert pipeline; see README for why the check can't
// run fully pre-insert without restructuring the scanner.
export async function runSafetyStage(newSignalIds: string[]): Promise<SafetyStageResult> {
  const blockedPublication: string[] = [];
  const requiresOverride: string[] = [];
  let analyzed = 0;
  let errors = 0;

  const staleActive = await db
    .select()
    .from(signals)
    .where(
      and(
        eq(signals.isActive, true),
        isNotNull(signals.contractAddress),
        or(isNull(signals.safetyCheckedAt), lt(signals.safetyCheckedAt, new Date(Date.now() - RECHECK_STALE_AFTER_MS)))
      )
    )
    .limit(MAX_RECHECKS_PER_RUN);

  const byId = new Map(staleActive.map((r) => [r.id, r]));
  for (const id of newSignalIds) {
    if (byId.has(id)) continue;
    const [row] = await db.select().from(signals).where(eq(signals.id, id)).limit(1);
    if (row) byId.set(id, row);
  }

  for (const [id, signal] of byId) {
    if (!signal?.contractAddress) continue;

    try {
      const report = await analyzeToken({
        chain: signal.chain,
        tokenAddress: signal.contractAddress,
        signalId: signal.id,
      });
      analyzed++;

      if (BLOCKING_VERDICTS.includes(report.verdict) && !signal.safetyOverride) {
        if (signal.isActive) {
          await db.update(signals).set({ isActive: false }).where(eq(signals.id, signal.id));
          await logAudit({
            actorId: null,
            actorLabel: "system:safety",
            action: "safety.blocked_publication",
            targetType: "signal",
            targetId: signal.id,
            metadata: { ticker: signal.ticker, verdict: report.verdict },
          });
        }
        blockedPublication.push(signal.ticker);
      } else if (report.verdict === "VERY_HIGH_RISK" && !signal.safetyOverride) {
        requiresOverride.push(signal.ticker);
      }
    } catch (err) {
      errors++;
      console.error(`Safety stage failed for signal ${id}:`, err);
    }
  }

  return { analyzed, blockedPublication, requiresOverride, errors };
}
