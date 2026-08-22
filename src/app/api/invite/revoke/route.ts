import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { inviteCodes } from "@/db/schema";
import { getSession } from "@/lib/session";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const schema = z.object({ id: z.string().uuid() });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  await db
    .update(inviteCodes)
    .set({ revoked: true })
    .where(eq(inviteCodes.id, parsed.data.id));

  await logAudit({
    actorId: session.userId,
    actorLabel: session.email,
    action: "invite.revoke",
    targetType: "invite_code",
    targetId: parsed.data.id,
  });

  return NextResponse.json({ ok: true });
}
