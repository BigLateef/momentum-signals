// Checks whether any admin-tracked KOL wallet appears among a token's top
// holders. Uses each chain's block explorer API (Etherscan-family for EVM
// chains, Solscan for Solana) — all have a free tier, but each needs its own
// API key, and none of this is guaranteed by DexScreener or any single
// free source. If a chain's key isn't configured, that chain is skipped
// silently rather than failing the whole check.
//
// LIMITATIONS (be aware of these):
// - Free-tier explorer APIs are rate-limited (typically 5 req/s on Etherscan-
//   family free keys). This is fine for checking a handful of tokens per
//   scan, not for scanning hundreds of tokens quickly.
// - "Top holders" endpoints usually cap at the top 20-100 addresses. A KOL
//   holding a small amount outside that range won't be detected.
// - Solscan's free public endpoint has historically been the most likely of
//   these to change/require a key — if it stops working, this check will
//   just silently find nothing for Solana until SOLSCAN_API_KEY is set to
//   whatever their current auth scheme requires.

export type KolMatch = { label: string; address: string; percentOfSupply: number };

const EXPLORER_CONFIG: Record<
  string,
  { baseUrl: string; envKey: string } | null
> = {
  Ethereum: { baseUrl: "https://api.etherscan.io/api", envKey: "ETHERSCAN_API_KEY" },
  BNB: { baseUrl: "https://api.bscscan.com/api", envKey: "BSCSCAN_API_KEY" },
  Base: { baseUrl: "https://api.basescan.org/api", envKey: "BASESCAN_API_KEY" },
  Solana: null, // handled separately via Solscan below
};

async function getEvmTopHolders(
  chain: string,
  tokenAddress: string
): Promise<{ address: string; balance: string }[]> {
  const config = EXPLORER_CONFIG[chain];
  const apiKey = config ? process.env[config.envKey] : undefined;
  if (!config || !apiKey) return [];

  try {
    const url = `${config.baseUrl}?module=token&action=tokenholderlist&contractaddress=${tokenAddress}&page=1&offset=100&apikey=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.result)) return [];
    return data.result.map((r: any) => ({
      address: (r.TokenHolderAddress ?? "").toLowerCase(),
      balance: r.TokenHolderQuantity ?? "0",
    }));
  } catch {
    return [];
  }
}

async function getSolanaTopHolders(
  tokenAddress: string
): Promise<{ address: string; balance: string }[]> {
  const apiKey = process.env.SOLSCAN_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(
      `https://pro-api.solscan.io/v2.0/token/holders?address=${tokenAddress}&page=1&page_size=40`,
      {
        headers: { token: apiKey },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const items = data?.data?.items;
    if (!Array.isArray(items)) return [];
    return items.map((r: any) => ({
      address: (r.owner ?? "").toLowerCase(),
      balance: String(r.amount ?? "0"),
    }));
  } catch {
    return [];
  }
}

/**
 * Cross-references a token's top holders against the admin-tracked KOL
 * wallet list for that chain. Returns matches with an approximate % of
 * supply (only accurate if a totalSupply is provided — otherwise omitted).
 */
export async function checkKolHoldings(
  chain: string,
  tokenAddress: string,
  trackedWallets: { address: string; label: string }[]
): Promise<KolMatch[]> {
  const relevant = trackedWallets.filter(
    (w) => w.address // chain filtering happens by caller passing only same-chain wallets
  );
  if (relevant.length === 0) return [];

  const holders =
    chain === "Solana"
      ? await getSolanaTopHolders(tokenAddress)
      : await getEvmTopHolders(chain, tokenAddress);

  if (holders.length === 0) return [];

  const totalHeld = holders.reduce((sum, h) => sum + parseFloat(h.balance || "0"), 0);
  const matches: KolMatch[] = [];

  for (const wallet of relevant) {
    const holder = holders.find(
      (h) => h.address.toLowerCase() === wallet.address.toLowerCase()
    );
    if (holder) {
      const pct = totalHeld > 0 ? (parseFloat(holder.balance) / totalHeld) * 100 : 0;
      matches.push({ label: wallet.label, address: wallet.address, percentOfSupply: pct });
    }
  }

  return matches;
}

export function summarizeKolMatches(matches: KolMatch[]): string | null {
  if (matches.length === 0) return null;
  const totalPct = matches.reduce((sum, m) => sum + m.percentOfSupply, 0);
  const names = matches.map((m) => m.label).join(", ");
  return `${matches.length} tracked KOL${matches.length > 1 ? "s" : ""} (${names}) · ~${totalPct.toFixed(1)}% of top holders`;
}
