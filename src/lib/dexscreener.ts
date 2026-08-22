// Thin client for DexScreener's public API.
// Docs: https://docs.dexscreener.com/api/reference
// No API key required. Rate limit: ~300 req/min per DexScreener's docs — the
// scan/update-price cron jobs stay well under that at typical intervals.

const BASE_URL = "https://api.dexscreener.com";

export type DexPair = {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  volume?: { h24?: number; h6?: number; h1?: number };
  liquidity?: { usd?: number };
  txns?: {
    h1?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  url?: string;
  pairCreatedAt?: number; // unix ms — used for token-age safety check
};

export type BoostedToken = {
  chainId: string;
  tokenAddress: string;
};

// Maps DexScreener's chainId to this app's `chain` field.
export const CHAIN_MAP: Record<string, string> = {
  solana: "Solana",
  base: "Base",
  bsc: "BNB",
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
  polygon: "Polygon",
  avalanche: "Avalanche",
  optimism: "Optimism",
};

export async function getLatestBoostedTokens(): Promise<BoostedToken[]> {
  const res = await fetch(`${BASE_URL}/token-boosts/latest/v1`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data
    .filter((t: any) => CHAIN_MAP[t.chainId])
    .map((t: any) => ({ chainId: t.chainId, tokenAddress: t.tokenAddress }));
}

export async function getPairsForToken(
  chainId: string,
  tokenAddress: string
): Promise<DexPair[]> {
  const res = await fetch(`${BASE_URL}/tokens/v1/${chainId}/${tokenAddress}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Picks the highest-liquidity pair for a token — the most representative
// price/volume snapshot when a token trades across multiple pools.
export function bestPair(pairs: DexPair[]): DexPair | null {
  if (pairs.length === 0) return null;
  return pairs.reduce((best, p) =>
    (p.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? p : best
  );
}
