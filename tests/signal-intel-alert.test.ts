import { describe, it, expect } from "vitest";
import { buildAlertEmbed, escapeDiscord, type AlertSignal } from "@/lib/signal-intel/alert";
import { buildTokenIntel } from "@/lib/signal-intel/build";
import type { DexPair } from "@/lib/dexscreener";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const ADDR = "DoVAVzViX8Bjy3r15nwikSaSbzE6dV4ovd28aWpJpump";

const pair: DexPair = {
  chainId: "solana",
  dexId: "pumpswap",
  pairAddress: "PairAddr1111111111111111111111111111111111",
  baseToken: { address: ADDR, name: "Higgspad", symbol: "HIGGS" },
  priceUsd: "0.000009227",
  priceChange: { h1: 155, h24: 20 },
  volume: { h1: 35700, h24: 90000 },
  liquidity: { usd: 12_400 },
  txns: { h1: { buys: 290, sells: 186 } },
  url: "https://dexscreener.com/solana/pairaddr",
  pairCreatedAt: NOW.getTime() - 3 * 60_000,
  marketCap: 9200,
  info: {
    imageUrl: "https://cdn.dexscreener.com/cms/images/higgs.png",
    websites: [{ label: "Website", url: "https://higgs.example/" }],
    socials: [{ type: "twitter", url: "https://x.com/higgs" }],
  },
};

const signal: AlertSignal = {
  tokenName: "Higgspad",
  ticker: "HIGGS",
  chain: "Solana",
  exchange: "pumpswap",
  contractAddress: ADDR,
  signalType: "BUY",
  entryPrice: "0.000009227",
  targetPrice1: "0.0000106",
  targetPrice2: "0.0000120",
  stopLoss: "0.0000078",
  momentumScore: 8,
  confidence: "HIGH",
  reason: "Auto-detected: 155.0% (1h) move",
  chartUrl: "https://dexscreener.com/solana/pairaddr",
  createdAt: new Date(NOW.getTime() - 60_000),
};

const fieldText = (e: ReturnType<typeof buildAlertEmbed>) => e.fields.map((f) => `${f.name}\n${f.value}`).join("\n");

describe("buildAlertEmbed", () => {
  it("includes identity, market, levels, links and the contract in a copyable block", () => {
    const e = buildAlertEmbed(signal, buildTokenIntel(pair, NOW), { now: NOW });
    const text = fieldText(e);
    expect(e.title).toBe("BUY — Higgspad ($HIGGS)");
    expect(e.url).toBe("https://dexscreener.com/solana/pairaddr");
    expect(e.thumbnail?.url).toBe("https://cdn.dexscreener.com/cms/images/higgs.png");
    expect(text).toContain("pumpswap");
    expect(text).toContain("$0.0₅9227 (+155.0%)");
    expect(text).toContain("MC $9.2K");
    expect(text).toContain("Liq $12.4K");
    expect(text).toContain("B/S 290 / 186");
    expect(text).toContain("Entry");
    expect(text).toContain("```" + ADDR + "```");
    expect(text).toContain(`https://solscan.io/token/${ADDR}`);
    expect(text).toContain("https://x.com/higgs");
  });

  it("says safety is UNKNOWN at alert time and never claims it is safe", () => {
    const e = buildAlertEmbed(signal, buildTokenIntel(pair, NOW), { now: NOW });
    expect(e.fields[0].name).toContain("Safety: UNKNOWN");
    expect(e.fields[0].value).toContain("runs after this alert");
    const all = JSON.stringify(e);
    expect(all).not.toMatch(/\b(safe|secure|guaranteed)\b/i);
    expect(e.footer.text).toContain("Not financial advice");
    expect(e.footer.text).toContain("DexScreener data as of 2026-10-07 12:00 UTC");
  });

  it("marks listed links unverified and distinguishes unknown from none", () => {
    const listed = fieldText(buildAlertEmbed(signal, buildTokenIntel(pair, NOW), { now: NOW }));
    expect(listed).toContain("unverified");

    const noProfile = fieldText(buildAlertEmbed(signal, buildTokenIntel({ ...pair, info: undefined }, NOW), { now: NOW }));
    expect(noProfile).toContain("UNKNOWN — no provider profile");

    const emptyProfile = fieldText(
      buildAlertEmbed(signal, buildTokenIntel({ ...pair, info: { imageUrl: "https://cdn.dexscreener.com/x.png" } }, NOW), { now: NOW })
    );
    expect(emptyProfile).toContain("None listed");
  });

  it("shows — for missing metrics, never $0", () => {
    const sparse = buildTokenIntel(
      { chainId: "solana", dexId: "x", pairAddress: "p", baseToken: { address: ADDR, name: "S", symbol: "S" } },
      NOW
    );
    const text = fieldText(buildAlertEmbed({ ...signal, entryPrice: null, targetPrice1: null, targetPrice2: null, stopLoss: null }, sparse, { now: NOW }));
    expect(text).toContain("MC —");
    expect(text).toContain("Liq —");
    expect(text).toContain("B/S —");
    expect(text).not.toContain("$0");
    // No levels supplied → no empty Levels block.
    expect(text).not.toContain("Levels");
  });

  it("respects the interval it was asked for", () => {
    const e = buildAlertEmbed(signal, buildTokenIntel(pair, NOW), { now: NOW, period: "h24" });
    const text = fieldText(e);
    expect(text).toContain("Market (24h)");
    expect(text).toContain("(+20.0%)");
  });

  it("stays inside Discord's embed limits even with hostile input", () => {
    const long = "A".repeat(5000);
    const e = buildAlertEmbed(
      { ...signal, tokenName: long, reason: long },
      buildTokenIntel({ ...pair, baseToken: { ...pair.baseToken, name: long } }, NOW),
      { now: NOW }
    );
    expect(e.title.length).toBeLessThanOrEqual(256);
    expect((e.description ?? "").length).toBeLessThanOrEqual(700);
    expect(e.fields.length).toBeLessThanOrEqual(25);
    for (const f of e.fields) {
      expect(f.name.length).toBeLessThanOrEqual(256);
      expect(f.value.length).toBeLessThanOrEqual(1024);
    }
    const total =
      e.title.length + (e.description ?? "").length + e.footer.text.length + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    expect(total).toBeLessThan(6000);
  });

  it("neutralizes markdown links and mentions in token-controlled text", () => {
    const e = buildAlertEmbed(
      { ...signal, reason: "[claim airdrop](https://evil.example) @everyone" },
      buildTokenIntel(pair, NOW),
      { now: NOW }
    );
    expect(e.description).not.toContain("[claim airdrop](");
    expect(e.description).not.toContain("@everyone");
    expect(escapeDiscord("<@123> <#456> @here")).not.toMatch(/<@123>|<#456>|@here/);
  });
});
