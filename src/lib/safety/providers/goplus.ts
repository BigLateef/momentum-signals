// Thin client for GoPlus Security's Token Security API (EVM chains).
// No API key required for reasonable rate limits. Docs: https://docs.gopluslabs.io/reference/token-security-api
// Best-effort: any failure returns a null parsed result and the caller marks
// affected checks UNKNOWN.

const BASE_URL = "https://api.gopluslabs.io/api/v1/token_security";

// Maps this app's `chain` field to GoPlus's numeric chain IDs.
export const GOPLUS_CHAIN_IDS: Record<string, string> = {
  Ethereum: "1",
  BNB: "56",
  Polygon: "137",
  Arbitrum: "42161",
  Avalanche: "43114",
  Optimism: "10",
  Base: "8453",
};

export type GoPlusTokenSecurity = {
  is_mintable?: "0" | "1";
  is_proxy?: "0" | "1";
  is_open_source?: "0" | "1";
  transfer_pausable?: "0" | "1";
  is_blacklisted?: "0" | "1";
  is_whitelisted?: "0" | "1";
  is_honeypot?: "0" | "1";
  cannot_sell_all?: "0" | "1";
  can_take_back_ownership?: "0" | "1";
  owner_change_balance?: "0" | "1";
  buy_tax?: string;
  sell_tax?: string;
  holder_count?: string;
  holders?: { address: string; percent: string; is_locked?: number; tag?: string }[];
  lp_holder_count?: string;
  lp_holders?: {
    address: string;
    percent: string;
    is_locked?: number;
    tag?: string;
  }[];
  total_supply?: string;
  creator_address?: string;
  creator_percent?: string;
  creator_balance?: string;
  owner_address?: string;
  trading_cooldown?: "0" | "1";
  anti_whale_modifiable?: "0" | "1";
};

export type GoPlusResult = {
  parsed: GoPlusTokenSecurity | null;
  // Raw response body, capped to a reasonable length — same rationale as
  // rugcheck.ts: lets a real sample be pulled via the Safety Report UI's
  // "Copy report" button if this ever needs debugging the same way RugCheck
  // did, without needing terminal/curl access.
  raw: string | null;
};

const RAW_SAMPLE_MAX_CHARS = 4000;

export async function getGoPlusTokenSecurity(chain: string, tokenAddress: string): Promise<GoPlusResult> {
  const chainId = GOPLUS_CHAIN_IDS[chain];
  if (!chainId) return { parsed: null, raw: null };

  try {
    const res = await fetch(`${BASE_URL}/${chainId}?contract_addresses=${tokenAddress.toLowerCase()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { parsed: null, raw: null };

    const rawText = await res.text();
    const raw = rawText.length > RAW_SAMPLE_MAX_CHARS ? rawText.slice(0, RAW_SAMPLE_MAX_CHARS) + "…(truncated)" : rawText;

    let parsed: GoPlusTokenSecurity | null = null;
    try {
      const data = JSON.parse(rawText);
      if (data?.code === 1 && data?.result) {
        const entry = data.result[tokenAddress.toLowerCase()];
        parsed = entry ?? null;
      }
    } catch {
      parsed = null;
    }

    return { parsed, raw };
  } catch {
    return { parsed: null, raw: null };
  }
}
