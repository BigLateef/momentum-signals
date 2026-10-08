import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { isKillSwitchEngaged, setKillSwitch } from "@/lib/trading/kill-switch";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ engaged: await isKillSwitchEngaged() });
}

const schema = z.object({ engaged: z.boolean() });

// Emergency kill switch — an admin can stop all automated trading instantly
// from the panel, without a redeploy. This is checked by the executor in
// addition to (not instead of) AUTO_TRADE_ENABLED, so either one blocks trading.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  await setKillSwitch(parsed.data.engaged, session.userId);

  await logAudit({
    actorId: session.userId,
    actorLabel: session.email,
    action: parsed.data.engaged ? "trading.kill_switch_engaged" : "trading.kill_switch_disengaged",
  });

  return NextResponse.json({ engaged: parsed.data.engaged });
}
