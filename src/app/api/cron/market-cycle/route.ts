import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { withLock } from "@/lib/cron-lock";
import { runMarketCycle } from "@/lib/cycle/market-cycle";
import { isUnifiedSchedulerAuthoritative } from "@/lib/cycle/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // no-op on Hobby (fixed at 10s), honored on Pro

const LEASE_SECONDS = 55;

// Consolidates the legacy scan + update-prices jobs into one cron hit, plus
// the new safety-analysis and auto-trade stages, cutting the number of
// Neon-touching scheduled invocations roughly in half. Recommended job for
// market processing on its own — but once MONITORING_SCHEDULER_ENABLED=true,
// /api/cron/monitoring-scheduler becomes the overall recommended production
// entry point. NOTE: the scheduler does not call runMarketCycle() directly —
// it calls the same underlying stage functions (src/lib/cycle/scan.ts,
// safety.ts, autotrade.ts, prices.ts) individually, so it can report
// per-stage timing/health for each of the 12 spec'd stages instead of one
// collapsed "market cycle" entry. Both this route and the scheduler are thin
// orchestration wrappers around the identical stage implementations — there
// is exactly one implementation of each stage's logic, just two callers.
async function handle(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const forced = new URL(req.url).searchParams.get("force") === "true";
  if (isUnifiedSchedulerAuthoritative() && !forced) {
    return NextResponse.json({
      skipped: true,
      reason:
        "Unified monitoring scheduler is authoritative — market-cycle now runs as one of its internal stages. Pass ?force=true to run this route standalone for manual testing/rollback.",
    });
  }

  const outcome = await withLock("market-cycle", LEASE_SECONDS, () => runMarketCycle());
  if (!outcome.ran) {
    return NextResponse.json({ skipped: true, reason: "Another market-cycle run is already in progress." });
  }
  return NextResponse.json(outcome.result);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
