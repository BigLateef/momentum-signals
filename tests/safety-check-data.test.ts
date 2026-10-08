import { describe, it, expect } from "vitest";
import { runSafetyChecks } from "@/lib/safety/checks";
import type { RugCheckReport } from "@/lib/safety/providers/rugcheck";
import type { GoPlusTokenSecurity } from "@/lib/safety/providers/goplus";

// The structured `data` field added to safety checks is display-only. These
// tests pin that (a) it carries the real numbers the report already computed
// and (b) adding it did not change any status or score impact.

function input(over: Partial<Parameters<typeof runSafetyChecks>[0]> = {}) {
  return {
    chain: "Solana",
    tokenAddress: "Mint1111111111111111111111111111111111111",
    isSolana: true,
    pair: null,
    rugcheck: null,
    goplus: null,
    priorReportsForToken: [],
    priorReportsForDeployer: [],
    deployerAddress: null,
    ...over,
  };
}
const find = (checks: ReturnType<typeof runSafetyChecks>, id: string) => checks.find((c) => c.id === id)!;

describe("safety checks carry structured display data", () => {
  it("Solana / RugCheck", () => {
    const rugcheck: RugCheckReport = {
      mint: "m",
      mintAuthority: null,
      freezeAuthority: "FreezeAuth111",
      totalHolders: 127,
      topHolders: [
        { address: "a", pct: 15.3 },
        { address: "b", pct: 5.3 },
        { address: "c", pct: 4.2 },
        { address: "d", pct: 3.5 },
        { address: "e", pct: 3.4 },
      ],
    };
    const checks = runSafetyChecks(input({ rugcheck }));

    expect(find(checks, "mintAuthority").status).toBe("PASS");
    expect(find(checks, "mintAuthority").data).toEqual({ authorityActive: false });
    expect(find(checks, "freezeAuthority").status).toBe("FAIL");
    expect(find(checks, "freezeAuthority").data).toEqual({ authorityActive: true });
    expect(find(checks, "holderCount").data).toEqual({ holderCount: 127 });

    const top = find(checks, "topHolderConcentration").data!;
    expect(top.top1Pct).toBeCloseTo(15.3, 5);
    expect(top.top5Pct).toBeCloseTo(31.7, 5);
    expect(top.top10Pct).toBeCloseTo(31.7, 5);
  });

  it("EVM / GoPlus", () => {
    const goplus: GoPlusTokenSecurity = {
      is_mintable: "1",
      transfer_pausable: "0",
      cannot_sell_all: "0",
      holder_count: "5400",
      buy_tax: "0.05",
      sell_tax: "0.12",
      creator_percent: "0.034",
      lp_holders: [{ address: "lp", percent: "0.9", is_locked: 1 }],
      holders: [{ address: "a", percent: "0.30" }, { address: "b", percent: "0.10" }],
    };
    const checks = runSafetyChecks(input({ chain: "Base", isSolana: false, goplus }));

    expect(find(checks, "mintAuthority").data).toEqual({ authorityActive: true });
    expect(find(checks, "transferRestrictions").data).toEqual({ restricted: false });
    expect(find(checks, "holderCount").data).toEqual({ holderCount: 5400 });
    expect(find(checks, "abnormalVolumeSlippageImpact").data).toEqual({ buyTaxPct: 5, sellTaxPct: 12 });
    expect(find(checks, "creatorAllocation").data!.creatorPct).toBeCloseTo(3.4, 5);
    expect(find(checks, "lpLockStatus").data!.lockedPct).toBeCloseTo(90, 5);
    expect(find(checks, "topHolderConcentration").data!.top1Pct).toBeCloseTo(30, 5);
  });

  it("UNKNOWN checks never carry data", () => {
    const checks = runSafetyChecks(input());
    for (const c of checks.filter((x) => x.status === "UNKNOWN")) {
      expect(c.data).toBeUndefined();
    }
  });

  it("liquidity data comes from the DexScreener pair", () => {
    const checks = runSafetyChecks(
      input({
        pair: {
          chainId: "solana",
          dexId: "x",
          pairAddress: "p",
          baseToken: { address: "m", name: "n", symbol: "s" },
          liquidity: { usd: 2400 },
        },
      })
    );
    expect(find(checks, "liquiditySize").data).toEqual({ liquidityUsd: 2400 });
    expect(find(checks, "liquiditySize").status).toBe("FAIL");
  });
});
