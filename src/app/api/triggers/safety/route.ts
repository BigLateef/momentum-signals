import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { analyzeToken } from "@/lib/safety/analyze";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const schema = z.object({
  chain: z.string().min(1),
  token_address: z.string().min(1),
  signal_id: z.string().uuid().optional().nullable(),
});

// External-trigger equivalent of /api/safety/analyze, matching the existing
// /api/triggers/signal pattern (cron-key auth, for use by cron-job.org or
// your own scripts, distinct from the session-based /api/safety/analyze).
export async function POST(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const report = await analyzeToken({
    chain: d.chain,
    tokenAddress: d.token_address,
    signalId: d.signal_id ?? null,
    forceRefresh: true,
  });

  await logAudit({
    actorId: null,
    actorLabel: "system:external-trigger",
    action: "safety.analyze",
    targetType: "token",
    targetId: d.token_address,
    metadata: { chain: d.chain, verdict: report.verdict },
  });

  return NextResponse.json({ report });
}
