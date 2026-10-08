import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getSession } from "@/lib/session";
import { eq, sql } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const schema = z.object({ userId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }

  const [target] = await db
    .update(profiles)
    .set({ sessionVersion: sql`${profiles.sessionVersion} + 1` })
    .where(eq(profiles.id, parsed.data.userId))
    .returning({ email: profiles.email });

  if (!target) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  await logAudit({
    actorId: session.userId,
    actorLabel: session.email,
    action: "session.revoke",
    targetType: "profile",
    targetId: parsed.data.userId,
    metadata: { revokedEmail: target.email },
  });

  return NextResponse.json({ ok: true, email: target.email });
}
