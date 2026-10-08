import { describe, it, expect } from "vitest";
import {
  buildSignalCardModel,
  deriveStatus,
  MARKET_STALE_AFTER_MS,
  type SignalLike,
} from "@/lib/signal-intel/view-model";
import { buildTokenIntel } from "@/lib/signal-intel/build";
import type { SafetyCheckSummary, SafetySummary, TokenIntel } from "@/lib/signal-intel/types";
import type { DexPair } from "@/lib/dexscreener";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const ADDR = "DoVAVzViX8Bjy3r15nwikSaSbzE6dV4ovd28aWpJpump";

function signal(over: Partial<SignalLike> = {}): SignalLike {
  return {
    id: "sig-1",
    tokenName: "Higgspad",
    ticker: "HIGGS",
    chain: "Solana",
    exchange: "pumpswap",
    contractAddress: ADDR,
    signalType: "BUY",
    entryPrice: "0.000009",
    currentPrice: "0.000009227",
    targetPrice1: "0.0000103",
    targetPrice2: "0.0000117",
    stopLoss: "0.0000077",
    momentumScore: 8,
    confidence: "MEDIUM",
    chartUrl: "https://dexscreener.com/solana/pairaddr",
    createdAt: new Date(NOW.getTime() - 3 * 60_000).toISOString(),
    isActive: true,
    ...over,
  };
}

function pair(over: Partial<DexPair> = {}): DexPair {
  return {
    chainId: "solana",
    dexId: "pumpswap",
    pairAddress: "PairAddr1111111111111111111111111111111111",
    baseToken: { address: ADDR, name: "Higgspad", symbol: "HIGGS" },
    priceUsd: "0.000009227",
    priceChange: { m5: 1, h1: 155, h6: 300, h24: 20 },
    volume: { m5: 1, h1: 35700, h6: 40000, h24: 90000 },
    liquidity: { usd: 12_400 },
    txns: { h1: { buys: 290, sells: 186 }, h6: { buys: 900, sells: 700 } },
    url: "https://dexscreener.com/solana/pairaddr",
    pairCreatedAt: NOW.getTime() - 3 * 60_000,
    marketCap: 9200,
    fdv: 9200,
    ...over,
  };
}

function intel(over: Partial<DexPair> = {}, at: Date = new Date(NOW.getTime() - 40_000)): TokenIntel {
  return buildTokenIntel(pair(over), at);
}

function check(id: string, status: SafetyCheckSummary["status"], extra: Partial<SafetyCheckSummary> = {}): SafetyCheckSummary {
  return {
    id,
    label: id,
    status,
    explanation: `${id} explanation`,
    source: status === "UNKNOWN" ? "unavailable" : "rugcheck.xyz",
    ...extra,
  };
}

function safety(over: Partial<SafetySummary> = {}): SafetySummary {
  return {
    reportId: "r1",
    verdict: "LOW_RISK",
    rugRiskScore: 12,
    safetyScore: 88,
    analyzedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
    dataSources: { dexscreener: "ok", rugcheck: "ok" },
    warnings: [],
    checks: [
      check("holderCount", "PASS", { data: { holderCount: 1234 } }),
      check("topHolderConcentration", "WARNING", { data: { top1Pct: 9.5, top5Pct: 27, top10Pct: 43 } }),
      check("mintAuthority", "PASS", { data: { authorityActive: false } }),
      check("freezeAuthority", "PASS", { data: { authorityActive: false } }),
      check("lpLockStatus", "PASS", { data: { lockedPct: 100 } }),
      check("creatorAllocation", "PASS", { data: { creatorPct: 3.4 } }),
      check("liquiditySize", "PASS", { data: { liquidityUsd: 12400 } }),
    ],
    ...over,
  };
}

const build = (over: Partial<Parameters<typeof buildSignalCardModel>[0]> = {}) =>
  buildSignalCardModel({ signal: signal(), intel: intel(), safety: safety(), now: NOW, period: "h1", ...over });

const rowOf = (rows: { key: string }[], key: string) => rows.find((r) => r.key === key) as any;
const allRows = (m: ReturnType<typeof build>) => [
  ...m.keyStats,
  ...m.sections.identity,
  ...m.sections.market,
  ...m.sections.signal,
  ...m.sections.safety.groups.flatMap((g) => g.rows),
];

