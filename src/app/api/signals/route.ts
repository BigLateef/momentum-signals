import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { signals, watchlist, autoTradeExecutions } from "@/db/schema";
import { getSession } from "@/lib/session";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { sendDiscordAlert } from "@/lib/discord";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const chain = searchParams.get("chain");
  const type = searchParams.get("type");
  const watchlistOnly = searchParams.get("watchlist") === "true";
  const includeInactive = searchParams.get("all") === "true" && session.role === "admin";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const conditions = includeInactive ? [] : [eq(signals.isActive, true)];
  if (chain && chain !== "All") conditions.push(eq(signals.chain, chain));
  if (type && type !== "All") conditions.push(eq(signals.signalType, type as any));

  let rows;
  if (watchlistOnly) {
    rows = await db
      .select({ signal: signals })
      .from(watchlist)
      .innerJoin(signals, eq(watchlist.signalId, signals.id))
      .where(and(eq(watchlist.userId, session.userId), ...conditions))
      .orderBy(desc(signals.createdAt))
      .limit(pageSize)
      .offset(offset);
    rows = rows.map((r) => r.signal);
  } else {
    rows = await db
      .select()
      .from(signals)
      .where(and(...conditions))
      .orderBy(desc(signals.createdAt))
      .limit(pageSize)
      .offset(offset);
  }

  let count: number;
  if (watchlistOnly) {
    const [{ count: c }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(watchlist)
      .innerJoin(signals, eq(watchlist.signalId, signals.id))
      .where(and(eq(watchlist.userId, session.userId), ...conditions));
    count = c;
  } else {
    const [{ count: c }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(signals)
      .where(and(...conditions));
    count = c;
  }

  // Attach whether the current user has watchlisted each signal
  const userWatchlist = await db
    .select({ signalId: watchlist.signalId })
    .from(watchlist)
    .where(eq(watchlist.userId, session.userId));
  const watchedIds = new Set(userWatchlist.map((w) => w.signalId));

  // Attach each signal's most recent auto-trade execution (if any) for the
  // execution-status UI. One batched query instead of N+1.
  const signalIds = rows.map((s) => s.id);
  const executionRows =
    signalIds.length > 0
      ? await db
          .select()
          .from(autoTradeExecutions)
          .where(inArray(autoTradeExecutions.signalId, signalIds))
          .orderBy(desc(autoTradeExecutions.createdAt))
      : [];
  const latestExecutionBySignal = new Map<string, (typeof executionRows)[number]>();
  for (const ex of executionRows) {
    if (!latestExecutionBySignal.has(ex.signalId)) latestExecutionBySignal.set(ex.signalId, ex);
  }

  const enriched = rows.map((s) => ({
    ...s,
    isWatchlisted: watchedIds.has(s.id),
    latestExecution: latestExecutionBySignal.get(s.id) ?? null,
  }));

  return NextResponse.json({ signals: enriched, total: count, page, pageSize });
}

const signalSchema = z.object({
  token_name: z.string().min(1),
  ticker: z.string().min(1),
  contract_address: z.string().optional().nullable(),
  chain: z.string().min(1),
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
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = signalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid signal payload.", details: parsed.error.flatten() }, { status: 400 });
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
      createdBy: session.userId,
    })
    .returning();

  await logAudit({
    actorId: session.userId,
    actorLabel: session.email,
    action: "signal.post",
    targetType: "signal",
    targetId: inserted.id,
    metadata: { tokenName: inserted.tokenName, ticker: inserted.ticker, signalType: inserted.signalType },
  });

  await sendDiscordAlert(inserted);

  return NextResponse.json({ signal: inserted });
}
