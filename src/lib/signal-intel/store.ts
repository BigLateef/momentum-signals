// Persistence for signal card data. EVERYTHING here is best-effort and
// swallows errors: the scanner, price refresh, safety stage and trading
// engine must behave identically whether or not migration 005 has been
// applied or this code path throws.

import { db } from "@/db";
import { signalTokenIntel, tokenSafetyReports } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { parseTokenIntel } from "./build";
import { toSafetySummary } from "./safety-summary";
import type { SafetySummary, TokenIntel } from "./types";

export async function saveTokenIntel(signalId: string, intel: TokenIntel): Promise<void> {
  try {
    await db
      .insert(signalTokenIntel)
      .values({ signalId, snapshot: intel, source: intel.source, fetchedAt: new Date(intel.fetchedAt) })
      .onConflictDoUpdate({
        target: signalTokenIntel.signalId,
        set: { snapshot: intel, source: intel.source, fetchedAt: new Date(intel.fetchedAt), updatedAt: new Date() },
      });
  } catch (err) {
    // Most likely cause: migration 005 not applied yet. Never propagate.
    console.error("saveTokenIntel failed (non-fatal):", (err as Error)?.message ?? err);
  }
}

export async function loadTokenIntel(signalIds: string[]): Promise<Map<string, TokenIntel>> {
  const out = new Map<string, TokenIntel>();
  if (signalIds.length === 0) return out;
  try {
    const rows = await db.select().from(signalTokenIntel).where(inArray(signalTokenIntel.signalId, signalIds));
    for (const row of rows) {
      const parsed = parseTokenIntel(row.snapshot);
      if (parsed) out.set(row.signalId, parsed);
    }
  } catch (err) {
    console.error("loadTokenIntel failed (non-fatal):", (err as Error)?.message ?? err);
  }
  return out;
}

export async function loadSafetySummaries(reportIds: string[]): Promise<Map<string, SafetySummary>> {
  const out = new Map<string, SafetySummary>();
  const ids = Array.from(new Set(reportIds));
  if (ids.length === 0) return out;
  try {
    // Explicit column list: `raw_provider_responses` can be ~8KB per row and
    // has no business in a feed payload.
    const rows = await db
      .select({
        id: tokenSafetyReports.id,
        rugRiskScore: tokenSafetyReports.rugRiskScore,
        safetyScore: tokenSafetyReports.safetyScore,
        verdict: tokenSafetyReports.verdict,
        checks: tokenSafetyReports.checks,
        warnings: tokenSafetyReports.warnings,
        dataSources: tokenSafetyReports.dataSources,
        analyzedAt: tokenSafetyReports.analyzedAt,
      })
      .from(tokenSafetyReports)
      .where(inArray(tokenSafetyReports.id, ids));
    for (const row of rows) out.set(row.id, toSafetySummary(row));
  } catch (err) {
    console.error("loadSafetySummaries failed (non-fatal):", (err as Error)?.message ?? err);
  }
  return out;
}

