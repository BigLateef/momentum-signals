import { db } from "@/db";
import { auditLog } from "@/db/schema";

export async function logAudit(params: {
  actorId?: string | null;
  actorLabel: string; // e.g. admin's email, or "system:scanner"
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await db.insert(auditLog).values({
      actorId: params.actorId ?? null,
      actorLabel: params.actorLabel,
      action: params.action,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    });
  } catch (err) {
    // Never let audit logging break the actual operation it's logging
    console.error("Audit log write failed:", err);
  }
}
