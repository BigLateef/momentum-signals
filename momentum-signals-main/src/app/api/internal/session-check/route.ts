import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { db } from "@/db";
import { sql } from "drizzle-orm";

// Node.js-runtime helper for src/middleware.ts's session-revocation check,
// used ONLY on the "postgres" driver path (Supabase or any other standard
// Postgres). middleware.ts runs on Next.js's Edge runtime, which only
// supports fetch-based I/O — postgres.js needs a real TCP socket, which
// Edge can't open. Neon's HTTP driver has no such restriction, so the Neon
// path in middleware.ts queries directly, unchanged, and never reaches this
// route at all.
//
// Authorization is the caller's own already-verified session JWT (re-verified
// here with the same SESSION_SECRET) rather than a separate shared secret —
// this endpoint can't be used to look up an arbitrary user's session state
// without a valid, correctly-signed token for that exact session.
export const dynamic = "force-dynamic";

function getSecret() {
  return new TextEncoder().encode(process.env.SESSION_SECRET);
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ valid: false, error: "Missing token" }, { status: 401 });
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, getSecret()));
  } catch {
    return NextResponse.json({ valid: false, error: "Invalid token" }, { status: 401 });
  }

  const userId = payload.userId as string;
  const sessionVersion = payload.sessionVersion as number;

  const result = await db.execute(
    sql`SELECT session_version FROM profiles WHERE id = ${userId} LIMIT 1`
  );
  const rows = (result as any).rows ?? result;
  const currentVersion = rows?.[0]?.session_version;

  const valid = currentVersion !== undefined && currentVersion === sessionVersion;
  return NextResponse.json({ valid, role: payload.role ?? null });
}
