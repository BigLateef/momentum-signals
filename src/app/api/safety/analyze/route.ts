import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { apiRateLimit, getClientIp } from "@/lib/ratelimit";
import { analyzeToken } from "@/lib/safety/analyze";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const schema = z.object({
  chain: z.string().min(1),
  token_address: z.string().min(1),
  signal_id: z.string().uuid().optional().nullable(),
  force_refresh: z.boolean().optional().default(false),
});

// Callable by any logged-in user (read-heavy, cached) OR the cron key (used
// internally by the scheduler/triggers routes). Reuses the app's existing
// session + rate-limit patterns.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const isCron = isAuthorizedCronRequest(req);
  if (!session && !isCron) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isCron) {
    const { success } = await apiRateLimit.limit(getClientIp(req));
    if (!success) return NextResponse.json({ error: "Rate limited" }, { status: 429 });
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
    forceRefresh: d.force_refresh,
  });

  await logAudit({
    actorId: session?.userId ?? null,
    actorLabel: session?.email ?? "system:cron",
    action: "safety.analyze",
    targetType: "token",
    targetId: d.token_address,
    metadata: { chain: d.chain, verdict: report.verdict, safetyScore: report.safetyScore },
  });

  return NextResponse.json({ report });
}
