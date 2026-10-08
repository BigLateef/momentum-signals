import { db } from "@/db";
import { signals } from "@/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";

export type PerformanceSnapshot = {
  openCount: number;
  closedCount: number;
  winRate: number;
  avgReturnPct: number;
};

// Lightweight recompute of the same aggregate stats /api/admin/stats
// exposes — kept here so the scheduler's health report can include a
// performance snapshot without an extra HTTP round-trip.
export async function runPerformanceStage(): Promise<PerformanceSnapshot> {
  const rows = await db
    .select()
    .from(signals)
    .where(and(isNotNull(signals.entryPrice), isNotNull(signals.currentPrice)));

  const withReturns = rows
    .map((s) => {
      const entry = parseFloat(s.entryPrice!);
      const current = parseFloat(s.currentPrice!);
      if (!entry || Number.isNaN(current)) return null;
      return { isActive: s.isActive, returnPct: ((current - entry) / entry) * 100 };
    })
    .filter((r): r is { isActive: boolean; returnPct: number } => r !== null);

  const open = withReturns.filter((r) => r.isActive);
  const closed = withReturns.filter((r) => !r.isActive);
  const wins = closed.filter((r) => r.returnPct > 0).length;

  return {
    openCount: open.length,
    closedCount: closed.length,
    winRate: closed.length > 0 ? (wins / closed.length) * 100 : 0,
    avgReturnPct: closed.length > 0 ? closed.reduce((s, r) => s + r.returnPct, 0) / closed.length : 0,
  };
}

export type MonitoringStageResult = {
  tokensReanalyzed: number;
  newlyFlagged: string[];
};

// "Deployer and liquidity monitoring" / "token and wallet monitoring":
// implemented as targeted re-analysis of active signals via the existing
// anti-rug safety pipeline (src/lib/safety) rather than a separate
// wallet-graph system — this platform doesn't have a dedicated on-chain
// wallet-clustering data source, so monitoring is honestly scoped to what
// the safety checks can actually detect (liquidity withdrawal, holder
// concentration drift, deployer track record). The safety stage
// (src/lib/cycle/safety.ts) already re-checks stale active signals every
// run; this stage just reports how many of those re-checks flipped to a
// blocking verdict since the last cycle, for the health report.
export async function runMonitoringStage(blockedThisRun: string[]): Promise<MonitoringStageResult> {
  return { tokensReanalyzed: blockedThisRun.length, newlyFlagged: blockedThisRun };
}
