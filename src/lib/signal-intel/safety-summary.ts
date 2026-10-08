// Pure mapping from a stored token_safety_reports row to the compact summary
// sent to the browser. Kept free of DB imports so it is unit-testable.

import type { SafetySummary } from "./types";

export type ReportRow = {
  id: string;
  rugRiskScore: number;
  safetyScore: number;
  verdict: string;
  checks: unknown;
  warnings: unknown;
  dataSources: unknown;
  analyzedAt: Date | string;
};

/** Never includes raw provider responses (the debug column). */
export function toSafetySummary(row: ReportRow): SafetySummary {
  const checks = Array.isArray(row.checks) ? (row.checks as any[]) : [];
  return {
    reportId: row.id,
    verdict: row.verdict,
    rugRiskScore: row.rugRiskScore,
    safetyScore: row.safetyScore,
    analyzedAt: (row.analyzedAt instanceof Date ? row.analyzedAt : new Date(row.analyzedAt)).toISOString(),
    dataSources:
      row.dataSources && typeof row.dataSources === "object" ? (row.dataSources as Record<string, string>) : {},
    warnings: Array.isArray(row.warnings) ? (row.warnings as unknown[]).filter((w): w is string => typeof w === "string") : [],
    checks: checks.map((c) => ({
      id: String(c.id),
      label: String(c.label),
      status: c.status,
      explanation: String(c.explanation ?? ""),
      source: String(c.source ?? "unavailable"),
      ...(c.data && typeof c.data === "object" ? { data: c.data } : {}),
    })),
  };
}
