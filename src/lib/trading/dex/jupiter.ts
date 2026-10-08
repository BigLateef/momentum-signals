// Solana execution via Jupiter's public swap API (https://station.jup.ag/docs/apis/swap-api).
// No API key required. Used for both BUY (base currency -> token) and
// SELL (token -> base currency) legs.

import { VersionedTransaction } from "@solana/web3.js";
import { getSolanaConnection, _internalGetSolanaKeypair } from "../wallet";

const QUOTE_URL = "https://quote-api.jup.ag/v6/quote";
const SWAP_URL = "https://quote-api.jup.ag/v6/swap";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type JupiterQuote = {
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  raw: any;
};

export async function getJupiterQuote(params: {
  inputMint: string;
  outputMint: string;
  amountLamports: number;
  slippageBps: number;
}): Promise<JupiterQuote | null> {
  try {
    const url = new URL(QUOTE_URL);
    url.searchParams.set("inputMint", params.inputMint);
    url.searchParams.set("outputMint", params.outputMint);
    url.searchParams.set("amount", String(Math.floor(params.amountLamports)));
    url.searchParams.set("slippageBps", String(params.slippageBps));
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.outAmount) return null;
    return {
      inAmount: data.inAmount,
      outAmount: data.outAmount,
      priceImpactPct: data.priceImpactPct ?? "0",
      raw: data,
    };
  } catch {
    return null;
  }
}

export type SwapResult =
  | { success: true; transactionId: string; amountOut: string }
  | { success: false; error: string };

// Signs and broadcasts the swap. Only called when AUTO_TRADE_DRY_RUN=false —
// callers are responsible for never invoking this in dry-run mode.
export async function executeJupiterSwap(quote: JupiterQuote): Promise<SwapResult> {
  const keypair = _internalGetSolanaKeypair();
  if (!keypair) return { success: false, error: "Burner wallet is not configured for Solana." };

  try {
    const swapRes = await fetch(SWAP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote.raw,
        userPublicKey: keypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!swapRes.ok) {
      return { success: false, error: `Jupiter swap build failed: HTTP ${swapRes.status}` };
    }
    const { swapTransaction } = await swapRes.json();
    if (!swapTransaction) return { success: false, error: "Jupiter did not return a transaction." };

    const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
    tx.sign([keypair]);

    const connection = getSolanaConnection();
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 2,
    });

    return { success: true, transactionId: signature, amountOut: quote.outAmount };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown Jupiter execution error" };
  }
}

// Never blindly retried by the caller — confirmation status must be checked
// explicitly (see confirmSolanaTransaction) before a trade is reported as filled.
export async function confirmSolanaTransaction(
  signature: string,
  timeoutMs = 30000
): Promise<"CONFIRMED" | "FAILED" | "UNKNOWN"> {
  try {
    const connection = getSolanaConnection();
    const result = await connection.confirmTransaction(
      { signature } as any,
      "confirmed"
    );
    if (result.value.err) return "FAILED";
    return "CONFIRMED";
  } catch {
    return "UNKNOWN"; // network/timeout — status genuinely unknown, do not assume either way
  }
}
