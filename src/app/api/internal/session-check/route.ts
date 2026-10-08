import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { withTimeout } from "@/lib/with-timeout";

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

// Client-side timeout — the actual bound on how long this route waits for
// the DB, since postgres.js's server-side statement_timeout isn't set
// (see src/db/index.ts for why: real risk of Supabase's PgBouncer-family
// pooler rejecting it as an unsupported startup parameter, which would
// fail every connection outright). This can't force Postgres to cancel a
// stuck query server-side the way statement_timeout would, but it does
// guarantee src/middleware.ts's caller never waits longer than this to get
// a response — found necessary in production after repeated, intermittent
// 25s middleware timeouts traced to this exact call hanging. See
// src/lib/with-timeout.ts for the implementation and its tests.

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

  let rows: any;
  try {
    const result = await withTimeout(
      db.execute(sql`SELECT session_version FROM profiles WHERE id = ${userId} LIMIT 1`),
      9000,
      "session-check DB query"
    );
    rows = (result as any).rows ?? result;
  } catch (err) {
    // Fail closed: a DB error or timeout here means we genuinely don't know
    // whether the session is still valid, and this endpoint exists
    // specifically to gate access to /admin and /auth/dashboard — treating
    // "unknown" as "invalid" (redirect to login) is the safer default for
    // an auth check, even though it costs the user an extra login on a
    // transient DB hiccup.
    console.error("session-check DB query failed or timed out:", err);
    return NextResponse.json({ valid: false, error: "Session check temporarily unavailable" }, { status: 503 });
  }

  const currentVersion = rows?.[0]?.session_version;
  const valid = currentVersion !== undefined && currentVersion === sessionVersion;
  return NextResponse.json({ valid, role: payload.role ?? null });
}

