import type { SafetyVerdict } from "@/db/schema";
import type { SafetyCheckResult } from "./types";

// Checks whose FAIL status is severe enough to hard-block regardless of the
// aggregate numeric score — these are the "this is almost certainly a scam"
// signals, not just risk factors to weigh.
const CRITICAL_FAIL_IDS = new Set(["failedSellTransactions"]);

export function scoreChecks(checks: SafetyCheckResult[]): {
  safetyScore: number;
  rugRiskScore: number;
  warnings: string[];
} {
  const totalImpact = checks.reduce((sum, c) => sum + c.scoreImpact, 0);
  const safetyScore = Math.max(0, Math.min(100, 100 - totalImpact));
  const rugRiskScore = 100 - safetyScore;

  const warnings = checks
    .filter((c) => c.status === "FAIL" || c.status === "WARNING")
    .sort((a, b) => b.scoreImpact - a.scoreImpact)
    .map((c) => `${c.label}: ${c.explanation}`);

  return { safetyScore, rugRiskScore, warnings };
}

export function deriveVerdict(checks: SafetyCheckResult[], safetyScore: number): SafetyVerdict {
  const unknownCount = checks.filter((c) => c.status === "UNKNOWN").length;
  const failCount = checks.filter((c) => c.status === "FAIL").length;
  const hasCriticalFail = checks.some((c) => c.status === "FAIL" && CRITICAL_FAIL_IDS.has(c.id));

  // Too little real data to say anything responsible — never fabricate a
  // confident verdict on top of mostly-unknown checks.
  if (unknownCount >= checks.length * 0.75) return "INSUFFICIENT_DATA";

  // A confirmed honeypot-style failed-sell signature is disqualifying on its own.
  if (hasCriticalFail) return "BLOCKED";

  // Mint + freeze/pause both active plus thin liquidity is about as close to
  // a guaranteed rug as this data can show.
  const mint = checks.find((c) => c.id === "mintAuthority");
  const freeze = checks.find((c) => c.id === "freezeAuthority");
  const liquidity = checks.find((c) => c.id === "liquiditySize");
  if (mint?.status === "FAIL" && freeze?.status === "FAIL" && liquidity?.status !== "PASS") {
    return "CRITICAL";
  }

  if (safetyScore < 25 || failCount >= 4) return "VERY_HIGH_RISK";
  if (safetyScore < 45 || failCount >= 2) return "HIGH_RISK";
  if (safetyScore < 65) return "CAUTION";
  return "LOW_RISK";
}

// Verdicts that block automatic publication and automatic trading outright,
// regardless of any other config — matches the spec's hard rule.
export const BLOCKING_VERDICTS: SafetyVerdict[] = ["BLOCKED", "CRITICAL", "INSUFFICIENT_DATA"];

// Verdicts that require an explicit admin override before they can proceed.
export const REQUIRES_OVERRIDE_VERDICTS: SafetyVerdict[] = ["VERY_HIGH_RISK"];

export function verdictAllowsAutoAction(
  verdict: SafetyVerdict,
  hasOverride: boolean
): { allowed: boolean; reason?: string } {
  if (BLOCKING_VERDICTS.includes(verdict)) {
    return { allowed: false, reason: `Safety verdict ${verdict} blocks automatic publication/trading.` };
  }
  if (REQUIRES_OVERRIDE_VERDICTS.includes(verdict) && !hasOverride) {
    return { allowed: false, reason: `Safety verdict ${verdict} requires explicit admin override.` };
  }
  return { allowed: true };
}