describe("card model — complete data", () => {
  it("shows real provider values with their source", () => {
    const m = build();
    expect(m.price.value).toBe("$0.0₅9227");
    expect(m.price.changeValue).toBe("+155.0%");
    expect(m.price.periodLabel).toBe("1h");
    expect(rowOf(m.keyStats, "mc").value).toBe("$9.2K");
    expect(rowOf(m.keyStats, "vol").value).toBe("$35.7K");
    expect(rowOf(m.keyStats, "bs").value).toBe("290 / 186");
    expect(rowOf(m.sections.market, "mc").source).toBe("DexScreener");
    expect(m.freshness.market.state).toBe("fresh");
    expect(m.freshness.market.text).toContain("DexScreener");
    expect(m.freshness.market.text).toContain("40s");
    expect(m.signalAge).toBe("3m");
    expect(m.pairAge).toBe("3m");
  });

  it("switches every period-dependent stat with the selected interval", () => {
    const m = build({ period: "h6" });
    expect(m.price.changeValue).toBe("+300.0%");
    expect(rowOf(m.keyStats, "vol").label).toBe("Vol 6h");
    expect(rowOf(m.keyStats, "vol").value).toBe("$40K");
    expect(rowOf(m.keyStats, "bs").value).toBe("900 / 700");
  });

  it("populates safety rows from structured check data", () => {
    const m = build();
    const rows = m.sections.safety.groups.flatMap((g) => g.rows);
    expect(rowOf(rows, "holderCount").value).toBe("1,234");
    expect(rowOf(rows, "top10").value).toBe("43.0%");
    expect(rowOf(rows, "top5").value).toBe("27.0%");
    expect(rowOf(rows, "top1").value).toBe("9.5%");
    expect(rowOf(rows, "mintAuthority").value).toBe("Not active");
    expect(rowOf(rows, "lpLockStatus").value).toBe("100.0% locked or burned");
    expect(rowOf(rows, "creatorAllocation").value).toBe("3.4% of supply");
    expect(rowOf(rows, "mintAuthority").source).toBe("rugcheck.xyz");
  });

  it("builds chart and explorer links", () => {
    const m = build();
    expect(m.links.chart).toBe("https://dexscreener.com/solana/pairaddr");
    expect(m.links.explorer).toEqual({ name: "Solscan", url: `https://solscan.io/token/${ADDR}` });
    expect(rowOf(m.sections.identity, "contract").copy).toBe(ADDR);
  });
});

describe("card model — unavailable data", () => {
  it("renders UNKNOWN (never $0) when there is no market snapshot", () => {
    const m = build({ intel: null, safety: null });
    for (const r of m.keyStats) {
      expect(r.tone).toBe("unknown");
      expect(r.value).toBe("UNKNOWN");
    }
    expect(m.freshness.market.state).toBe("missing");
    expect(m.price.changeValue).toBe("—");
    // Falls back to the stored last price, and says where it came from.
    const price = rowOf(m.sections.market, "price");
    expect(price.value).toBe("$0.0₅9227");
    expect(price.source).toContain("price-refresh");
    for (const r of allRows(m)) expect(r.value).not.toBe("$0");
  });

  it("never fabricates supply or ATH, whatever data exists", () => {
    const m = build();
    const supply = rowOf(m.sections.market, "supply");
    const ath = rowOf(m.sections.market, "ath");
    expect(supply.tone).toBe("unknown");
    expect(supply.value).toBe("UNKNOWN");
    expect(ath.tone).toBe("unknown");
    expect(ath.value).toBe("UNKNOWN");
  });

  it("never reports bundler/sniper counts without a provider", () => {
    const m = build();
    const rows = m.sections.safety.groups.flatMap((g) => g.rows);
    expect(rowOf(rows, "bundlers").value).toBe("UNKNOWN");
    expect(rowOf(rows, "snipers").value).toBe("UNKNOWN");
    expect(rowOf(rows, "bundlers").note).toContain("No connected provider");
  });

  it("treats a check with no data as UNKNOWN and keeps the provider's reason", () => {
    const m = build({
      safety: safety({
        checks: [check("mintAuthority", "UNKNOWN", { explanation: "Safety data unavailable — RugCheck report unavailable for this mint" })],
      }),
    });
    const row = rowOf(m.sections.safety.groups.flatMap((g) => g.rows), "mintAuthority");
    expect(row.tone).toBe("unknown");
    expect(row.value).toBe("UNKNOWN");
    expect(row.note).toContain("RugCheck report unavailable");
  });

  it("falls back gracefully for reports stored before checks carried structured data", () => {
    const m = build({ safety: safety({ checks: [check("holderCount", "PASS", { explanation: "1,234 holders reported." })] }) });
    const row = rowOf(m.sections.safety.groups.flatMap((g) => g.rows), "holderCount");
    expect(row.value).toBe("1,234 holders reported.");
  });

  it("flags a signal with no safety report as UNKNOWN, prominently", () => {
    const m = build({ safety: null });
    const b = m.banners.find((x) => x.key === "safety-pending")!;
    expect(b.level).toBe("warn");
    expect(b.title).toContain("UNKNOWN");
    expect(m.sections.safety.verdict).toBeNull();
    expect(m.freshness.safety.state).toBe("missing");
  });

  it("warns when most checks returned nothing", () => {
    const checks = [
      check("holderCount", "UNKNOWN"),
      check("mintAuthority", "UNKNOWN"),
      check("freezeAuthority", "UNKNOWN"),
      check("liquiditySize", "PASS", { data: { liquidityUsd: 9000 } }),
    ];
    const m = build({ safety: safety({ checks }) });
    expect(m.banners.some((b) => b.key === "mostly-unknown")).toBe(true);
  });
});

