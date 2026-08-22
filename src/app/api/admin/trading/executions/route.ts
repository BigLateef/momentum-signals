import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { autoTradeExecutions, signals } from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const VALID_STATUSES = ["ELIGIBLE", "SKIPPED", "DRY_RUN", "SUBMITTED", "CONFIRMED", "FAILED"] as const;

// Lists auto-trade executions for the admin panel, including skipped/failed
// ones so admins can see the full decision trail, not just successful trades.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status"); // e.g. "SKIPPED,FAILED"
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = 25;
  const offset = (page - 1) * pageSize;

  // Only pass through values that are actually valid statuses — silently
  // drop anything else rather than trusting the query string.
  const requestedStatuses = statusFilter
    ? statusFilter.split(",").filter((s): s is (typeof VALID_STATUSES)[number] =>
        (VALID_STATUSES as readonly string[]).includes(s)
      )
    : [];

  const conditions = requestedStatuses.length > 0 ? [inArray(autoTradeExecutions.status, requestedStatuses)] : [];

  const rows = await db
    .select({
      execution: autoTradeExecutions,
      tokenName: signals.tokenName,
      ticker: signals.ticker,
    })
    .from(autoTradeExecutions)
    .leftJoin(signals, eq(autoTradeExecutions.signalId, signals.id))
    .where(and(...conditions))
    .orderBy(desc(autoTradeExecutions.createdAt))
    .limit(pageSize)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(autoTradeExecutions)
    .where(and(...conditions));

  return NextResponse.json({ executions: rows, total: count, page, pageSize });
}
