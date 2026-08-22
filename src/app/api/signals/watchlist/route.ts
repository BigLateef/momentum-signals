import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { watchlist } from "@/db/schema";
import { getSession } from "@/lib/session";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({ signal_id: z.string().uuid() });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const existing = await db
    .select()
    .from(watchlist)
    .where(
      and(eq(watchlist.userId, session.userId), eq(watchlist.signalId, parsed.data.signal_id))
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .delete(watchlist)
      .where(
        and(eq(watchlist.userId, session.userId), eq(watchlist.signalId, parsed.data.signal_id))
      );
    return NextResponse.json({ watchlisted: false });
  }

  await db.insert(watchlist).values({
    userId: session.userId,
    signalId: parsed.data.signal_id,
  });
  return NextResponse.json({ watchlisted: true });
}
