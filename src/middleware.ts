import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";

const SESSION_COOKIE = "ms_session";

function isNeonDriver(databaseUrl: string) {
  const override = process.env.DB_DRIVER?.toLowerCase();
  if (override === "neon") return true;
  if (override === "postgres") return false;
  return databaseUrl.includes(".neon.tech");
}

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

    let sessionValid: boolean;
    const databaseUrl = process.env.DATABASE_URL;

    if (databaseUrl && isNeonDriver(databaseUrl)) {
      // The Neon serverless driver uses fetch and is Edge-compatible.
      const sql = neon(databaseUrl);
      const rows = await sql(
        "SELECT session_version FROM profiles WHERE id = $1 LIMIT 1",
        [userId]
      );
      const currentVersion = rows[0]?.session_version;
      sessionValid = currentVersion !== undefined && currentVersion === sessionVersion;
    } else {
      // Standard Postgres drivers require Node.js TCP APIs, so delegate the
      // database check to the Node.js session-check route.
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
