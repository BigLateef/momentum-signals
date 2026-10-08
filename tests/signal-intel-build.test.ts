import { describe, it, expect } from "vitest";
import { buildTokenIntel, parseTokenIntel } from "@/lib/signal-intel/build";
import type { DexPair } from "@/lib/dexscreener";

const NOW = new Date("2026-10-07T12:00:00.000Z");

// Shaped after DexScreener's documented /tokens/v1/{chain}/{address} pair
// object. Re-verify against a real response if DexScreener changes it.
function fullPair(overrides: Partial<DexPair> = {}): DexPair {
  return {
    chainId: "solana",
    dexId: "pumpswap",
    pairAddress: "PairAddr1111111111111111111111111111111111",
    baseToken: { address: "Mint1111111111111111111111111111111111111", name: "Higgspad", symbol: "HIGGS" },
    priceUsd: "0.000009227",
    priceChange: { m5: 12.5, h1: 155, h6: 300.2, h24: -10 },
    volume: { m5: 1200, h1: 35700, h6: 40000, h24: 90000 },
    liquidity: { usd: 2400 },
    txns: {
      m5: { buys: 10, sells: 4 },
      h1: { buys: 290, sells: 186 },
      h6: { buys: 900, sells: 700 },
      h24: { buys: 2000, sells: 1900 },
    },
    url: "https://dexscreener.com/solana/pairaddr",
    pairCreatedAt: NOW.getTime() - 3 * 60_000,
    marketCap: 9200,
    fdv: 9200,
    info: {
      imageUrl: "https://cdn.dexscreener.com/cms/images/higgs.png",
      websites: [{ label: "Website", url: "https://higgs.example/" }],
      socials: [{ type: "twitter", url: "https://x.com/higgs" }],
    },
    ...overrides,
  };
}

describe("buildTokenIntel — complete provider response", () => {
  it("maps every field from the provider and nothing else", () => {
    const i = buildTokenIntel(fullPair(), NOW);
    expect(i.v).toBe(1);
    expect(i.source).toBe("dexscreener");
    expect(i.fetchedAt).toBe(NOW.toISOString());
    expect(i.dexId).toBe("pumpswap");
    expect(i.name).toBe("Higgspad");
    expect(i.symbol).toBe("HIGGS");
    expect(i.priceUsd).toBe(0.000009227);
    expect(i.priceChange.h1).toBe(155);
    expect(i.priceChange.h24).toBe(-10);
    expect(i.volumeUsd.h1).toBe(35700);
    expect(i.txns.h1).toEqual({ buys: 290, sells: 186 });
    expect(i.liquidityUsd).toBe(2400);
    expect(i.marketCapUsd).toBe(9200);
    expect(i.fdvUsd).toBe(9200);
    expect(i.imageUrl).toBe("https://cdn.dexscreener.com/cms/images/higgs.png");
    expect(i.pairCreatedAt).toBe(new Date(NOW.getTime() - 3 * 60_000).toISOString());
    expect(i.profile.present).toBe(true);
    expect(i.profile.links.map((l) => l.kind)).toEqual(["website", "x"]);
  });
});

