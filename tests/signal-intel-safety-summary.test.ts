import { describe, it, expect } from "vitest";
import { toSafetySummary } from "@/lib/signal-intel/safety-summary";

describe("toSafetySummary", () => {
  const row = {
    id: "r1",
    rugRiskScore: 40,
    safetyScore: 60,
    verdict: "CAUTION",
    checks: [
      { id: "holderCount", label: "Holder count", status: "PASS", explanation: "1,234 holders", scoreImpact: 0, source: "rugcheck.xyz", data: { holderCount: 1234 } },
      { id: "mintAuthority", label: "Mint authority", status: "UNKNOWN", explanation: "Safety data unavailable", scoreImpact: 0, source: "unavailable" },
    ],
    warnings: ["a warning", 42, null],
    dataSources: { rugcheck: "ok", dexscreener: "unavailable" },
    analyzedAt: new Date("2026-10-07T11:55:00.000Z"),
    // Present on the real DB row; must never reach the browser.
    rawProviderResponses: { rugcheck: "{...8KB of provider JSON...}" },
  };

  it("keeps display fields and structured data, drops raw provider responses and score impact", () => {
    const s = toSafetySummary(row as any);
    expect(s.verdict).toBe("CAUTION");
    expect(s.analyzedAt).toBe("2026-10-07T11:55:00.000Z");
    expect(s.checks[0].data).toEqual({ holderCount: 1234 });
    expect(s.checks[1].data).toBeUndefined();
    expect(s.warnings).toEqual(["a warning"]);
    expect(JSON.stringify(s)).not.toContain("rawProviderResponses");
    expect(JSON.stringify(s)).not.toContain("8KB");
    expect((s.checks[0] as any).scoreImpact).toBeUndefined();
  });

  it("tolerates malformed jsonb", () => {
    const s = toSafetySummary({ ...row, checks: "oops", warnings: null, dataSources: null, analyzedAt: "2026-10-07T11:55:00Z" } as any);
    expect(s.checks).toEqual([]);
    expect(s.warnings).toEqual([]);
    expect(s.dataSources).toEqual({});
  });
});
