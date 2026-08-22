import { NextResponse } from "next/server";
import { db } from "@/db";
import { signals } from "@/db/schema";
import { getSession } from "@/lib/session";
import { isNotNull, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .select()
    .from(signals)
    .where(and(isNotNull(signals.entryPrice), isNotNull(signals.currentPrice)));

  const withReturns = rows
    .map((s) => {
      const entry = parseFloat(s.entryPrice!);
      const current = parseFloat(s.currentPrice!);
      if (!entry || Number.isNaN(current)) return null;
      const returnPct = ((current - entry) / entry) * 100;
      return { ...s, returnPct };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const closed = withReturns.filter((s) => !s.isActive);
  const open = withReturns.filter((s) => s.isActive);

  function summarize(set: typeof withReturns) {
    if (set.length === 0) {
      return { count: 0, winRate: 0, avgReturn: 0, best: null as any, worst: null as any };
    }
    const wins = set.filter((s) => s.returnPct > 0).length;
    const avgReturn = set.reduce((sum, s) => sum + s.returnPct, 0) / set.length;
    const best = set.reduce((a, b) => (b.returnPct > a.returnPct ? b : a));
    const worst = set.reduce((a, b) => (b.returnPct < a.returnPct ? b : a));
    return {
      count: set.length,
      winRate: (wins / set.length) * 100,
      avgReturn,
      best: { tokenName: best.tokenName, ticker: best.ticker, returnPct: best.returnPct },
      worst: { tokenName: worst.tokenName, ticker: worst.ticker, returnPct: worst.returnPct },
    };
  }

  // Breakdown by chain
  const byChain: Record<string, { count: number; avgReturn: number; winRate: number }> = {};
  for (const chain of Array.from(new Set(withReturns.map((s) => s.chain)))) {
    const chainSet = withReturns.filter((s) => s.chain === chain);
    const wins = chainSet.filter((s) => s.returnPct > 0).length;
    byChain[chain] = {
      count: chainSet.length,
      avgReturn: chainSet.reduce((sum, s) => sum + s.returnPct, 0) / chainSet.length,
      winRate: (wins / chainSet.length) * 100,
    };
  }

  return NextResponse.json({
    totalSignals: withReturns.length,
    closed: summarize(closed),
    open: summarize(open),
    byChain,
  });
}
