import { describe, it, expect } from "vitest";
import {
  formatAgeMs,
  formatBuysSells,
  formatCompact,
  formatCount,
  formatPercent,
  formatPercentChange,
  formatPriceUsd,
  formatUsdCompact,
  formatUtc,
  parseDecimal,
} from "@/lib/signal-intel/format";
import { explorerUrl, safeHttpsUrl, safeImageUrl, shortenAddress } from "@/lib/signal-intel/links";

describe("formatPriceUsd", () => {
  it("uses zero-count notation for tiny prices", () => {
    expect(formatPriceUsd(0.000009227)).toBe("$0.0₅9227");
    expect(formatPriceUsd(0.00000009227)).toBe("$0.0₇9227");
    expect(formatPriceUsd(0.00004723)).toBe("$0.0₄4723");
  });

  it("formats ordinary prices", () => {
    expect(formatPriceUsd(0.0123)).toBe("$0.0123");
    expect(formatPriceUsd(1.2345)).toBe("$1.23");
    expect(formatPriceUsd(2500)).toBe("$2,500");
  });

  it("never turns missing/invalid input into a number", () => {
    expect(formatPriceUsd(null)).toBe("—");
    expect(formatPriceUsd(undefined)).toBe("—");
    expect(formatPriceUsd(NaN)).toBe("—");
    expect(formatPriceUsd(Infinity)).toBe("—");
    expect(formatPriceUsd(-1)).toBe("—");
  });
});

describe("formatUsdCompact / formatCompact", () => {
  it("compacts thousands, millions, billions", () => {
    expect(formatUsdCompact(9200)).toBe("$9.2K");
    expect(formatUsdCompact(35700)).toBe("$35.7K");
    expect(formatUsdCompact(1_500_000)).toBe("$1.5M");
    expect(formatUsdCompact(2_000_000_000)).toBe("$2B");
  });

  it("rolls 999.95K over to 1M instead of printing 1000K", () => {
    expect(formatCompact(999_950)).toBe("1M");
  });

  it("keeps a real zero as zero but missing as unknown", () => {
    expect(formatUsdCompact(0)).toBe("$0");
    expect(formatUsdCompact(null)).toBe("—");
    expect(formatUsdCompact(undefined)).toBe("—");
    expect(formatUsdCompact(NaN)).toBe("—");
  });
});

describe("formatPercentChange / formatPercent", () => {
  it("signs changes", () => {
    expect(formatPercentChange(155)).toBe("+155.0%");
    expect(formatPercentChange(-12.34)).toBe("-12.3%");
    expect(formatPercentChange(0)).toBe("0.0%");
    expect(formatPercentChange(4025)).toBe("+4,025%");
  });

  it("returns unknown for missing", () => {
    expect(formatPercentChange(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
    expect(formatPercent(43)).toBe("43.0%");
  });
});

describe("formatAgeMs", () => {
  it("formats seconds, minutes, hours, days", () => {
    expect(formatAgeMs(45_000)).toBe("45s");
    expect(formatAgeMs(3 * 60_000)).toBe("3m");
    expect(formatAgeMs(125 * 60_000)).toBe("2h 5m");
    expect(formatAgeMs(26 * 3_600_000)).toBe("1d 2h");
    expect(formatAgeMs(800 * 86_400_000)).toBe("2y");
  });

  it("tolerates small clock skew but not a far-future timestamp", () => {
    expect(formatAgeMs(-5_000)).toBe("0s");
    expect(formatAgeMs(-3_600_000)).toBe("—");
    expect(formatAgeMs(null)).toBe("—");
  });
});

describe("misc formatters", () => {
  it("formats buys/sells only when both sides exist", () => {
    expect(formatBuysSells({ buys: 290, sells: 186 })).toBe("290 / 186");
    expect(formatBuysSells(null)).toBe("—");
    expect(formatBuysSells(undefined)).toBe("—");
  });

  it("formats UTC deterministically", () => {
    expect(formatUtc("2026-10-07T13:27:45.000Z")).toBe("2026-10-07 13:27 UTC");
    expect(formatUtc("garbage")).toBe("—");
    expect(formatUtc(null)).toBe("—");
  });

  it("parses DB numeric strings", () => {
    expect(parseDecimal("0.000123")).toBe(0.000123);
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal(null)).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(null)).toBe("—");
  });
});

describe("links", () => {
  it("accepts only plain https URLs", () => {
    expect(safeHttpsUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("http://example.com")).toBeNull();
    expect(safeHttpsUrl("data:text/html,hi")).toBeNull();
    expect(safeHttpsUrl("https://user:pw@example.com")).toBeNull();
    expect(safeHttpsUrl("https://exa mple.com")).toBeNull();
    expect(safeHttpsUrl("https://localhost/")).toBeNull();
    expect(safeHttpsUrl(42)).toBeNull();
    expect(safeHttpsUrl("https://example.com/" + "a".repeat(400))).toBeNull();
  });

  it("only allows token images from DexScreener's own hosts", () => {
    expect(safeImageUrl("https://cdn.dexscreener.com/cms/images/abc")).toBe("https://cdn.dexscreener.com/cms/images/abc");
    expect(safeImageUrl("https://evil.example/pixel.png")).toBeNull();
    expect(safeImageUrl("https://dexscreener.com.evil.example/x.png")).toBeNull();
    expect(safeImageUrl("http://cdn.dexscreener.com/x.png")).toBeNull();
  });

  it("builds explorer links only for plausible addresses on known chains", () => {
    const sol = "DoVAVzViX8Bjy3r15nwikSaSbzE6dV4ovd28aWpJpump";
    expect(explorerUrl("Solana", sol)).toBe(`https://solscan.io/token/${sol}`);
    expect(explorerUrl("Base", "0x4200000000000000000000000000000000000006")).toContain("basescan.org/token/0x42");
    expect(explorerUrl("Solana", "../../etc/passwd")).toBeNull();
    expect(explorerUrl("Dogechain", sol)).toBeNull();
    expect(explorerUrl("Solana", null)).toBeNull();
  });

  it("shortens addresses", () => {
    expect(shortenAddress("DoVAVzViX8Bjy3r15nwikSaSbzE6dV4ovd28aWpJpump")).toBe("DoVAVz…pump");
    expect(shortenAddress(null)).toBe("—");
  });
});
