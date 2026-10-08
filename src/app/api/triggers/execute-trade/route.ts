import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { executeTradeForSignal } from "@/lib/trading/executor";

export const dynamic = "force-dynamic";

const schema = z.object({
  signal_id: z.string().uuid(),
});

// IMPORTANT: this route intentionally accepts nothing but a signal_id. Price,
// amount, chain, and wallet are always re-derived server-side inside
// executeTradeForSignal — a client-supplied price/amount/chain is never
// trusted, per the spec. This is also the endpoint the auto-trade cycle
// stage effectively wraps (runAutoTradeStage calls executeTradeForSignal
// directly rather than making an HTTP round-trip to this route, but the
// logic executed is identical).
export async function POST(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await executeTradeForSignal(parsed.data.signal_id);
  return NextResponse.json(result);
}
