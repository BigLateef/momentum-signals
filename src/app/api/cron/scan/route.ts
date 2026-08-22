import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { runScanStage } from "@/lib/cycle/scan";
import { isUnifiedSchedulerAuthoritative } from "@/lib/cycle/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // no-op on Hobby (fixed at 10s), honored on Pro

// Kept for rollback compatibility. Scanning logic now lives in
// src/lib/cycle/scan.ts, shared with /api/cron/market-cycle and
// /api/cron/monitoring-scheduler. Once MONITORING_SCHEDULER_ENABLED=true,
// this route no-ops in production — pass ?force=true to run it manually.
async function handle(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const forced = new URL(req.url).searchParams.get("force") === "true";
  if (isUnifiedSchedulerAuthoritative() && !forced) {
    return NextResponse.json({
      skipped: true,
      reason: "Unified monitoring scheduler is authoritative. Use /api/cron/monitoring-scheduler, or pass ?force=true to run this legacy route manually.",
    });
  }

  const result = await runScanStage();
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

// Vercel Cron triggers via GET with an auto-attached CRON_SECRET bearer token.
export async function GET(req: NextRequest) {
  return handle(req);
}
