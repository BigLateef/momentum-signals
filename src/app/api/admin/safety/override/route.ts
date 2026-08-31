import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { signals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const schema = z.object({
  signal_id: z.string().uuid(),
  // true = approve and re-activate (override the blocking verdict);
  // false = clear an existing override / re-block the signal.
  override: z.boolean(),
  reason: z.string().min(3, "A reason is required for every override."),
});

// Admin "approve with override" / "block signal" action. Every override is
// stored with the admin's id, reason, and timestamp per the spec.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const [signal] = await db.select().from(signals).where(eq(signals.id, d.signal_id)).limit(1);
  if (!signal) return NextResponse.json({ error: "Signal not found" }, { status: 404 });

  const [updated] = await db
    .update(signals)
    .set({
      safetyOverride: d.override,
      safetyOverrideReason: d.reason,
      safetyOverrideBy: session.userId,
      safetyOverrideAt: new Date(),
      // Approving re-activates a signal that was auto-deactivated by the
      // safety stage; blocking deactivates it immediately.
      isActive: d.override ? true : false,
    })
    .where(eq(signals.id, d.signal_id))
    .returning();

  await logAudit({
    actorId: session.userId,
    actorLabel: session.email,
    action: d.override ? "safety.override_approve" : "safety.override_block",
    targetType: "signal",
    targetId: d.signal_id,
    metadata: { ticker: signal.ticker, verdict: signal.safetyVerdict, reason: d.reason },
  });

  return NextResponse.json({ signal: updated });
}
