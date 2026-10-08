// Pure view-model for the signal card. All decisions about WHAT to show (and
// how loudly) live here so they can be unit-tested without React. The
// components in src/components/signal/ only map this model to markup.
//
// Principles:
//  * Real provider values only. Missing data renders as UNKNOWN, never 0.
//  * Nothing is labelled "safe". Safety rows report what a check found, and
//    the verdict wording is the existing risk-level vocabulary.
//  * Every row that comes from a provider carries its source.

import {
  INTERVAL_LABELS,
  type IntervalKey,
  type ProviderLink,
  type SafetyCheckSummary,
  type SafetySummary,
  type SignalStatus,
  type TokenIntel,
} from "./types";
import {
  UNKNOWN,
  ageSince,
  formatAgeMs,
  formatAgeSince,
  formatBuysSells,
  formatCount,
  formatPercent,
  formatPercentChange,
  formatPriceUsd,
  formatUsdCompact,
  formatUtc,
  parseDecimal,
} from "./format";
import { explorerName, explorerUrl, safeHttpsUrl, shortenAddress } from "./links";

export type Tone = "ok" | "warn" | "danger" | "neutral" | "unknown";

export type Row = {
  key: string;
  label: string;
  value: string;
  tone: Tone;
  note?: string;
  source?: string | null;
  copy?: string; // when set the UI renders a copy button for this exact text
  href?: string;
};

export type Banner = {
  key: string;
  level: "danger" | "warn" | "info";
  title: string;
  detail?: string;
};

export type SocialRow = {
  kind: "website" | "x" | "telegram" | "discord" | "other";
  label: string;
  // listed      → provider lists a link (still unverified by us)
  // not_listed  → provider HAS a profile for the token but lists no such link
  // unknown     → provider has no profile for the token: cannot tell either way
  status: "listed" | "not_listed" | "unknown";
  links: ProviderLink[];
};

export type Freshness = {
  state: "fresh" | "stale" | "frozen" | "missing";
  text: string;
  source: string | null;
  at: string | null;
};

// Minimal shape of a signal as returned by GET /api/signals (dates arrive as
// ISO strings, numeric columns as strings).
export type SignalLike = {
  id: string;
  tokenName: string;
  ticker: string;
  chain: string;
  exchange?: string | null;
  contractAddress?: string | null;
  signalType: "BUY" | "SELL" | "ALERT" | "LAUNCH";
  entryPrice: string | null;
  currentPrice: string | null;
  targetPrice1: string | null;
  targetPrice2: string | null;
  stopLoss: string | null;
  momentumScore: number | null;
  confidence: "LOW" | "MEDIUM" | "HIGH" | null;
  chartUrl: string | null;
  createdAt: string;
  isActive?: boolean;
  tp1HitAt?: string | null;
  tp2HitAt?: string | null;
  invalidatedAt?: string | null;
  invalidationReason?: string | null;
  rugRiskScore?: number | null;
  safetyScore?: number | null;
  safetyVerdict?: string | null;
  safetyCheckedAt?: string | null;
  safetyOverride?: boolean;
};

export type CardInput = {
  signal: SignalLike;
  intel: TokenIntel | null;
  safety: SafetySummary | null;
  now: Date;
  period: IntervalKey;
};

// Price refresh runs every ~5 minutes (MONITORING_SCHEDULER_INTERVAL_MINUTES).
// Three missed cycles = stale.
export const MARKET_STALE_AFTER_MS = 15 * 60 * 1000;
// Active signals are re-analyzed roughly every 30 minutes.
export const SAFETY_STALE_AFTER_MS = 60 * 60 * 1000;

export const DISCLAIMER =
  "Informational only — not financial advice. Provider data can be delayed, incomplete or wrong, and none of these metrics guarantee safety or performance.";

const PROVIDER_LABELS: Record<string, string> = {
  dexscreener: "DexScreener",
  rugcheck: "RugCheck",
  goplus: "GoPlus",
};

export const BLOCKING_OR_SEVERE = ["HIGH_RISK", "VERY_HIGH_RISK", "CRITICAL", "BLOCKED"] as const;

