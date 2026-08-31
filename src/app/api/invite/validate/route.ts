import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { inviteCodes } from "@/db/schema";
import { authRateLimit, getClientIp } from "@/lib/ratelimit";
import { z } from "zod";

const schema = z.object({ code: z.string().min(6).max(6) });

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { success } = await authRateLimit.limit(ip);
  if (!success) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ valid: false, error: "Enter a 6-character code." }, { status: 400 });
  }

  const code = parsed.data.code.toUpperCase();
  const [invite] = await db
    .select()
    .from(inviteCodes)
    .where(eq(inviteCodes.code, code))
    .limit(1);

  if (
    !invite ||
    invite.revoked ||
    (invite.expiresAt && new Date(invite.expiresAt) < new Date()) ||
    invite.useCount >= invite.maxUses
  ) {
    return NextResponse.json({ valid: false, error: "Invalid or expired invite code." }, { status: 400 });
  }

  return NextResponse.json({ valid: true });
}
