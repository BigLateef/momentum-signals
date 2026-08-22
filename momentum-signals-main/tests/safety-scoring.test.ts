import { describe, it, expect } from "vitest";
import { scoreChecks, deriveVerdict, verdictAllowsAutoAction } from "@/lib/safety/score";
import type { SafetyCheckResult } from "@/lib/safety/types";

function check(overrides: Partial<SafetyCheckResult>): SafetyCheckResult {
  return {
    id: "mintAuthority",
    label: "Mint authority",
    status: "PASS",
    explanation: "",
    scoreImpact: 0,
    source: "test",
    ...overrides,
  };
}

describe("scoreChecks", () => {
  it("returns a perfect score when every check passes", () => {
    const checks = [check({}), check({ id: "freezeAuthority" })];
    const { safetyScore, rugRiskScore, warnings } = scoreChecks(checks);
    expect(safetyScore).toBe(100);
    expect(rugRiskScore).toBe(0);
    expect(warnings).toHaveLength(0);
  });

  it("subtracts score impact for each failing/warning check and floors at 0", () => {
    const checks = [
      check({ status: "FAIL", scoreImpact: 60 }),
      check({ id: "freezeAuthority", status: "FAIL", scoreImpact: 60 }),
    ];
    const { safetyScore, rugRiskScore } = scoreChecks(checks);
    expect(safetyScore).toBe(0);
    expect(rugRiskScore).toBe(100);
  });

  it("never fabricates a warning for an UNKNOWN check", () => {
    const checks = [check({ status: "UNKNOWN", scoreImpact: 0 })];
    const { warnings } = scoreChecks(checks);
    expect(warnings).toHaveLength(0);
  });
});

describe("deriveVerdict", () => {
  it("returns INSUFFICIENT_DATA when most checks are unknown", () => {
    const checks = Array.from({ length: 10 }, (_, i) =>
      check({ id: `c${i}` as any, status: "UNKNOWN" })
    );
    expect(deriveVerdict(checks, 100)).toBe("INSUFFICIENT_DATA");
  });

  it("returns BLOCKED on a critical fail (failed sell / honeypot signature)", () => {
    const checks = [check({ id: "failedSellTransactions", status: "FAIL", scoreImpact: 25 })];
    expect(deriveVerdict(checks, 75)).toBe("BLOCKED");
  });

  it("returns CRITICAL when mint + freeze are both active with weak liquidity", () => {
    const checks = [
      check({ id: "mintAuthority", status: "FAIL" }),
      check({ id: "freezeAuthority", status: "FAIL" }),
      check({ id: "liquiditySize", status: "WARNING" }),
    ];
    expect(deriveVerdict(checks, 60)).toBe("CRITICAL");
  });

  it("scales LOW_RISK -> CAUTION -> HIGH_RISK -> VERY_HIGH_RISK with safety score", () => {
    expect(deriveVerdict([check({})], 90)).toBe("LOW_RISK");
    expect(deriveVerdict([check({})], 60)).toBe("CAUTION");
    expect(deriveVerdict([check({})], 40)).toBe("HIGH_RISK");
    expect(deriveVerdict([check({})], 20)).toBe("VERY_HIGH_RISK");
  });
});

describe("verdictAllowsAutoAction", () => {
  it("blocks BLOCKED, CRITICAL, and INSUFFICIENT_DATA regardless of override", () => {
    for (const v of ["BLOCKED", "CRITICAL", "INSUFFICIENT_DATA"] as const) {
      expect(verdictAllowsAutoAction(v, true).allowed).toBe(false);
      expect(verdictAllowsAutoAction(v, false).allowed).toBe(false);
    }
  });

  it("requires override for VERY_HIGH_RISK but allows it once overridden", () => {
    expect(verdictAllowsAutoAction("VERY_HIGH_RISK", false).allowed).toBe(false);
    expect(verdictAllowsAutoAction("VERY_HIGH_RISK", true).allowed).toBe(true);
  });

  it("allows LOW_RISK and CAUTION without any override", () => {
    expect(verdictAllowsAutoAction("LOW_RISK", false).allowed).toBe(true);
    expect(verdictAllowsAutoAction("CAUTION", false).allowed).toBe(true);
  });
});