describe("card model — socials", () => {
  const social = (m: ReturnType<typeof build>, kind: string) => m.sections.socials.rows.find((r) => r.kind === kind)!;

  it("is UNKNOWN (not 'none') when the provider has no profile for the token", () => {
    const m = build({ intel: intel({ info: undefined }) });
    expect(social(m, "x").status).toBe("unknown");
    expect(social(m, "website").status).toBe("unknown");
  });

  it("is UNKNOWN when there is no snapshot at all", () => {
    expect(social(build({ intel: null }), "x").status).toBe("unknown");
  });

  it("distinguishes 'none listed' from 'listed but unverified'", () => {
    const m = build({
      intel: intel({ info: { websites: [{ label: "Website", url: "https://higgs.example/" }] } }),
    });
    expect(social(m, "website").status).toBe("listed");
    expect(social(m, "website").links[0].url).toBe("https://higgs.example/");
    expect(social(m, "x").status).toBe("not_listed");
    expect(m.sections.socials.note).toContain("does not verify");
  });
});

describe("card model — risk warnings", () => {
  it("makes failed checks and severe verdicts prominent and sorts danger first", () => {
    const m = build({
      signal: signal({ safetyVerdict: "VERY_HIGH_RISK" }),
      safety: safety({
        verdict: "VERY_HIGH_RISK",
        checks: [
          check("mintAuthority", "FAIL", { label: "Mint authority", explanation: "Mint authority is still active", data: { authorityActive: true } }),
          check("liquiditySize", "WARNING", { data: { liquidityUsd: 4000 } }),
        ],
      }),
    });
    expect(m.banners[0].level).toBe("danger");
    expect(m.banners.some((b) => b.title.includes("VERY HIGH RISK"))).toBe(true);
    const fail = m.banners.find((b) => b.key === "fail-mintAuthority")!;
    expect(fail.detail).toContain("still active");
    const levels = m.banners.map((b) => b.level);
    expect(levels.indexOf("warn") === -1 || levels.lastIndexOf("danger") < levels.indexOf("warn")).toBe(true);
    expect(rowOf(m.sections.safety.groups.flatMap((g) => g.rows), "mintAuthority").value).toBe("ACTIVE");
  });

  it("caps individual failure banners at three", () => {
    const fails = ["a", "b", "c", "d", "e"].map((id) => check(id, "FAIL"));
    const m = build({ safety: safety({ checks: fails, verdict: "CRITICAL" }) });
    expect(m.banners.filter((b) => b.key.startsWith("fail-") && b.key !== "fail-more")).toHaveLength(3);
    expect(m.banners.find((b) => b.key === "fail-more")!.title).toContain("+2 more");
  });

  it("surfaces an admin override and an invalidation", () => {
    const m = build({
      signal: signal({ safetyVerdict: "CRITICAL", safetyOverride: true, invalidatedAt: NOW.toISOString(), invalidationReason: "Liquidity collapsed below $1,000" }),
      safety: safety({ verdict: "CRITICAL" }),
    });
    expect(m.sections.safety.override).toBe(true);
    const inv = m.banners.find((b) => b.key === "invalidated")!;
    expect(inv.level).toBe("danger");
    expect(inv.detail).toContain("Liquidity collapsed");
  });

  it("flags stale market data on an active signal, but not a closed one", () => {
    const old = new Date(NOW.getTime() - MARKET_STALE_AFTER_MS - 60_000);
    const active = build({ intel: intel({}, old) });
    expect(active.freshness.market.state).toBe("stale");
    expect(active.banners.some((b) => b.key === "stale-market")).toBe(true);

    const closed = build({ signal: signal({ isActive: false }), intel: intel({}, old) });
    expect(closed.freshness.market.state).toBe("frozen");
    expect(closed.freshness.market.text).toContain("no longer refreshed");
    expect(closed.banners.some((b) => b.key === "stale-market")).toBe(false);
  });

  it("flags stale safety data", () => {
    const m = build({ safety: safety({ analyzedAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString() }) });
    expect(m.freshness.safety.state).toBe("stale");
    expect(m.banners.some((b) => b.key === "stale-safety")).toBe(true);
  });
});

