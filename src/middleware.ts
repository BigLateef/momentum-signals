import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";
import { detectDriver } from "@/db/driver-detect";

const SESSION_COOKIE = "ms_session";

function getSecret() {
  return new TextEncoder().encode(process.env.SESSION_SECRET);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected =
    pathname.startsWith("/auth/dashboard") || pathname.startsWith("/admin");

  if (!isProtected) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  try {
    const { payload } = await jwtVerify(token, getSecret());
    const userId = payload.userId as string;
    const sessionVersion = payload.sessionVersion as number;

    // Check the session hasn't been force-revoked by an admin. Middleware
    // runs on the Edge runtime, which only supports fetch-based I/O.
    let sessionValid: boolean;

    if (detectDriver(process.env.DATABASE_URL!) === "neon") {
      // Neon's serverless driver works over plain HTTP fetch, so this is
      // safe to run directly in Edge middleware — unchanged from before.
      const sql = neon(process.env.DATABASE_URL!);
      const rows = await sql("SELECT session_version FROM profiles WHERE id = $1 LIMIT 1", [
        userId,
      ]);
      const currentVersion = rows[0]?.session_version;
      sessionValid = currentVersion !== undefined && currentVersion === sessionVersion;
    } else {
      // Supabase / any other standard Postgres: the app's DB layer uses
      // postgres.js for this driver, which needs a real TCP socket that
      // Edge can't open. Delegate the check to a Node.js-runtime API route
      // instead — see src/app/api/internal/session-check/route.ts.
      const checkRes = await fetch(new URL("/api/internal/session-check", req.url), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      sessionValid = checkRes.ok && (await checkRes.json()).valid === true;
    }

    if (!sessionValid) {
      return NextResponse.redirect(new URL("/", req.url));
    }

    if (pathname.startsWith("/admin") && payload.role !== "admin") {
      return NextResponse.redirect(new URL("/auth/dashboard", req.url));
    }

    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/", req.url));
  }
}

export const config = {
  matcher: ["/auth/dashboard/:path*", "/admin/:path*"],
};
