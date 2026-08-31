import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { withLock, getLastRunStartedAt } from "@/lib/cron-lock";
import { runScanStage } from "@/lib/cycle/scan";
import { runSafetyStage } from "@/lib/cycle/safety";
import { runAutoTradeStage } from "@/lib/cycle/autotrade";
import { runPriceRefreshStage, runLifecycleStage } from "@/lib/cycle/prices";
import { runMonitoringStage, runPerformanceStage } from "@/lib/cycle/monitoring";
import { StageRunner } from "@/lib/cycle/stage-runner";
import { sendCycleSummaryAlert } from "@/lib/cycle/notify";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // no-op on Hobby (fixed at 10s), honored on Pro

const DEFAULT_MAX_RUNTIME_SECONDS = 240;
const DEFAULT_INTERVAL_MINUTES = 5;

// The single master cron entry point. Point your ONE cron-job.org schedule
// (or Vercel Cron) at this route, at MONITORING_SCHEDULER_INTERVAL_MINUTES.
// It runs every recurring task this app has — token discovery, safety
// analysis, signal creation, auto-trade, price refresh, TP/SL/invalidation,
// deployer/liquidity monitoring, performance stats, and notifications — as
// isolated, independently-timed, independently-erroring stages under one
// global lock, then writes one consolidated health report and sends at most
// one summary alert.
//
// This calls the same underlying stage functions that
// src/lib/cycle/market-cycle.ts calls (not that file itself) so each of the
// 12 spec'd stages gets its own timing/health entry instead of being
// collapsed into one "market cycle" block — see the comment at the top of
// src/lib/cycle/market-cycle.ts for why.
//
// /api/cron/scan, /api/cron/update-prices and /api/cron/market-cycle remain
// for rollback/manual testing, but no-op automatically once
// MONITORING_SCHEDULER_ENABLED=true (see src/lib/cycle/settings.ts) so
// nothing double-runs.
async function runMonitoringScheduler() {
  const runId = randomUUID();
  const runner = new StageRunner(runId);

  if ((process.env.MONITORING_SCHEDULER_ENABLED ?? "false").toLowerCase() !== "true") {
    runner.skip("scheduler_disabled", "MONITORING_SCHEDULER_ENABLED is not true");
    return runner.finish();
  }

  // 1. Market and token discovery, 2. Momentum/confidence, 4. Signal creation
  const scan = await runner.run("market_and_token_discovery", () => runScanStage());

  // 3. Anti-rug and safety analysis
  const safety = await runner.run("anti_rug_and_safety_analysis", () =>
    runSafetyStage(scan?.postedSignalIds ?? [])
  );

  await runner.run("signal_creation_and_publication_decisions", async () => ({
    posted: scan?.posted ?? 0,
    blockedByPublicationSafety: safety?.blockedPublication ?? [],
    requiresOverride: safety?.requiresOverride ?? [],
  }));

  // 5. Auto-trade eligibility and execution
  const autoTrade = await runner.run("auto_trade_eligibility_and_execution", () =>
    runAutoTradeStage(scan?.postedSignalIds ?? [])
  );

  // 6. Active-position price refresh (data reused by stage 7 below)
  const priceRefresh = await runner.run("active_position_price_refresh", () => runPriceRefreshStage());

  // 7. Take-profit, stop-loss and invalidation checks
  const lifecycle = await runner.run("tp_sl_invalidation_checks", () =>
    runLifecycleStage(priceRefresh?.pairsBySignalId ?? {})
  );

  // 8 & 9. Token/wallet monitoring, deployer/liquidity monitoring — see
  // src/lib/cycle/monitoring.ts for why this is scoped to the safety
  // pipeline's own re-check results rather than a separate system.
  await runner.run("token_and_wallet_monitoring", () =>
    runMonitoringStage(safety?.blockedPublication ?? [])
  );
  await runner.run("deployer_and_liquidity_monitoring", async () => ({
    invalidatedForLiquidity: lifecycle ? "see tp_sl_invalidation_checks stage" : "n/a",
  }));

  // 10. Performance and lifecycle updates
  const performance = await runner.run("performance_and_lifecycle_updates", () => runPerformanceStage());

  // 11. Discord and system notifications — the per-signal and per-trade
  // alerts already fired inline during their own stages; this is just the
  // one consolidated summary.
  await runner.run("notifications", async () => ({ willSendSummary: true }));

  // 12. Audit and health-report persistence
  await runner.run("audit_and_health_report_persist", async () => {
    await logAudit({
      actorId: null,
      actorLabel: "system:monitoring-scheduler",
      action: "cycle.monitoring_scheduler_completed",
      metadata: {
        runId,
        posted: scan?.posted ?? 0,
        safetyAnalyzed: safety?.analyzed ?? 0,
        tradesEvaluated: autoTrade?.evaluated ?? 0,
        pricesUpdated: priceRefresh?.updated ?? 0,
        performance,
      },
    });
    return { logged: true };
  });

  const report = runner.finish();
  await sendCycleSummaryAlert(report, "Monitoring Scheduler");
  return report;
}

async function handle(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // MONITORING_SCHEDULER_INTERVAL_MINUTES guards against over-eager or
  // duplicate triggers (e.g. two cron-job.org schedules pointed at this
  // route by mistake, or a manual run right after an automatic one) — if
  // the last run started less than the configured interval ago, skip
  // without even attempting the lock. This is independent of the lease
  // lock, which only prevents *concurrent* runs, not *frequent* ones.
  const intervalMinutes = Number(process.env.MONITORING_SCHEDULER_INTERVAL_MINUTES ?? DEFAULT_INTERVAL_MINUTES);
  const lastStarted = await getLastRunStartedAt("monitoring-scheduler");
  if (lastStarted) {
    const elapsedMs = Date.now() - lastStarted.getTime();
    const minIntervalMs = intervalMinutes * 60 * 1000;
    if (elapsedMs < minIntervalMs) {
      return NextResponse.json({
        skipped: true,
        reason: `Last run started ${Math.round(elapsedMs / 1000)}s ago, under the configured ${intervalMinutes}-minute MONITORING_SCHEDULER_INTERVAL_MINUTES interval.`,
      });
    }
  }

  const maxRuntime = Number(process.env.MONITORING_SCHEDULER_MAX_RUNTIME_SECONDS ?? DEFAULT_MAX_RUNTIME_SECONDS);
  const outcome = await withLock("monitoring-scheduler", Math.min(maxRuntime, 280), runMonitoringScheduler);

  if (!outcome.ran) {
    return NextResponse.json({ skipped: true, reason: "Another monitoring-scheduler run is already in progress." });
  }
  return NextResponse.json(outcome.result);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
