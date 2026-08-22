import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { inviteCodes } from "@/db/schema";
import { getSession } from "@/lib/session";
import { generateInviteCode } from "@/lib/invite-code";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const schema = z.object({
  count: z.number().int().min(1).max(50),
  expires_in_days: z.number().int().min(1).max(90),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid parameters." }, { status: 400 });
  }
  const { count, expires_in_days } = parsed.data;
  // Every code is single-use, non-negotiable — one code, one person, one signup.
  const max_uses = 1;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expires_in_days);

  const generated: string[] = [];
  const rows = [];

  for (let i = 0; i < count; i++) {
    let code = generateInviteCode();
    // Ensure uniqueness against already-generated codes in this batch
    while (generated.includes(code)) {
      code = generateInviteCode();
    }
    generated.push(code);
    rows.push({
      code,
      createdBy: session.userId,
      maxUses: max_uses,
      expiresAt,
    });
  }

  // Insert one at a time to gracefully skip any unlikely DB-level collisions
  const inserted: string[] = [];
  for (const row of rows) {
    try {
      await db.insert(inviteCodes).values(row);
      inserted.push(row.code);
    } catch {
      // Collision against existing DB code — retry once with a fresh code
      const retryCode = generateInviteCode();
      await db.insert(inviteCodes).values({ ...row, code: retryCode });
      inserted.push(retryCode);
    }
  }

  await logAudit({
    actorId: session.userId,
    actorLabel: session.email,
    action: "invite.generate",
    targetType: "invite_code",
    metadata: { count: inserted.length, expiresInDays: expires_in_days, codes: inserted },
  });

  return NextResponse.json({ codes: inserted });
}
