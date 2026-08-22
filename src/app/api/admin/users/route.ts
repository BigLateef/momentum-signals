import { NextResponse } from "next/server";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getSession } from "@/lib/session";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .select({
      id: profiles.id,
      email: profiles.email,
      role: profiles.role,
      createdAt: profiles.createdAt,
      lastLogin: profiles.lastLogin,
      sessionVersion: profiles.sessionVersion,
    })
    .from(profiles)
    .orderBy(desc(profiles.createdAt));

  return NextResponse.json({ users: rows });
}