describe("buildTokenIntel — unavailable data stays unknown", () => {
  it("returns null (never 0) for everything the provider omitted", () => {
    const sparse: DexPair = {
      chainId: "base",
      dexId: "uniswap",
      pairAddress: "0xpair",
      baseToken: { address: "0xtoken", name: "Sparse", symbol: "SP" },
    };
    const i = buildTokenIntel(sparse, NOW);
    expect(i.priceUsd).toBeNull();
    expect(i.marketCapUsd).toBeNull();
    expect(i.fdvUsd).toBeNull();
    expect(i.liquidityUsd).toBeNull();
    expect(i.imageUrl).toBeNull();
    expect(i.pairCreatedAt).toBeNull();
    expect(i.priceChange.h1).toBeNull();
    expect(i.volumeUsd.h24).toBeNull();
    expect(i.txns.h1).toBeNull();
    // No info block at all: "provider has no profile", NOT "project has no links".
    expect(i.profile.present).toBe(false);
    expect(i.profile.links).toEqual([]);
  });

  it("keeps a genuine zero as zero", () => {
    const i = buildTokenIntel(fullPair({ liquidity: { usd: 0 }, marketCap: 0 }), NOW);
    expect(i.liquidityUsd).toBe(0);
    expect(i.marketCapUsd).toBe(0);
  });

  it("treats a half-reported buys/sells pair as unknown", () => {
    const i = buildTokenIntel(fullPair({ txns: { h1: { buys: 120 } as any } }), NOW);
    expect(i.txns.h1).toBeNull();
  });

  it("distinguishes a profile with no links from no profile", () => {
    const i = buildTokenIntel(fullPair({ info: { imageUrl: "https://cdn.dexscreener.com/a.png" } }), NOW);
    expect(i.profile.present).toBe(true);
    expect(i.profile.links).toEqual([]);
  });

  it("rejects non-finite and non-numeric values", () => {
    const i = buildTokenIntel(
      fullPair({ priceUsd: "not-a-number", priceChange: { h1: NaN as any, h6: "5" as any }, marketCap: Infinity as any }),
      NOW
    );
    expect(i.priceUsd).toBeNull();
    expect(i.priceChange.h1).toBeNull();
    expect(i.priceChange.h6).toBe(5);
    expect(i.marketCapUsd).toBeNull();
  });
});

describe("buildTokenIntel — untrusted provider content", () => {
  it("drops non-https and script links, bad images, and strips control characters", () => {
    const i = buildTokenIntel(
      fullPair({
        baseToken: { address: "x", name: "Evil\u0000Name\u001f", symbol: "EV" },
        info: {
          imageUrl: "https://evil.example/pixel.png",
          websites: [
            { label: "Site", url: "javascript:alert(1)" },
            { label: "Plain", url: "http://insecure.example" },
            { label: "Good", url: "https://good.example/" },
          ],
          socials: [{ type: "twitter", url: "data:text/html,boom" }],
        },
      }),
      NOW
    );
    expect(i.name).toBe("EvilName");
    expect(i.imageUrl).toBeNull();
    expect(i.profile.present).toBe(true);
    expect(i.profile.links).toHaveLength(1);
    expect(i.profile.links[0].url).toBe("https://good.example/");
  });

  it("dedupes and caps links", () => {
    const websites = Array.from({ length: 20 }, (_, n) => ({ label: `L${n}`, url: `https://s${n}.example/` }));
    websites.push({ label: "dup", url: "https://s0.example/" });
    const i = buildTokenIntel(fullPair({ info: { websites } }), NOW);
    expect(i.profile.links).toHaveLength(8);
  });

  it("classifies socials without trusting the provider's labels", () => {
    const i = buildTokenIntel(
      fullPair({
        info: {
          socials: [
            { type: "twitter", url: "https://x.com/a" },
            { type: "telegram", url: "https://t.me/a" },
            { type: "tiktok", url: "https://tiktok.com/@a" },
          ],
        },
      }),
      NOW
    );
    expect(i.profile.links.map((l) => l.kind)).toEqual(["x", "telegram", "other"]);
  });
});

describe("parseTokenIntel", () => {
  it("round-trips a snapshot through JSON", () => {
    const i = buildTokenIntel(fullPair(), NOW);
    expect(parseTokenIntel(JSON.parse(JSON.stringify(i)))).toEqual(i);
  });

  it("rejects other versions and garbage instead of crashing the feed", () => {
    const i = buildTokenIntel(fullPair(), NOW);
    expect(parseTokenIntel({ ...i, v: 2 })).toBeNull();
    expect(parseTokenIntel({ ...i, fetchedAt: "nope" })).toBeNull();
    expect(parseTokenIntel(null)).toBeNull();
    expect(parseTokenIntel("x")).toBeNull();
    expect(parseTokenIntel({})).toBeNull();
  });
});
