import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { signals } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { sendDiscordAlert } from "@/lib/discord";
import { z } from "zod";

const schema = z.object({
  token_name: z.string().min(1),
  ticker: z.string().min(1),
  contract_address: z.string().optional().nullable(),
  chain: z.string().default("Solana"),
  exchange: z.string().optional().nullable(),
  signal_type: z.enum(["BUY", "SELL", "ALERT", "LAUNCH"]),
  entry_price: z.number().optional().nullable(),
  target_price_1: z.number().optional().nullable(),
  target_price_2: z.number().optional().nullable(),
  stop_loss: z.number().optional().nullable(),
  momentum_score: z.number().int().min(1).max(10).optional().nullable(),
  reason: z.string().optional().nullable(),
  chart_url: z.string().optional().nullable(),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_API_KEY}`;
  if (!process.env.CRON_API_KEY || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const [inserted] = await db
    .insert(signals)
    .values({
      tokenName: d.token_name,
      ticker: d.ticker,
      contractAddress: d.contract_address ?? undefined,
      chain: d.chain,
      exchange: d.exchange ?? undefined,
      signalType: d.signal_type,
      entryPrice: d.entry_price != null ? String(d.entry_price) : undefined,
      currentPrice: d.entry_price != null ? String(d.entry_price) : undefined,
      targetPrice1: d.target_price_1 != null ? String(d.target_price_1) : undefined,
      targetPrice2: d.target_price_2 != null ? String(d.target_price_2) : undefined,
      stopLoss: d.stop_loss != null ? String(d.stop_loss) : undefined,
      momentumScore: d.momentum_score ?? undefined,
      reason: d.reason ?? undefined,
      chartUrl: d.chart_url ?? undefined,
      confidence: d.confidence ?? undefined,
    })
    .returning();

  await logAudit({
    actorId: null,
    actorLabel: "system:external-trigger",
    action: "signal.post",
    targetType: "signal",
    targetId: inserted.id,
    metadata: { tokenName: inserted.tokenName, ticker: inserted.ticker, signalType: inserted.signalType },
  });

  await sendDiscordAlert(inserted);

  return NextResponse.json({ signal: inserted });
}
