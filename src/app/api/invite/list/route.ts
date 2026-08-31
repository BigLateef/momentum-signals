import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { inviteCodes, profiles } from "@/db/schema";
import { getSession } from "@/lib/session";
import { desc, eq, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = 25;
  const offset = (page - 1) * pageSize;

  const rows = await db
    .select({
      id: inviteCodes.id,
      code: inviteCodes.code,
      isUsed: inviteCodes.isUsed,
      revoked: inviteCodes.revoked,
      useCount: inviteCodes.useCount,
      maxUses: inviteCodes.maxUses,
      expiresAt: inviteCodes.expiresAt,
      createdAt: inviteCodes.createdAt,
      usedByEmail: profiles.email,
    })
    .from(inviteCodes)
    .leftJoin(profiles, eq(inviteCodes.usedBy, profiles.id))
    .orderBy(desc(inviteCodes.createdAt))
    .limit(pageSize)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inviteCodes);

  return NextResponse.json({ codes: rows, total: count, page, pageSize });
}
