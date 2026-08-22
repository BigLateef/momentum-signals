// Trade-specific Discord alerts. Separate from src/lib/discord.ts (which
// handles HIGH-confidence signal alerts) so that module's existing behavior
// is never touched, per the "don't revisit Discord observability" instruction.

type TradeAlertPayload = {
  event: "SUBMITTED" | "CONFIRMED" | "FAILED";
  tokenName: string;
  ticker: string;
  action: "BUY" | "SELL";
  chain: string;
  baseCurrency: string;
  amount: string;
  confidence: string | null;
  momentumScore: number | null;
  safetyVerdict: string | null;
  transactionId: string | null;
  failureReason?: string;
  dryRun: boolean;
};

const EVENT_COLOR: Record<TradeAlertPayload["event"], number> = {
  SUBMITTED: 0x60a5fa, // blue
  CONFIRMED: 0x34d399, // emerald
  FAILED: 0xf87171, // red
};

export async function sendTradeAlert(payload: TradeAlertPayload) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const title = `${payload.dryRun ? "[DRY RUN] " : ""}${payload.action} ${payload.event} — ${payload.tokenName} ($${
    payload.ticker
  })`;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title,
            color: EVENT_COLOR[payload.event],
            fields: [
              { name: "Chain", value: payload.chain, inline: true },
              { name: "Base currency", value: payload.baseCurrency, inline: true },
              { name: "Amount", value: payload.amount, inline: true },
              { name: "Confidence", value: payload.confidence ?? "—", inline: true },
              {
                name: "Momentum",
                value: payload.momentumScore != null ? `${payload.momentumScore}/10` : "—",
                inline: true,
              },
              { name: "Safety verdict", value: payload.safetyVerdict ?? "—", inline: true },
              {
                name: payload.event === "CONFIRMED" ? "Confirmation status" : "Submission status",
                value: payload.event,
                inline: true,
              },
              { name: "Transaction ID", value: payload.transactionId ?? "—", inline: false },
              ...(payload.failureReason
                ? [{ name: "Failure reason", value: payload.failureReason, inline: false }]
                : []),
            ],
            footer: { text: "Momentum Signals — Auto-Trade" },
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch (err) {
    console.error("Trade Discord alert failed:", err);
  }
}