describe("card model — wording never implies safety or performance", () => {
  it("does not call anything safe/guaranteed, even for a LOW_RISK verdict", () => {
    const m = build({ signal: signal({ safetyVerdict: "LOW_RISK" }) });
    const text = JSON.stringify(m);
    expect(text).not.toMatch(/\b(safe|secure|guaranteed|risk-free|no risk)\b/i);
    expect(m.sections.safety.verdictText).toBe("LOWER RISK");
    expect(m.sections.safety.caveat).toContain("not a safety guarantee");
    expect(m.disclaimer).toContain("not financial advice");
    expect(m.disclaimer).toContain("guarantee");
  });

  it("describes confidence as a tier, not a probability", () => {
    const row = rowOf(build().sections.signal, "confidence");
    expect(row.note).toContain("not a probability");
  });

  it("labels pair age as pair age", () => {
    expect(rowOf(build().sections.identity, "pair-age").note).toContain("token itself may be older");
  });
});

describe("card model — signal status and identity", () => {
  it("derives status from existing lifecycle fields", () => {
    expect(deriveStatus(signal())).toBe("ACTIVE");
    expect(deriveStatus(signal({ tp1HitAt: NOW.toISOString() }))).toBe("TP1_HIT");
    expect(deriveStatus(signal({ tp1HitAt: NOW.toISOString(), tp2HitAt: NOW.toISOString(), isActive: false }))).toBe("TP2_HIT");
    expect(deriveStatus(signal({ isActive: false }))).toBe("CLOSED");
    expect(deriveStatus(signal({ invalidatedAt: NOW.toISOString(), isActive: false }))).toBe("INVALIDATED");
  });

  it("only links http(s) chart URLs", () => {
    const m = build({ intel: null, signal: signal({ chartUrl: "javascript:alert(1)" }) });
    expect(m.links.chart).toBeNull();
    const ok = build({ intel: null, signal: signal({ chartUrl: "https://dexscreener.com/solana/x" }) });
    expect(ok.links.chart).toBe("https://dexscreener.com/solana/x");
  });

  it("handles a signal with no contract address", () => {
    const m = build({ signal: signal({ contractAddress: null }) });
    expect(m.address).toBeNull();
    expect(m.links.explorer).toBeNull();
    expect(rowOf(m.sections.identity, "contract").tone).toBe("unknown");
  });

  it("reports entry/targets/stop only when supplied", () => {
    const none = build({ signal: signal({ entryPrice: null, targetPrice1: null, targetPrice2: null, stopLoss: null }) });
    expect(none.hasAnyLevel).toBe(false);
    expect(build().hasAnyLevel).toBe(true);
    expect(rowOf(build().levels, "tp1").value).toBe("$0.0₄103");
  });
});
