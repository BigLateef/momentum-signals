import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getCachedReport } from "@/lib/safety/analyze";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const chain = new URL(req.url).searchParams.get("chain");
  if (!chain) {
    return NextResponse.json({ error: "chain query param is required" }, { status: 400 });
  }

  const report = await getCachedReport(chain, params.token);
  if (!report) {
    return NextResponse.json({ report: null, message: "No safety report on file for this token yet." });
  }

  return NextResponse.json({ report });
}
