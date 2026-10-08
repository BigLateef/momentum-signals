import type { DexPair } from "@/lib/dexscreener";
import {
  INTERVALS,
  INTEL_SCHEMA_VERSION,
  type IntervalKey,
  type ProviderLink,
  type TokenIntel,
  type TxnCounts,
} from "./types";
import { safeHttpsUrl, safeImageUrl } from "./links";

const MAX_LINKS = 8;
const MAX_LABEL = 40;

function finite(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function nonNegative(v: unknown): number | null {
  const n = finite(v);
  return n != null && n >= 0 ? n : null;
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return t ? t.slice(0, max) : null;
}

function txnCounts(v: unknown): TxnCounts | null {
  if (!v || typeof v !== "object") return null;
  const buys = nonNegative((v as any).buys);
  const sells = nonNegative((v as any).sells);
  // Both must be present; a half-reported pair is treated as unknown rather
  // than showing "120 buys / 0 sells" for a missing sells field.
  return buys != null && sells != null ? { buys, sells } : null;
}

function perInterval<T>(source: unknown, read: (v: unknown) => T | null): Record<IntervalKey, T | null> {
  const out = {} as Record<IntervalKey, T | null>;
  for (const k of INTERVALS) {
    out[k] = source && typeof source === "object" ? read((source as any)[k]) : null;
  }
  return out;
}

const SOCIAL_KIND: Record<string, ProviderLink["kind"]> = {
  twitter: "x",
  x: "x",
  telegram: "telegram",
  discord: "discord",
};

function buildLinks(info: NonNullable<DexPair["info"]>): ProviderLink[] {
  const links: ProviderLink[] = [];
  const seen = new Set<string>();
  const push = (link: ProviderLink | null) => {
    if (!link || seen.has(link.url) || links.length >= MAX_LINKS) return;
    seen.add(link.url);
    links.push(link);
  };

  for (const w of Array.isArray(info.websites) ? info.websites : []) {
    const url = safeHttpsUrl(w?.url);
    if (url) push({ kind: "website", label: cleanText(w?.label, MAX_LABEL) ?? "Website", url });
  }
  for (const s of Array.isArray(info.socials) ? info.socials : []) {
    const url = safeHttpsUrl(s?.url);
    if (!url) continue;
    const type = cleanText(s?.type, MAX_LABEL)?.toLowerCase() ?? "";
    const kind = SOCIAL_KIND[type] ?? "other";
    const label = kind === "x" ? "X" : kind === "other" ? (type ? type : "Link") : type.charAt(0).toUpperCase() + type.slice(1);
    push({ kind, label, url });
  }
  return links;
}

/**
 * Builds the persisted snapshot from a DexScreener pair. Pure. Every field is
 * the provider's own value or null.
 */
export function buildTokenIntel(pair: DexPair, now: Date = new Date()): TokenIntel {
  const info = pair.info && typeof pair.info === "object" ? pair.info : null;
  const created = finite(pair.pairCreatedAt);

  return {
    v: INTEL_SCHEMA_VERSION,
    source: "dexscreener",
    fetchedAt: now.toISOString(),

    chainId: cleanText(pair.chainId, 40),
    dexId: cleanText(pair.dexId, 60),
    pairAddress: cleanText(pair.pairAddress, 100),
    pairUrl: safeHttpsUrl(pair.url),
    name: cleanText(pair.baseToken?.name, 100),
    symbol: cleanText(pair.baseToken?.symbol, 40),
    imageUrl: info ? safeImageUrl(info.imageUrl) : null,
    pairCreatedAt: created != null && created > 0 ? new Date(created).toISOString() : null,

    priceUsd: nonNegative(pair.priceUsd),
    priceChange: perInterval(pair.priceChange, finite),
    volumeUsd: perInterval(pair.volume, nonNegative),
    txns: perInterval(pair.txns, txnCounts),
    liquidityUsd: nonNegative(pair.liquidity?.usd),
    marketCapUsd: nonNegative(pair.marketCap),
    fdvUsd: nonNegative(pair.fdv),

    profile: { present: info != null, links: info ? buildLinks(info) : [] },
  };
}

/**
 * Validates JSON read back from the database. Returns null (→ "market data
 * unavailable") for anything that isn't a current-version snapshot, so a future
 * schema change can never crash the feed.
 */
export function parseTokenIntel(raw: unknown): TokenIntel | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<TokenIntel>;
  if (r.v !== INTEL_SCHEMA_VERSION || r.source !== "dexscreener") return null;
  if (typeof r.fetchedAt !== "string" || Number.isNaN(Date.parse(r.fetchedAt))) return null;
  if (!r.priceChange || !r.volumeUsd || !r.txns || !r.profile) return null;
  if (!Array.isArray(r.profile.links)) return null;
  return r as TokenIntel;
}
