// Thin client for RugCheck.xyz's public summary report API (Solana only).
// No API key required for the summary endpoint. Docs: https://api.rugcheck.xyz/swagger
// Best-effort: any failure returns null and the caller marks affected checks UNKNOWN.

const BASE_URL = "https://api.rugcheck.xyz/v1";

export type RugCheckReport = {
  mint: string;
  creator?: string;
  token?: {
    mintAuthority?: string | null;
    freezeAuthority?: string | null;
    supply?: number;
  };
  totalHolders?: number;
  topHolders?: { address: string; pct: number }[];
  markets?: {
    lp?: {
      lpLockedPct?: number;
      lpLocked?: number;
      lpTotalSupply?: number;
    };
  }[];
  score?: number; // RugCheck's own 0-100+ risk score (higher = riskier)
  risks?: { name: string; description?: string; level?: string }[];
  creatorBalance?: number;
  createdAt?: string;
};

export async function getRugCheckReport(mint: string): Promise<RugCheckReport | null> {
  try {
    const res = await fetch(`${BASE_URL}/tokens/${mint}/report/summary`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== "object") return null;
    return data as RugCheckReport;
  } catch {
    return null;
  }
}
