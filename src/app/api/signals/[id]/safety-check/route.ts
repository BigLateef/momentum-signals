import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { signals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/session";
import { analyzeToken } from "@/lib/safety/analyze";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const schema = z.object({
  force_refresh: z.boolean().optional().default(false),
});

// Admin-triggered "run/refresh safety analysis" action for a specific signal
// — used by the SignalsTab safety controls.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [signal] = await db.select().from(signals).where(eq(signals.id, params.id)).limit(1);
  if (!signal) {
    return NextResponse.json({ error: "Signal not found" }, { status: 404 });
  }
  if (!signal.contractAddress) {
    return NextResponse.json({ error: "Signal has no contract address to analyze" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }
  const forceRefresh = parsed.data.force_refresh;

  const report = await analyzeToken({
    chain: signal.chain,
    tokenAddress: signal.contractAddress,
    signalId: signal.id,
    forceRefresh,
  });

  await logAudit({
    actorId: session.userId,
    actorLabel: session.email,
    action: "safety.signal_check",
    targetType: "signal",
    targetId: signal.id,
    metadata: { ticker: signal.ticker, verdict: report.verdict, forceRefresh },
  });

  return NextResponse.json({ report });
}