const VERDICT_TEXT: Record<string, string> = {
  LOW_RISK: "LOWER RISK",
  CAUTION: "CAUTION",
  HIGH_RISK: "HIGH RISK",
  VERY_HIGH_RISK: "VERY HIGH RISK",
  CRITICAL: "CRITICAL RISK",
  BLOCKED: "BLOCKED",
  INSUFFICIENT_DATA: "INSUFFICIENT DATA",
};

export function verdictText(verdict: string): string {
  return VERDICT_TEXT[verdict] ?? verdict.replace(/_/g, " ");
}

export function deriveStatus(s: SignalLike): SignalStatus {
  if (s.invalidatedAt) return "INVALIDATED";
  if (s.tp2HitAt) return "TP2_HIT";
  if (s.isActive === false) return "CLOSED";
  if (s.tp1HitAt) return "TP1_HIT";
  return "ACTIVE";
}

const STATUS_TEXT: Record<SignalStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: "Active", tone: "ok" },
  TP1_HIT: { label: "TP1 reached · active", tone: "ok" },
  TP2_HIT: { label: "TP2 reached · closed", tone: "neutral" },
  INVALIDATED: { label: "Invalidated", tone: "danger" },
  CLOSED: { label: "Closed", tone: "neutral" },
};

const CHECK_TONE: Record<SafetyCheckSummary["status"], Tone> = {
  PASS: "ok",
  WARNING: "warn",
  FAIL: "danger",
  UNKNOWN: "unknown",
};

