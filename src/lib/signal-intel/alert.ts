// Discord embed for a signal alert. Pure: takes data, returns a webhook
// payload. Used by src/lib/discord.ts when a market snapshot is available.
//
// Discord limits: title 256, description 4096, 25 fields, field name 256,
// field value 1024, footer 2048, embed total 6000. We stay well under.

import { INTERVAL_LABELS, type IntervalKey, type TokenIntel } from "./types";
import {
  UNKNOWN,
  formatAgeSince,
  formatBuysSells,
  formatPercentChange,
  formatPriceUsd,
  formatUsdCompact,
  formatUtc,
  parseDecimal,
} from "./format";
import { explorerName, explorerUrl, safeHttpsUrl } from "./links";

export type AlertSignal = {
  tokenName: string;
  ticker: string;
  chain: string;
  exchange?: string | null;
  contractAddress?: string | null;
  signalType: string;
  entryPrice: string | null;
  targetPrice1?: string | null;
  targetPrice2?: string | null;
  stopLoss?: string | null;
  momentumScore: number | null;
  confidence: string | null;
  reason: string | null;
  chartUrl: string | null;
  createdAt?: Date | string | null;
};

const TYPE_COLOR: Record<string, number> = {
  BUY: 0x34d399,
  SELL: 0xf87171,
  ALERT: 0xfbbf24,
  LAUNCH: 0xc084fc,
};

/**
 * Token names, tickers and LLM-written reasons are attacker-influenced text.
 * Neutralize Discord markdown (so `[click](https://evil)` can't render as a
 * link) and mentions.
 */
export function escapeDiscord(text: string): string {
  return text
    .replace(/[\\`*_~|>[\]()#-]/g, (m) => `\\${m}`)
    .replace(/@/g, "@\u200b")
    .replace(/<(#|@|:|a:)/g, "<\u200b$1");
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function buildAlertEmbed(
  signal: AlertSignal,
  intel: TokenIntel,
  opts: { period?: IntervalKey; now?: Date } = {}
) {
  const period = opts.period ?? "h1";
  const now = opts.now ?? new Date();
  const pLabel = INTERVAL_LABELS[period];
  const dex = intel.dexId ?? signal.exchange ?? null;
  const address = signal.contractAddress ?? null;
  const explorer = explorerUrl(signal.chain, address);
  const chart = intel.pairUrl ?? safeHttpsUrl(signal.chartUrl);

  const price = intel.priceUsd;
  const change = intel.priceChange[period];

  const fields: { name: string; value: string; inline?: boolean }[] = [];

  fields.push({
    name: "Token",
    value: clip(
      [
        `${signal.chain}${dex ? ` · ${escapeDiscord(dex)}` : ""}`,
        intel.pairCreatedAt ? `Pair age ${formatAgeSince(intel.pairCreatedAt, now)}` : "Pair age —",
        `Detected ${signal.createdAt ? formatAgeSince(new Date(signal.createdAt).toISOString(), now) : "just now"} ago`,
      ].join("\n"),
      1024
    ),
    inline: true,
  });

  fields.push({
    name: `Market (${pLabel})`,
    value: clip(
      [
        `Price ${formatPriceUsd(price)} (${formatPercentChange(change)})`,
        `MC ${formatUsdCompact(intel.marketCapUsd)} · Liq ${formatUsdCompact(intel.liquidityUsd)}`,
        `Vol ${formatUsdCompact(intel.volumeUsd[period])} · B/S ${formatBuysSells(intel.txns[period])}`,
      ].join("\n"),
      1024
    ),
    inline: true,
  });

  const level = (v: string | null | undefined) => {
    const n = parseDecimal(v ?? null);
    return n == null ? UNKNOWN : formatPriceUsd(n);
  };
  const hasLevels = [signal.entryPrice, signal.targetPrice1, signal.targetPrice2, signal.stopLoss].some(
    (v) => parseDecimal(v ?? null) != null
  );
  if (hasLevels) {
    fields.push({
      name: "Levels",
      value: `Entry ${level(signal.entryPrice)}\nTP1 ${level(signal.targetPrice1)} · TP2 ${level(signal.targetPrice2)}\nStop ${level(signal.stopLoss)}`,
      inline: true,
    });
  }

  fields.push({
    name: "Signal",
    value: `Momentum ${signal.momentumScore != null ? `${signal.momentumScore}/10` : UNKNOWN} · ${
      signal.confidence ? `${signal.confidence} tier` : "tier unknown"
    }`,
    inline: false,
  });

  // Socials: provider-listed links only, clearly marked unverified.
  const links = intel.profile.links
    .filter((l) => l.kind === "website" || l.kind === "x" || l.kind === "telegram")
    .slice(0, 4);
  fields.push({
    name: "Links (listed by DexScreener, unverified)",
    value: !intel.profile.present
      ? "UNKNOWN — no provider profile for this token"
      : links.length
      ? links.map((l) => `[${escapeDiscord(l.label)}](${l.url})`).join(" · ")
      : "None listed",
    inline: false,
  });

  if (address) {
    fields.push({
      name: "Contract",
      // Code block → long-press to copy on mobile.
      value: `\`\`\`${address}\`\`\`${
        [chart ? `[Chart](${chart})` : null, explorer ? `[${explorerName(signal.chain)}](${explorer})` : null]
          .filter(Boolean)
          .join(" · ")
      }`.slice(0, 1024),
      inline: false,
    });
  } else if (chart) {
    fields.push({ name: "Links", value: `[Chart](${chart})`, inline: false });
  }

  // This alert is posted at signal creation; the safety stage runs afterwards,
  // so at this point there is no safety result. Say so rather than staying silent.
  fields.unshift({
    name: "⚠️ Safety: UNKNOWN",
    value:
      "Safety analysis runs after this alert is sent and may flag or block this token. Check the dashboard before acting.",
    inline: false,
  });

  const reason = signal.reason ? clip(escapeDiscord(signal.reason), 600) : undefined;
  const thumb = intel.imageUrl ?? undefined;

  return {
    title: clip(`${signal.signalType} — ${signal.tokenName} ($${signal.ticker})`, 256),
    url: chart ?? undefined,
    color: TYPE_COLOR[signal.signalType] ?? 0x999999,
    description: reason,
    thumbnail: thumb ? { url: thumb } : undefined,
    fields,
    footer: {
      text: clip(
        `Momentum Signals · DexScreener data as of ${formatUtc(intel.fetchedAt)} · Not financial advice; no safety or performance guarantee`,
        2048
      ),
    },
    timestamp: signal.createdAt ? new Date(signal.createdAt).toISOString() : now.toISOString(),
  };
}
