// Posts an alert to Discord via an incoming webhook when a HIGH-confidence
// signal is created. No-op if DISCORD_WEBHOOK_URL isn't set.
//
// When a market snapshot is supplied (scanner path) the alert uses the richer
// format from src/lib/signal-intel/alert.ts. Without one (manual/trigger
// posts) the original embed is sent exactly as before. The HIGH-confidence
// gate is unchanged.

import { buildAlertEmbed, type AlertSignal } from "@/lib/signal-intel/alert";
import type { TokenIntel } from "@/lib/signal-intel/types";

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

export async function sendDiscordAlert(
  signal: SignalForAlert & Partial<AlertSignal>,
  extra?: { intel?: TokenIntel | null }
) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl || signal.confidence !== "HIGH") return;

  try {
    if (extra?.intel) {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Never let token-controlled text ping anyone.
          allowed_mentions: { parse: [] },
          embeds: [buildAlertEmbed(signal as AlertSignal, extra.intel)],
        }),
      });
      return;
    }

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
