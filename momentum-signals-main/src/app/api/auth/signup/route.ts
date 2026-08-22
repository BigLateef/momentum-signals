import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, inviteCodes } from "@/db/schema";
import { createSession } from "@/lib/session";
import { authRateLimit, getClientIp } from "@/lib/ratelimit";
import { z } from "zod";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  code: z.string().length(6),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { success } = await authRateLimit.limit(ip);
  if (!success) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid signup details." }, { status: 400 });
  }
  const { email, password, code } = parsed.data;

  const [invite] = await db
    .select()
    .from(inviteCodes)
    .where(eq(inviteCodes.code, code.toUpperCase()))
    .limit(1);

  if (
    !invite ||
    invite.revoked ||
    (invite.expiresAt && new Date(invite.expiresAt) < new Date()) ||
    invite.useCount >= invite.maxUses
  ) {
    return NextResponse.json({ error: "Invite code is invalid or expired." }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.email, email.toLowerCase()))
    .limit(1);

  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [newProfile] = await db
    .insert(profiles)
    .values({
      email: email.toLowerCase(),
      passwordHash,
      invitedBy: invite.createdBy ?? undefined,
    })
    .returning();

  const newUseCount = invite.useCount + 1;
  await db
    .update(inviteCodes)
    .set({
      useCount: newUseCount,
      usedBy: newProfile.id,
      isUsed: newUseCount >= invite.maxUses,
    })
    .where(eq(inviteCodes.id, invite.id));

  await createSession({
    userId: newProfile.id,
    email: newProfile.email,
    role: newProfile.role as "user" | "admin",
    sessionVersion: newProfile.sessionVersion,
  });

  return NextResponse.json({ ok: true });
}
