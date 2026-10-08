import { randomUUID } from "crypto";
import { runScanStage } from "./scan";
import { runSafetyStage } from "./safety";
import { runAutoTradeStage } from "./autotrade";
import { runPriceRefreshStage, runLifecycleStage } from "./prices";
import { StageRunner } from "./stage-runner";
import { sendCycleSummaryAlert, type CycleHealthReport } from "./notify";
import { logAudit } from "@/lib/audit";

// The core market-processing pipeline: discovery/scoring, safety analysis,
// signal creation, auto-trade evaluation+execution, price refresh, and
// TP/SL/invalidation lifecycle. Used by /api/cron/market-cycle (standalone,
// for rollback/manual runs). The unified scheduler (/api/cron/
// monitoring-scheduler) does NOT call this function directly — it calls the
// same underlying stage functions individually (runScanStage, runSafetyStage,
// runAutoTradeStage, runPriceRefreshStage, runLifecycleStage) so it can
// report per-stage health for each of its 12 spec'd stages rather than one
// collapsed entry. Either way there is exactly one implementation of each
// stage's logic — this file and the scheduler route are just two different
// orchestration wrappers around the same stage modules.
export async function runMarketCycle(options?: { sendSummaryAlert?: boolean }): Promise<CycleHealthReport> {
  const runId = randomUUID();
  const runner = new StageRunner(runId);

  const scan = await runner.run("discovery_and_scoring", () => runScanStage());

  const safety = await runner.run("safety_analysis", () => runSafetyStage(scan?.postedSignalIds ?? []));

  await runner.run("signal_creation", async () => ({
    posted: scan?.posted ?? 0,
    blockedByPublicationSafety: safety?.blockedPublication ?? [],
  }));

  const autoTrade = await runner.run("auto_trade_eval_and_execution", () =>
    runAutoTradeStage(scan?.postedSignalIds ?? [])
  );

  const priceRefresh = await runner.run("active_position_price_refresh", () => runPriceRefreshStage());

  await runner.run("tp_sl_invalidation", () => runLifecycleStage(priceRefresh?.pairsBySignalId ?? {}));

  await runner.run("audit_persist", async () => {
    await logAudit({
      actorId: null,
      actorLabel: "system:market-cycle",
      action: "cycle.market_cycle_completed",
      metadata: {
        runId,
        posted: scan?.posted ?? 0,
        safetyAnalyzed: safety?.analyzed ?? 0,
        tradesEvaluated: autoTrade?.evaluated ?? 0,
        pricesUpdated: priceRefresh?.updated ?? 0,
      },
    });
    return { logged: true };
  });

  const report = runner.finish();
  if (options?.sendSummaryAlert !== false) {
    await sendCycleSummaryAlert(report, "Market Cycle");
  }
  return report;
}
