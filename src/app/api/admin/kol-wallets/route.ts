import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { kolWallets } from "@/db/schema";
import { getSession } from "@/lib/session";
import { desc, eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db.select().from(kolWallets).orderBy(desc(kolWallets.createdAt));
  return NextResponse.json({ wallets: rows });
}

const schema = z.object({
  chain: z.string().min(1),
  address: z.string().min(10),
  label: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid wallet details." }, { status: 400 });
  }

  const [inserted] = await db
    .insert(kolWallets)
    .values({
      chain: parsed.data.chain,
      address: parsed.data.address,
      label: parsed.data.label,
      addedBy: session.userId,
    })
    .returning();

  await logAudit({
    actorId: session.userId,
    actorLabel: session.email,
    action: "kol_wallet.add",
    targetType: "kol_wallet",
    targetId: inserted.id,
    metadata: { chain: inserted.chain, label: inserted.label },
  });

  return NextResponse.json({ wallet: inserted });
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  await db.delete(kolWallets).where(eq(kolWallets.id, parsed.data.id));

  await logAudit({
    actorId: session.userId,
    actorLabel: session.email,
    action: "kol_wallet.remove",
    targetType: "kol_wallet",
    targetId: parsed.data.id,
  });

  return NextResponse.json({ ok: true });
}
