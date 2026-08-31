// Thin client for RugCheck.xyz's public summary report API (Solana only).
// Docs: https://api.rugcheck.xyz/swagger
// Best-effort: any failure returns a null parsed result and the caller marks
// affected checks UNKNOWN.
//
// IMPORTANT — field-shape uncertainty: this type was originally written from
// general knowledge of what a "rug check" response would plausibly contain,
// never validated against a live response. In production, requests succeed
// (HTTP 200, valid JSON — dataSources.rugcheck comes back "ok") but almost
// every field this code reads comes back empty, meaning the real response
// shape doesn't match what's declared below. mintAuthority/freezeAuthority
// were corrected to also check top-level placement (multiple independent
// real RugCheck API clients show these as top-level string fields, not
// nested under a `.token` object) — everything else (topHolders' per-item
// shape, LP lock fields, holder count, creator balance) is still unverified
// and likely wrong. getRugCheckReport now also returns the raw response
// text alongside the parsed object specifically so a real sample can be
// captured via the app's own Safety Report UI ("Copy report") and used to
// fix the rest of this mapping definitively instead of guessing again.
const BASE_URL = "https://api.rugcheck.xyz/v1";

export type RugCheckReport = {
  mint: string;
  creator?: string;
  // Unverified nesting guess from the original implementation — kept as a
  // fallback read location alongside the top-level fields below.
  token?: {
    mintAuthority?: string | null;
    freezeAuthority?: string | null;
    supply?: number;
  };
  // Corrected: multiple real RugCheck API clients show these as top-level
  // fields on the response, not nested under `.token`.
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
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
  score_normalised?: number; // seen in real client field lists — 0-100, higher = riskier
  risks?: { name: string; description?: string; level?: string }[];
  creatorBalance?: number;
  createdAt?: string;
};

export type RugCheckResult = {
  parsed: RugCheckReport | null;
  // Raw response body, capped to a reasonable length — captured so a real
  // sample can be pulled via the Safety Report UI's "Copy report" button
  // for fixing the field mapping above without needing terminal/curl
  // access. Not meant to be a permanent record of every response, just a
  // rolling "most recent raw sample" for whichever token was last analyzed.
  raw: string | null;
};

const RAW_SAMPLE_MAX_CHARS = 4000;

export async function getRugCheckReport(mint: string): Promise<RugCheckResult> {
  try {
    const res = await fetch(`${BASE_URL}/tokens/${mint}/report/summary`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { parsed: null, raw: null };

    const rawText = await res.text();
    const raw = rawText.length > RAW_SAMPLE_MAX_CHARS ? rawText.slice(0, RAW_SAMPLE_MAX_CHARS) + "…(truncated)" : rawText;

    let parsed: RugCheckReport | null = null;
    try {
      const data = JSON.parse(rawText);
      if (data && typeof data === "object") parsed = data as RugCheckReport;
    } catch {
      parsed = null;
    }

    return { parsed, raw };
  } catch {
    return { parsed: null, raw: null };
  }
}
