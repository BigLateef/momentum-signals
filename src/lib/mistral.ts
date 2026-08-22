// Rewrites the scanner's templated reason string into a short, readable
// narrative using Mistral's API. Purely cosmetic — never touches score,
// confidence, or signal type, which stay fully deterministic (see momentum.ts).
// No-op (returns the original reason) if MISTRAL_API_KEY isn't set or the
// call fails for any reason — enrichment should never block a signal post.

type EnrichInput = {
  tokenName: string;
  ticker: string;
  chain: string;
  signalType: string;
  priceChange1h: number;
  priceChange6h: number;
  volume24h: number;
  liquidity: number;
  buys: number;
  sells: number;
  fallbackReason: string;
};

export async function enrichReasonWithMistral(input: EnrichInput): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) return input.fallbackReason;

  const prompt = `You write extremely short trader-facing notes for a crypto momentum signal feed. Given this data, write ONE sentence (max 25 words) describing the setup in plain trader language. No hype, no financial advice, no emojis, just a factual read of what the data shows.

Token: ${input.tokenName} ($${input.ticker}) on ${input.chain}
Signal type: ${input.signalType}
1h price change: ${input.priceChange1h.toFixed(1)}%
6h price change: ${input.priceChange6h.toFixed(1)}%
24h volume: $${Math.round(input.volume24h).toLocaleString()}
Liquidity: $${Math.round(input.liquidity).toLocaleString()}
1h buy/sell txns: ${input.buys}/${input.sells}

Respond with ONLY the sentence, nothing else.`;

  try {
    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 80,
        temperature: 0.4,
      }),
      // Keep this fast — enrichment runs inline during the scan, which has
      // its own tight time budget on Vercel Hobby's 10s function limit.
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) return input.fallbackReason;

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text || input.fallbackReason;
  } catch {
    return input.fallbackReason;
  }
}