function providerList(dataSources: Record<string, string>, wanted: "ok" | "other"): string[] {
  return Object.entries(dataSources)
    .filter(([, v]) => (wanted === "ok" ? v === "ok" : v !== "ok"))
    .map(([k]) => PROVIDER_LABELS[k] ?? k);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Safety rows
// ---------------------------------------------------------------------------

type ValueFn = (c: SafetyCheckSummary) => string | null;

function checkRow(
  checks: SafetyCheckSummary[] | undefined,
  id: string,
  label: string,
  valueFn?: ValueFn,
  opts: { analyzed: boolean; note?: string; fallbackValue?: string; key?: string } = { analyzed: true }
): Row {
  const c = checks?.find((x) => x.id === id);
  if (!c) {
    return {
      key: opts.key ?? id,
      label,
      value: "UNKNOWN",
      tone: "unknown",
      note: opts.analyzed ? "Check not present in this report." : "Safety analysis has not run for this signal yet.",
    };
  }
  const tone = CHECK_TONE[c.status];
  if (c.status === "UNKNOWN") {
    return { key: opts.key ?? id, label, value: "UNKNOWN", tone, note: c.explanation, source: null };
  }
  const custom = valueFn ? valueFn(c) : null;
  return {
    key: opts.key ?? id,
    label,
    // Fall back to the check's own explanation text when we have no structured
    // value (e.g. reports created before checks carried `data`).
    value: custom ?? opts.fallbackValue ?? c.explanation,
    tone,
    note: custom != null || opts.fallbackValue ? c.explanation : opts.note,
    source: c.source,
  };
}

const d = (c: SafetyCheckSummary, k: string) => num(c.data?.[k]);

function authorityValue(c: SafetyCheckSummary): string | null {
  const active = c.data?.authorityActive;
  if (active === true) return "ACTIVE";
  if (active === false) return "Not active";
  return null;
}

function buildSafetySection(safety: SafetySummary | null, signal: SignalLike, now: Date) {
  const analyzed = safety != null;
  const checks = safety?.checks;

  const unknownCount = checks ? checks.filter((c) => c.status === "UNKNOWN").length : 0;
  const total = checks?.length ?? 0;

  const groups: { key: string; title: string; rows: Row[] }[] = [
    {
      key: "holders",
      title: "Holders",
      rows: [
        checkRow(checks, "holderCount", "Holders", (c) => {
          const n = d(c, "holderCount");
          return n != null ? formatCount(n) : null;
        }, { analyzed }),
        checkRow(checks, "topHolderConcentration", "Top holder", (c) => {
          const v = d(c, "top1Pct");
          return v != null ? formatPercent(v) : null;
        }, { analyzed, key: "top1", fallbackValue: "See safety report", note: "Holder lists can include liquidity-pool or contract addresses." }),
        checkRow(checks, "topHolderConcentration", "Top 5 holders", (c) => {
          const v = d(c, "top5Pct");
          return v != null ? formatPercent(v) : null;
        }, { analyzed, key: "top5", fallbackValue: "See safety report" }),
        checkRow(checks, "topHolderConcentration", "Top 10 holders", (c) => {
          const v = d(c, "top10Pct");
          return v != null ? formatPercent(v) : null;
        }, { analyzed, key: "top10", fallbackValue: "See safety report" }),
      ],
    },
    {
      key: "controls",
      title: "Contract controls",
      rows: [
        checkRow(checks, "mintAuthority", "Mint authority", authorityValue, { analyzed }),
        checkRow(checks, "freezeAuthority", "Freeze / pause", authorityValue, { analyzed }),
        checkRow(checks, "transferRestrictions", "Transfer restrictions", (c) =>
          c.data?.restricted === true ? "DETECTED" : c.data?.restricted === false ? "None detected" : null
        , { analyzed }),
        checkRow(checks, "blacklistOrPause", "Blacklist / whitelist gating", undefined, { analyzed }),
        checkRow(checks, "upgradeableContract", "Upgradeable contract", undefined, { analyzed }),
      ],
    },
    {
      key: "liquidity",
      title: "Liquidity & LP",
      rows: [
        checkRow(checks, "liquiditySize", "Liquidity", (c) => {
          const v = d(c, "liquidityUsd");
          return v != null ? formatUsdCompact(v) : null;
        }, { analyzed }),
        checkRow(checks, "lpLockStatus", "LP locked / burned", (c) => {
          const v = d(c, "lockedPct");
          return v != null ? `${formatPercent(v)} locked or burned` : null;
        }, { analyzed }),
        checkRow(checks, "lpLockExpiry", "LP lock expiry", undefined, { analyzed }),
        checkRow(checks, "creatorLiquidityControl", "Creator control of liquidity", undefined, { analyzed }),
        checkRow(checks, "suddenLiquidityWithdrawal", "Liquidity change vs last analysis", undefined, { analyzed }),
      ],
    },
    {
      key: "deployer",
      title: "Deployer",
      rows: [
        checkRow(checks, "creatorAllocation", "Deployer holdings", (c) => {
          const v = d(c, "creatorPct");
          return v != null ? `${formatPercent(v)} of supply` : null;
        }, { analyzed }),
        checkRow(checks, "deployerHistory", "Deployer history", undefined, {
          analyzed,
          note: "Counts only tokens this platform has analyzed before — not the deployer's full on-chain history.",
        }),
        checkRow(checks, "previousTokenLaunches", "Previous launches", undefined, { analyzed }),
        checkRow(checks, "deployAndDumpBehavior", "Deployer selling activity", undefined, { analyzed }),
      ],
    },
    {
      key: "trading",
      title: "Trading behaviour",
      rows: [
        // No integrated provider reports bundler/sniper wallets or counts. These
        // rows exist so the gap is visible instead of silently missing. See
        // docs/SIGNAL_INTEL.md for the integration needed.
        {
          key: "bundlers",
          label: "Bundler wallets",
          value: "UNKNOWN",
          tone: "unknown",
          note: "No connected provider reports bundler counts.",
        },
        {
          key: "snipers",
          label: "Sniper wallets",
          value: "UNKNOWN",
          tone: "unknown",
          note: "No connected provider reports sniper counts.",
        },
        checkRow(checks, "suspiciousLinkedWallets", "Linked-wallet clusters", undefined, { analyzed }),
        checkRow(checks, "failedSellTransactions", "Sell simulation (honeypot proxy)", undefined, { analyzed }),
        checkRow(checks, "buySellRatio", "Buy/sell skew (1h)", undefined, { analyzed }),
        checkRow(checks, "washTrading", "Wash-trading heuristic", undefined, { analyzed }),
        checkRow(checks, "abnormalVolumeSlippageImpact", "Buy / sell tax", (c) => {
          const b = d(c, "buyTaxPct");
          const s = d(c, "sellTaxPct");
          return b != null && s != null ? `${formatPercent(b)} buy · ${formatPercent(s)} sell` : null;
        }, { analyzed }),
      ],
    },
  ];

  const analyzedAt = safety?.analyzedAt ?? signal.safetyCheckedAt ?? null;
  const ok = safety ? providerList(safety.dataSources, "ok") : [];
  const notOk = safety ? providerList(safety.dataSources, "other") : [];
  const ageMs = ageSince(analyzedAt, now);
  const active = signal.isActive !== false;

  const freshness: Freshness = !analyzedAt
    ? { state: "missing", text: "Not analyzed yet", source: null, at: null }
    : !active
    ? {
        state: "frozen",
        text: `${ok.join(" + ") || "Safety providers"} · analyzed ${formatAgeMs(ageMs)} ago (signal closed — no longer re-checked)`,
        source: ok.join(" + ") || null,
        at: analyzedAt,
      }
    : ageMs != null && ageMs > SAFETY_STALE_AFTER_MS
    ? {
        state: "stale",
        text: `${ok.join(" + ") || "Safety providers"} · analyzed ${formatAgeMs(ageMs)} ago (stale)`,
        source: ok.join(" + ") || null,
        at: analyzedAt,
      }
    : {
        state: "fresh",
        text: `${ok.join(" + ") || "Safety providers"} · analyzed ${formatAgeMs(ageMs)} ago`,
        source: ok.join(" + ") || null,
        at: analyzedAt,
      };

  return { groups, unknownCount, total, freshness, unavailableProviders: notOk };
}

// ---------------------------------------------------------------------------
// Socials
// ---------------------------------------------------------------------------

function buildSocials(intel: TokenIntel | null): { rows: SocialRow[]; note: string } {
  const expected: { kind: SocialRow["kind"]; label: string }[] = [
    { kind: "website", label: "Website" },
    { kind: "x", label: "X" },
  ];

  const extraKinds: { kind: SocialRow["kind"]; label: string }[] = [
    { kind: "telegram", label: "Telegram" },
    { kind: "discord", label: "Discord" },
    { kind: "other", label: "Other" },
  ];

  if (!intel || !intel.profile.present) {
    return {
      rows: expected.map((e) => ({ ...e, status: "unknown" as const, links: [] })),
      note: intel
        ? "DexScreener has no profile for this token, so we cannot tell whether the project has links. UNKNOWN is not the same as 'none'."
        : "No market snapshot recorded — link status unknown.",
    };
  }

  const links = intel.profile.links;
  const rows: SocialRow[] = expected.map((e) => {
    const found = links.filter((l) => l.kind === e.kind);
    return { ...e, status: found.length ? "listed" : "not_listed", links: found };
  });
  for (const e of extraKinds) {
    const found = links.filter((l) => l.kind === e.kind);
    if (found.length) rows.push({ ...e, status: "listed", links: found });
  }
  return {
    rows,
    note: "Links are as listed in DexScreener's token profile. This app does not verify they belong to the project — check before trusting or connecting a wallet.",
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildSignalCardModel(input: CardInput) {
  const { signal, intel, safety, now, period } = input;
  const pLabel = INTERVAL_LABELS[period];
  const status = deriveStatus(signal);
  const isActive = signal.isActive !== false;
  const hasVerdict = !!(safety?.verdict ?? signal.safetyVerdict);
  const verdict = safety?.verdict ?? signal.safetyVerdict ?? null;

  // ---- market freshness ----
  const marketAge = intel ? ageSince(intel.fetchedAt, now) : null;
  const marketFreshness: Freshness = !intel
    ? { state: "missing", text: "No market snapshot recorded", source: null, at: null }
    : !isActive
    ? {
        state: "frozen",
        text: `DexScreener · snapshot ${formatAgeMs(marketAge)} old (signal closed — no longer refreshed)`,
        source: "DexScreener",
        at: intel.fetchedAt,
      }
    : marketAge != null && marketAge > MARKET_STALE_AFTER_MS
    ? { state: "stale", text: `DexScreener · updated ${formatAgeMs(marketAge)} ago (stale)`, source: "DexScreener", at: intel.fetchedAt }
    : { state: "fresh", text: `DexScreener · updated ${formatAgeMs(marketAge)} ago`, source: "DexScreener", at: intel.fetchedAt };

  // ---- price ----
  const snapshotPrice = intel?.priceUsd ?? null;
  const fallbackPrice = parseDecimal(signal.currentPrice);
  const price = snapshotPrice ?? fallbackPrice;
  const change = intel?.priceChange[period] ?? null;

  // ---- identity ----
  const dex = intel?.dexId ?? signal.exchange ?? null;
  const address = signal.contractAddress ?? null;
  const chartUrl = intel?.pairUrl ?? safeHttpsUrl(signal.chartUrl);
  const explorer = explorerUrl(signal.chain, address);
  const marketSource = intel ? "DexScreener" : null;

  const unknownMarket = (key: string, label: string, why = "Not reported by DexScreener for this pair."): Row => ({
    key,
    label,
    value: "UNKNOWN",
    tone: "unknown",
    note: intel ? why : "No market snapshot recorded for this signal.",
  });

  const marketRow = (key: string, label: string, value: number | null, fmt: (n: number | null) => string, note?: string): Row =>
    value == null
      ? unknownMarket(key, label)
      : { key, label, value: fmt(value), tone: "neutral", source: marketSource, note };

  const txns = intel?.txns[period] ?? null;
  const vol = intel?.volumeUsd[period] ?? null;

  const keyStats: Row[] = [
    marketRow("mc", "MC", intel?.marketCapUsd ?? null, formatUsdCompact),
    marketRow("vol", `Vol ${pLabel}`, vol, formatUsdCompact),
    marketRow("liq", "Liq", intel?.liquidityUsd ?? null, formatUsdCompact),
    txns
      ? { key: "bs", label: `B/S ${pLabel}`, value: formatBuysSells(txns), tone: "neutral", source: marketSource }
      : unknownMarket("bs", `B/S ${pLabel}`),
  ];

  // ---- levels ----
  const level = (key: string, label: string, v: string | null): Row => {
    const n = parseDecimal(v);
    return n == null
      ? { key, label, value: UNKNOWN, tone: "unknown" }
      : { key, label, value: formatPriceUsd(n), tone: "neutral" };
  };
  const levels = [
    level("entry", "Entry", signal.entryPrice),
    level("tp1", "TP1", signal.targetPrice1),
    level("tp2", "TP2", signal.targetPrice2),
    level("stop", "Stop", signal.stopLoss),
  ];
  const hasAnyLevel = levels.some((l) => l.value !== UNKNOWN);

  // ---- safety ----
  const safetySection = buildSafetySection(safety, signal, now);

  // ---- banners (most important first) ----
  const banners: Banner[] = [];

  if (status === "INVALIDATED") {
    banners.push({
      key: "invalidated",
      level: "danger",
      title: "Signal invalidated",
      detail: signal.invalidationReason ?? undefined,
    });
  }

  if (!hasVerdict) {
    banners.push({
      key: "safety-pending",
      level: "warn",
      title: "Safety UNKNOWN — not analyzed yet",
      detail: "No safety assessment exists for this token yet. Treat every risk field as unknown.",
    });
  } else if (verdict && (BLOCKING_OR_SEVERE as readonly string[]).includes(verdict)) {
    banners.push({
      key: "verdict",
      level: "danger",
      title: `${verdictText(verdict)} on automated checks`,
      detail: signal.safetyOverride ? "An admin override is active for this signal." : undefined,
    });
  } else if (verdict === "CAUTION") {
    banners.push({ key: "verdict", level: "warn", title: "CAUTION on automated checks" });
  } else if (verdict === "INSUFFICIENT_DATA") {
    banners.push({
      key: "verdict",
      level: "warn",
      title: "Insufficient safety data",
      detail: "Too many checks returned no data to assess this token.",
    });
  }

  const fails = (safety?.checks ?? []).filter((c) => c.status === "FAIL");
  for (const c of fails.slice(0, 3)) {
    banners.push({ key: `fail-${c.id}`, level: "danger", title: c.label, detail: c.explanation });
  }
  if (fails.length > 3) {
    banners.push({ key: "fail-more", level: "danger", title: `+${fails.length - 3} more failed checks`, detail: "Open Safety details." });
  }

  if (safetySection.total > 0 && safetySection.unknownCount / safetySection.total >= 0.5 && verdict !== "INSUFFICIENT_DATA") {
    banners.push({
      key: "mostly-unknown",
      level: "warn",
      title: `${safetySection.unknownCount} of ${safetySection.total} safety checks have no data`,
      detail: "A favourable result on the remaining checks is not a safety guarantee.",
    });
  }

  if (marketFreshness.state === "stale") {
    banners.push({ key: "stale-market", level: "warn", title: "Market data is stale", detail: marketFreshness.text });
  }
  if (safetySection.freshness.state === "stale") {
    banners.push({ key: "stale-safety", level: "warn", title: "Safety data is stale", detail: safetySection.freshness.text });
  }

  const order = { danger: 0, warn: 1, info: 2 } as const;
  banners.sort((a, b) => order[a.level] - order[b.level]);

  // ---- sections ----
  const identityRows: Row[] = [
    { key: "name", label: "Token", value: signal.tokenName, tone: "neutral" },
    { key: "ticker", label: "Ticker", value: `$${signal.ticker}`, tone: "neutral" },
    { key: "chain", label: "Chain", value: signal.chain, tone: "neutral" },
    dex
      ? { key: "dex", label: "DEX / launchpad", value: dex, tone: "neutral", source: intel?.dexId ? marketSource : "signal record" }
      : { key: "dex", label: "DEX / launchpad", value: "UNKNOWN", tone: "unknown" },
    address
      ? { key: "contract", label: "Contract", value: address, tone: "neutral", copy: address }
      : { key: "contract", label: "Contract", value: "UNKNOWN", tone: "unknown", note: "No contract address on this signal." },
    intel?.pairCreatedAt
      ? {
          key: "pair-age",
          label: "Pair age",
          value: formatAgeSince(intel.pairCreatedAt, now),
          tone: "neutral",
          source: marketSource,
          note: "Age of the trading pair. The token itself may be older.",
        }
      : unknownMarket("pair-age", "Pair age", "DexScreener did not report a pair creation time."),
    {
      key: "detected",
      label: "Signal detected",
      value: `${formatUtc(signal.createdAt)} (${formatAgeSince(signal.createdAt, now)} ago)`,
      tone: "neutral",
    },
  ];

  const changes = (["m5", "h1", "h6", "h24"] as IntervalKey[])
    .map((k) => `${INTERVAL_LABELS[k]} ${formatPercentChange(intel?.priceChange[k] ?? null)}`)
    .join(" · ");

  const marketRows: Row[] = [
    price != null
      ? {
          key: "price",
          label: "Price",
          value: formatPriceUsd(price),
          tone: "neutral",
          source: snapshotPrice != null ? marketSource : "price-refresh stage (DexScreener)",
        }
      : unknownMarket("price", "Price"),
    intel
      ? { key: "changes", label: "Price change", value: changes, tone: "neutral", source: marketSource }
      : unknownMarket("changes", "Price change"),
    marketRow("mc", "Market cap", intel?.marketCapUsd ?? null, formatUsdCompact, "As calculated by DexScreener."),
    marketRow("fdv", "Fully diluted value", intel?.fdvUsd ?? null, formatUsdCompact),
    marketRow("vol", `Volume (${pLabel})`, vol, formatUsdCompact),
    marketRow("vol24", "Volume (24h)", intel?.volumeUsd.h24 ?? null, formatUsdCompact),
    marketRow("liq", "Liquidity", intel?.liquidityUsd ?? null, formatUsdCompact),
    txns
      ? {
          key: "bs",
          label: `Buys / sells (${pLabel})`,
          value: formatBuysSells(txns),
          tone: "neutral",
          source: marketSource,
          note: "Transaction counts, not USD amounts.",
        }
      : unknownMarket("bs", `Buys / sells (${pLabel})`),
    {
      key: "supply",
      label: "Circulating / total supply",
      value: "UNKNOWN",
      tone: "unknown",
      note: "No connected provider reports supply. Not estimated from market cap.",
    },
    {
      key: "ath",
      label: "All-time high / drawdown",
      value: "UNKNOWN",
      tone: "unknown",
      note: "Needs a price-history provider that is not connected yet.",
    },
  ];

  const signalRows: Row[] = [
    { key: "type", label: "Signal", value: signal.signalType, tone: "neutral" },
    { key: "status", label: "Status", value: STATUS_TEXT[status].label, tone: STATUS_TEXT[status].tone },
    ...levels,
    signal.momentumScore != null
      ? { key: "momentum", label: "Momentum score", value: `${signal.momentumScore}/10`, tone: "neutral" }
      : { key: "momentum", label: "Momentum score", value: "UNKNOWN", tone: "unknown" },
    signal.confidence
      ? {
          key: "confidence",
          label: "Confidence tier",
          value: signal.confidence,
          tone: signal.confidence === "HIGH" ? "ok" : signal.confidence === "MEDIUM" ? "warn" : "neutral",
          note: "A liquidity/volume tier assigned by the scanner — not a probability of profit.",
        }
      : { key: "confidence", label: "Confidence tier", value: "UNKNOWN", tone: "unknown" },
    {
      key: "first-detected",
      label: "First detected",
      value: `${formatUtc(signal.createdAt)} (${formatAgeSince(signal.createdAt, now)} ago)`,
      tone: "neutral",
    },
  ];
  if (signal.tp1HitAt) signalRows.push({ key: "tp1-at", label: "TP1 reached", value: formatUtc(signal.tp1HitAt), tone: "ok" });
  if (signal.tp2HitAt) signalRows.push({ key: "tp2-at", label: "TP2 reached", value: formatUtc(signal.tp2HitAt), tone: "ok" });
  if (signal.invalidatedAt)
    signalRows.push({
      key: "invalidated-at",
      label: "Invalidated",
      value: formatUtc(signal.invalidatedAt),
      tone: "danger",
      note: signal.invalidationReason ?? undefined,
    });

  return {
    signalType: signal.signalType,
    chain: signal.chain,
    dex,
    name: signal.tokenName,
    ticker: signal.ticker,
    imageUrl: intel?.imageUrl ?? null,
    signalAge: formatAgeSince(signal.createdAt, now),
    pairAge: intel?.pairCreatedAt ? formatAgeSince(intel.pairCreatedAt, now) : null,
    status,
    statusText: STATUS_TEXT[status],
    price: {
      value: formatPriceUsd(price),
      known: price != null,
      periodLabel: pLabel,
      changeValue: formatPercentChange(change),
      changeTone: (change == null ? "unknown" : change >= 0 ? "ok" : "danger") as Tone,
    },
    keyStats,
    levels,
    hasAnyLevel,
    momentumScore: signal.momentumScore,
    confidence: signal.confidence,
    banners,
    address,
    addressShort: shortenAddress(address),
    links: {
      chart: chartUrl,
      explorer: explorer ? { name: explorerName(signal.chain), url: explorer } : null,
    },
    freshness: { market: marketFreshness, safety: safetySection.freshness },
    sections: {
      identity: identityRows,
      market: marketRows,
      socials: buildSocials(intel),
      safety: {
        verdict,
        verdictText: verdict ? verdictText(verdict) : null,
        scores:
          hasVerdict && (safety?.rugRiskScore ?? signal.rugRiskScore) != null
            ? { risk: safety?.rugRiskScore ?? signal.rugRiskScore ?? null, safety: safety?.safetyScore ?? signal.safetyScore ?? null }
            : null,
        override: !!signal.safetyOverride,
        groups: safetySection.groups,
        unknownCount: safetySection.unknownCount,
        total: safetySection.total,
        unavailableProviders: safetySection.unavailableProviders,
        warnings: safety?.warnings ?? [],
        caveat:
          verdict === "LOW_RISK"
            ? "Lower risk on the checks that returned data. This is not a safety guarantee."
            : null,
      },
      signal: signalRows,
    },
    disclaimer: DISCLAIMER,
  };
}

export type SignalCardModel = ReturnType<typeof buildSignalCardModel>;
