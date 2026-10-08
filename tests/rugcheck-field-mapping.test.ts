import { describe, it, expect } from "vitest";
import { runSafetyChecks } from "@/lib/safety/checks";
import type { RugCheckReport } from "@/lib/safety/providers/rugcheck";

// Regression suite for a real production bug: RugCheck.xyz's actual API
// response shape doesn't match what src/lib/safety/providers/rugcheck.ts
// originally assumed (mintAuthority/freezeAuthority were assumed nested
// under `.token`; real responses — per multiple independent third-party
// RugCheck API clients — expose them as top-level fields instead). The
// original code required `rugcheck?.token` to be truthy before emitting any
// PASS/FAIL verdict, which meant a genuinely successful RugCheck fetch
// (dataSources.rugcheck: "ok") still produced UNKNOWN for these checks
// 100% of the time, which — combined with several other checks that are
// always UNKNOWN by design — pushed nearly every Solana token's overall
// verdict to INSUFFICIENT_DATA (>=75% of checks UNKNOWN), silently blocking
// both auto-trading and (via the safety cycle stage) signal publication for
// four days straight before being caught.
//
// The fix reads both the top-level and nested locations, using whichever
// actually has a value — but does NOT assume "field absent from both"
// means "no authority" (a false PASS on an active mint/freeze authority
// would be actively dangerous for a system that feeds auto-trade
// decisions, worse than the original all-UNKNOWN bug). It also preserves
// the distinction between an explicit `null` (RugCheck confirming the
// authority was renounced — a real, usable signal) and `undefined` (the
// field simply isn't present — genuinely unknown), which a naive `??`
// merge would have collapsed and lost.
//
// Do not revert to requiring `rugcheck?.token` before emitting a verdict,
// and do not "simplify" the dual-location merge back to `??` — see
// Scenario 3c below for exactly why that's wrong.

function baseInput(overrides: Partial<Parameters<typeof runSafetyChecks>[0]> = {}) {
  return {
    chain: "Solana",
    tokenAddress: "ANJR7QNkxLWa6eHHFjVAwb1mi5GFkVQHroyG8xSopump",
    isSolana: true,
    pair: null,
    rugcheck: null,
    goplus: null,
    priorReportsForToken: [],
    priorReportsForDeployer: [],
    deployerAddress: null,
    ...overrides,
  };
}

function findCheck(checks: ReturnType<typeof runSafetyChecks>, id: string) {
  return checks.find((c) => c.id === id)!;
}

describe("RugCheck field-mapping fix — mintAuthority", () => {
  it("stays UNKNOWN (never fabricates PASS) when RugCheck succeeded but the field is absent everywhere — the exact real-world reported case", () => {
    const rugcheck: RugCheckReport = { mint: "ANJR7QNkxLWa6eHHFjVAwb1mi5GFkVQHroyG8xSopump" };
    const checks = runSafetyChecks(baseInput({ rugcheck }));
    expect(findCheck(checks, "mintAuthority").status).toBe("UNKNOWN");
  });

  it("detects an active authority from the top-level field", () => {
    const rugcheck: RugCheckReport = { mint: "x", mintAuthority: "SomeAuthorityAddress111" };
    const checks = runSafetyChecks(baseInput({ rugcheck }));
    expect(findCheck(checks, "mintAuthority").status).toBe("FAIL");
  });

  it("resolves an explicit top-level null to PASS, not UNKNOWN", () => {
    const rugcheck: RugCheckReport = { mint: "x", mintAuthority: null };
    const checks = runSafetyChecks(baseInput({ rugcheck }));
    expect(findCheck(checks, "mintAuthority").status).toBe("PASS");
  });

  it("falls back to the nested .token location when top-level is absent", () => {
    const rugcheck: RugCheckReport = { mint: "x", token: { mintAuthority: "SomeAuthorityAddress111" } };
    const checks = runSafetyChecks(baseInput({ rugcheck }));
    expect(findCheck(checks, "mintAuthority").status).toBe("FAIL");
  });

  it("top-level null takes precedence over a populated nested value — never silently overridden", () => {
    const rugcheck: RugCheckReport = {
      mint: "x",
      mintAuthority: null,
      token: { mintAuthority: "ShouldBeIgnoredBecauseTopLevelWinsWhenPresent" },
    };
    const checks = runSafetyChecks(baseInput({ rugcheck }));
    expect(findCheck(checks, "mintAuthority").status).toBe("PASS");
  });

  it("stays UNKNOWN when the RugCheck fetch itself failed (rugcheck is null)", () => {
    const checks = runSafetyChecks(baseInput({ rugcheck: null }));
    expect(findCheck(checks, "mintAuthority").status).toBe("UNKNOWN");
  });
});

describe("RugCheck field-mapping fix — freezeAuthority (same pattern)", () => {
  it("stays UNKNOWN when absent everywhere", () => {
    const rugcheck: RugCheckReport = { mint: "x" };
    const checks = runSafetyChecks(baseInput({ rugcheck }));
    expect(findCheck(checks, "freezeAuthority").status).toBe("UNKNOWN");
  });

  it("detects an active authority from the top-level field", () => {
    const rugcheck: RugCheckReport = { mint: "x", freezeAuthority: "SomeAuthorityAddress111" };
    const checks = runSafetyChecks(baseInput({ rugcheck }));
    expect(findCheck(checks, "freezeAuthority").status).toBe("FAIL");
  });

  it("resolves an explicit top-level null to PASS", () => {
    const rugcheck: RugCheckReport = { mint: "x", freezeAuthority: null };
    const checks = runSafetyChecks(baseInput({ rugcheck }));
    expect(findCheck(checks, "freezeAuthority").status).toBe("PASS");
  });
});
