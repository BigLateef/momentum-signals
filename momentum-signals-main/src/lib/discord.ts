// Posts an alert to Discord via an incoming webhook when a HIGH-confidence
// signal is created. No-op if DISCORD_WEBHOOK_URL isn't set.

type SignalForAlert = {
  tokenName: string;
  ticker: string;
  chain: string;
  signalType: string;
  entryPrice: string | null;
  momentumScore: number | null;
  confidence: string | null;
  reason: string | null;
  chartUrl: string | null;
};

const TYPE_COLOR: Record<string, number> = {
  BUY: 0x34d399, // emerald
  SELL: 0xf87171, // red
  ALERT: 0xfbbf24, // yellow
  LAUNCH: 0xc084fc, // purple
};

export async function sendDiscordAlert(signal: SignalForAlert) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl || signal.confidence !== "HIGH") return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: `${signal.signalType} — ${signal.tokenName} ($${signal.ticker})`,
            url: signal.chartUrl ?? undefined,
            color: TYPE_COLOR[signal.signalType] ?? 0x999999,
            fields: [
              { name: "Chain", value: signal.chain, inline: true },
              {
                name: "Entry",
                value: signal.entryPrice ? `$${signal.entryPrice}` : "—",
                inline: true,
              },
              {
                name: "Momentum",
                value: signal.momentumScore ? `${signal.momentumScore}/10` : "—",
                inline: true,
              },
            ],
            description: signal.reason ?? undefined,
            footer: { text: "Momentum Signals — HIGH confidence alert" },
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch (err) {
    // Alerts are best-effort — never let a Discord outage break signal posting
    console.error("Discord webhook failed:", err);
  }
}
