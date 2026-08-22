import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { signals } from "@/db/schema";
import { getSession } from "@/lib/session";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const schema = z.object({
  is_active: z.boolean().optional(),
  current_price: z.number().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.is_active !== undefined) updates.isActive = parsed.data.is_active;
  if (parsed.data.current_price !== undefined) updates.currentPrice = String(parsed.data.current_price);

  const [updated] = await db
    .update(signals)
    .set(updates)
    .where(eq(signals.id, params.id))
    .returning();

  if (parsed.data.is_active !== undefined) {
    await logAudit({
      actorId: session.userId,
      actorLabel: session.email,
      action: parsed.data.is_active ? "signal.reactivate" : "signal.deactivate",
      targetType: "signal",
      targetId: params.id,
      metadata: { tokenName: updated?.tokenName, ticker: updated?.ticker },
    });
  }

  return NextResponse.json({ signal: updated });
}
