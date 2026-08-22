import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

const KILL_SWITCH_KEY = "auto_trade_kill_switch";

// The kill switch exists ON TOP of AUTO_TRADE_ENABLED — it's a DB-backed
// toggle an admin can flip instantly from the panel without a redeploy,
// specifically for "stop everything right now" situations. Both must allow
// trading for a trade to execute.
export async function isKillSwitchEngaged(): Promise<boolean> {
  try {
    const [row] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, KILL_SWITCH_KEY))
      .limit(1);
    // Fail safe: if the row is missing or unreadable, treat the switch as
    // ENGAGED (blocking trades) rather than assuming it's off.
    if (!row) return true;
    return row.value === "true";
  } catch {
    return true;
  }
}

export async function setKillSwitch(engaged: boolean, adminId: string) {
  await db
    .insert(systemSettings)
    .values({ key: KILL_SWITCH_KEY, value: String(engaged), updatedBy: adminId })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: String(engaged), updatedBy: adminId, updatedAt: new Date() },
    });
}
