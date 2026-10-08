// Types for the signal card / alert redesign.
//
// Rule that governs everything in this folder: a field is either a real value
// returned by a named provider, or `null` meaning UNKNOWN. Nothing is ever
// defaulted to 0, derived from another metric, or guessed. (Example of what
// NOT to do: circulating supply = market cap / price. DexScreener does not
// report circulating supply, so it stays unknown.)

export const INTEL_SCHEMA_VERSION = 1 as const;

export const INTERVALS = ["m5", "h1", "h6", "h24"] as const;
export type IntervalKey = (typeof INTERVALS)[number];
export const INTERVAL_LABELS: Record<IntervalKey, string> = {
  m5: "5m",
  h1: "1h",
  h6: "6h",
  h24: "24h",
};

export type TxnCounts = { buys: number; sells: number };

// A project link as listed by the data provider. "Listed" is NOT "verified":
// DexScreener token profiles are submitted by the project/community, and this
// app does not independently confirm that a link belongs to the project.
export type ProviderLink = {
  kind: "website" | "x" | "telegram" | "discord" | "other";
  label: string;
  url: string; // already sanitized to https only
};

export type TokenIntel = {
  v: typeof INTEL_SCHEMA_VERSION;
  source: "dexscreener";
  // When THIS APP fetched the data (not when the exchange last traded).
  fetchedAt: string;

  // identity
  chainId: string | null; // provider's chain id, e.g. "solana"
  dexId: string | null; // DEX / launchpad id as reported by the provider
  pairAddress: string | null;
  pairUrl: string | null;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null; // allow-listed host, https only
  // Pair (pool) creation time. This is the age of the trading pair, which can
  // be younger than the token itself.
  pairCreatedAt: string | null;

  // market
  priceUsd: number | null;
  priceChange: Record<IntervalKey, number | null>; // percent
  volumeUsd: Record<IntervalKey, number | null>;
  txns: Record<IntervalKey, TxnCounts | null>; // transaction COUNTS, not USD
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;

  // socials
  profile: {
    // false => the provider has no profile block for this token at all, so we
    // cannot tell "project has no links" from "provider doesn't know".
    present: boolean;
    links: ProviderLink[];
  };
};

// Compact, client-safe view of a stored safety report (the heavy
// `rawProviderResponses` debug column is deliberately never included).
export type SafetyCheckSummary = {
  id: string;
  label: string;
  status: "PASS" | "WARNING" | "FAIL" | "UNKNOWN";
  explanation: string;
  source: string;
  data?: Record<string, number | string | boolean | null>;
};

export type SafetySummary = {
  reportId: string;
  verdict: string;
  rugRiskScore: number;
  safetyScore: number;
  analyzedAt: string; // ISO
  dataSources: Record<string, string>;
  warnings: string[];
  checks: SafetyCheckSummary[];
};

export type SignalStatus = "ACTIVE" | "TP1_HIT" | "TP2_HIT" | "INVALIDATED" | "CLOSED";
