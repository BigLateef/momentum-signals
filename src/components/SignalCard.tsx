"use client";

import { useMemo, useState } from "react";
import SafetyPanel from "./SafetyPanel";
import SafetyReportModal from "./SafetyReportModal";
import ExecutionStatus from "./ExecutionStatus";
import Section from "./signal/Section";
import DataRows from "./signal/DataRows";
import RiskBanners from "./signal/RiskBanners";
import SocialsList from "./signal/SocialsList";
import TokenAvatar from "./signal/TokenAvatar";
import CopyButton from "./signal/CopyButton";
import { TONE_TEXT } from "./signal/tones";
import { buildSignalCardModel, type SignalLike } from "@/lib/signal-intel/view-model";
import type { IntervalKey, SafetySummary, TokenIntel } from "@/lib/signal-intel/types";
import { useNow } from "@/lib/signal-intel/use-now";

type Signal = SignalLike & {
  reason: string | null;
  isWatchlisted?: boolean;
  kolSummary?: string | null;
  // New (additive) — attached by GET /api/signals; both may be null/undefined.
  tokenIntel?: TokenIntel | null;
  safety?: SafetySummary | null;
  latestExecution?: {
    status: "ELIGIBLE" | "SKIPPED" | "DRY_RUN" | "SUBMITTED" | "CONFIRMED" | "FAILED";
    skipReason: string | null;
    transactionId: string | null;
    dryRun: boolean;
  } | null;
};

const TYPE_STYLES: Record<string, string> = {
  BUY: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  SELL: "bg-red-500/15 text-red-400 border-red-500/30",
  ALERT: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  LAUNCH: "bg-purple-500/15 text-purple-400 border-purple-500/30",
};

const CONFIDENCE_STYLES: Record<string, string> = {
  LOW: "text-zinc-500",
  MEDIUM: "text-yellow-400",
  HIGH: "text-emerald-400",
};

const SECTION_KEYS = ["identity", "market", "socials", "safety", "signal"] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

export default function SignalCard({
  signal,
  onToggleWatchlist,
  period = "h1",
  defaultExpanded = false,
}: {
  signal: Signal;
  onToggleWatchlist?: (id: string) => void;
  period?: IntervalKey;
  defaultExpanded?: boolean;
}) {
  const [showReport, setShowReport] = useState(false);
  const [open, setOpen] = useState<Record<SectionKey, boolean>>(
    () => Object.fromEntries(SECTION_KEYS.map((k) => [k, defaultExpanded])) as Record<SectionKey, boolean>
  );
  const now = useNow();

  const m = useMemo(
    () =>
      buildSignalCardModel({
        signal,
        intel: signal.tokenIntel ?? null,
        safety: signal.safety ?? null,
        now,
        period,
      }),
    [signal, now, period]
  );

  const allOpen = SECTION_KEYS.every((k) => open[k]);
  const toggle = (k: SectionKey) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const setAll = (v: boolean) => setOpen(Object.fromEntries(SECTION_KEYS.map((k) => [k, v])) as Record<SectionKey, boolean>);

  const safetySection = m.sections.safety;
  const freshnessTone = (s: string) => (s === "stale" ? "text-yellow-400" : "text-zinc-600");

  return (
    <div className="bg-base-900 border border-base-800 rounded-lg p-4 hover:border-base-700 transition-colors">
      {/* ---- header ---- */}
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className={`text-xs font-bold px-2 py-0.5 rounded border ${TYPE_STYLES[signal.signalType]}`}>
            {signal.signalType}
          </span>
          <span className="text-xs px-2 py-0.5 rounded bg-base-800 text-zinc-400 border border-base-700">{m.chain}</span>
          {m.dex && (
            <span className="text-xs px-2 py-0.5 rounded bg-base-800 text-zinc-500 border border-base-700 truncate max-w-[8rem]">
              {m.dex}
            </span>
          )}
          {m.status !== "ACTIVE" && m.status !== "TP1_HIT" && (
            <span className={`text-xs px-2 py-0.5 rounded border border-base-700 bg-base-800 ${TONE_TEXT[m.statusText.tone]}`}>
              {m.statusText.label}
            </span>
          )}
        </div>
        <button
          onClick={() => onToggleWatchlist?.(signal.id)}
          aria-label="Toggle watchlist"
          className={`text-lg leading-none ${signal.isWatchlisted ? "text-accent-400" : "text-zinc-600 hover:text-zinc-400"}`}
        >
          {signal.isWatchlisted ? "★" : "☆"}
        </button>
      </div>

      {/* ---- identity + price ---- */}
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <TokenAvatar src={m.imageUrl} ticker={m.ticker} />
          <div className="min-w-0">
            <p className="text-white font-semibold truncate">{m.name}</p>
            <p className="text-zinc-500 text-xs font-mono truncate">
              ${m.ticker} · signal {m.signalAge}
              {m.pairAge ? ` · pair ${m.pairAge}` : ""}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-zinc-100 font-mono text-sm">{m.price.known ? m.price.value : "—"}</p>
          <p className={`text-xs font-mono ${TONE_TEXT[m.price.changeTone]}`}>
            {m.price.changeValue} <span className="text-zinc-600">{m.price.periodLabel}</span>
          </p>
        </div>
      </div>

      {m.address && (
        <div className="flex items-center gap-2 mb-3 text-xs">
          <span className="font-mono text-zinc-500" title={m.address}>
            {m.addressShort}
          </span>
          <CopyButton text={m.address} />
        </div>
      )}

      {/* ---- prominent risk warnings ---- */}
      <RiskBanners banners={m.banners} />

      {/* ---- key stats (selected period) ---- */}
      <div className="grid grid-cols-2 gap-2 text-xs mb-1.5">
        {m.keyStats.map((s) => (
          <div key={s.key} className="bg-base-800/50 rounded px-2 py-1.5">
            <p className="text-zinc-600">{s.label}</p>
            <p className={`font-mono ${s.tone === "unknown" ? "text-zinc-600" : "text-zinc-200"}`} title={s.note}>
              {s.tone === "unknown" ? "—" : s.value}
            </p>
          </div>
        ))}
      </div>
      <p className={`text-[11px] mb-3 ${freshnessTone(m.freshness.market.state)}`}>Market: {m.freshness.market.text}</p>

      {/* ---- levels ---- */}
      {m.hasAnyLevel && (
        <div className="grid grid-cols-4 gap-1 text-[11px] mb-3">
          {m.levels.map((l) => (
            <div key={l.key} className="bg-base-800/50 rounded px-1.5 py-1 min-w-0">
              <p className="text-zinc-600">{l.label}</p>
              <p className="text-zinc-200 font-mono truncate" title={l.value}>
                {l.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ---- momentum / confidence / status ---- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
        {m.momentumScore != null && (
          <div className="flex items-center gap-1" aria-label={`Momentum ${m.momentumScore} of 10`}>
            <span className="text-xs text-zinc-500 mr-1">Momentum</span>
            {Array.from({ length: 10 }).map((_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full ${i < m.momentumScore! ? "bg-accent-400" : "bg-base-700"}`}
              />
            ))}
          </div>
        )}
        {m.confidence && (
          <span className={`text-xs font-medium ${CONFIDENCE_STYLES[m.confidence]}`} title="Liquidity/volume tier — not a probability">
            {m.confidence} tier
          </span>
        )}
        <PnlBadge entryPrice={signal.entryPrice} currentPrice={signal.currentPrice} />
      </div>

      {signal.reason && <p className="text-sm text-zinc-400 leading-relaxed mb-3">{signal.reason}</p>}

      {/* ---- existing safety strip (now fed the real checks) ---- */}
      {safetySection.verdict && (
        <SafetyPanel
          props={{
            rugRiskScore: signal.rugRiskScore ?? signal.safety?.rugRiskScore ?? null,
            safetyScore: signal.safetyScore ?? signal.safety?.safetyScore ?? null,
            safetyVerdict: signal.safetyVerdict ?? signal.safety?.verdict ?? null,
            safetyCheckedAt: signal.safetyCheckedAt ?? signal.safety?.analyzedAt ?? null,
            safetyOverride: signal.safetyOverride,
          }}
          checks={signal.safety?.checks}
          onViewReport={signal.contractAddress ? () => setShowReport(true) : undefined}
        />
      )}
      {safetySection.caveat && <p className="text-[11px] text-zinc-500 -mt-2 mb-3">{safetySection.caveat}</p>}

      <ExecutionStatus execution={signal.latestExecution} />

      {showReport && signal.contractAddress && (
        <SafetyReportModal chain={signal.chain} tokenAddress={signal.contractAddress} onClose={() => setShowReport(false)} />
      )}

      {signal.kolSummary && (
        <p className="text-xs text-purple-400 bg-purple-500/10 border border-purple-500/20 rounded px-2 py-1 mb-3">
          🐋 {signal.kolSummary}
        </p>
      )}

      {/* ---- expandable details ---- */}
      <div className="mb-2">
        <div className="flex justify-end mb-1">
          <button
            type="button"
            onClick={() => setAll(!allOpen)}
            className="text-[11px] text-accent-400 hover:underline"
          >
            {allOpen ? "Collapse all" : "Expand all details"}
          </button>
        </div>

        <Section
          title="Identity & links"
          summary={m.addressShort}
          open={open.identity}
          onToggle={() => toggle("identity")}
        >
          <DataRows rows={m.sections.identity} />
          <div className="flex flex-wrap gap-3 mt-2 text-xs">
            {m.links.chart && (
              <a href={m.links.chart} target="_blank" rel="noopener noreferrer" className="text-accent-400 hover:underline">
                Chart →
              </a>
            )}
            {m.links.explorer && (
              <a
                href={m.links.explorer.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-400 hover:underline"
              >
                {m.links.explorer.name} →
              </a>
            )}
          </div>
        </Section>

        <Section title="Market stats" summary={m.freshness.market.state === "missing" ? "no snapshot" : m.price.value} open={open.market} onToggle={() => toggle("market")}>
          <DataRows rows={m.sections.market} />
          <p className={`text-[11px] mt-2 ${freshnessTone(m.freshness.market.state)}`}>{m.freshness.market.text}</p>
        </Section>

        <Section title="Socials" summary="provider-listed" open={open.socials} onToggle={() => toggle("socials")}>
          <SocialsList socials={m.sections.socials} />
        </Section>

        <Section
          title="Safety details"
          summary={safetySection.verdictText ?? "UNKNOWN"}
          open={open.safety}
          onToggle={() => toggle("safety")}
        >
          {safetySection.verdictText ? (
            <p className="text-xs text-zinc-400 mb-2">
              Verdict: <span className="font-semibold text-zinc-200">{safetySection.verdictText}</span>
              {safetySection.override ? " (admin override)" : ""}
              {safetySection.scores
                ? ` · risk ${safetySection.scores.risk ?? "?"} · safety ${safetySection.scores.safety ?? "?"}`
                : ""}
              {safetySection.total > 0 ? ` · ${safetySection.unknownCount}/${safetySection.total} checks UNKNOWN` : ""}
            </p>
          ) : (
            <p className="text-xs text-yellow-400 mb-2">Safety UNKNOWN — no analysis on file for this token.</p>
          )}
          <div className="space-y-3">
            {safetySection.groups.map((g) => (
              <div key={g.key}>
                <p className="text-[11px] uppercase tracking-wide text-zinc-600 mb-1">{g.title}</p>
                <DataRows rows={g.rows} />
              </div>
            ))}
          </div>
          {safetySection.warnings.length > 0 && (
            <ul className="mt-2 list-disc list-inside text-[11px] text-yellow-400/90 space-y-0.5">
              {safetySection.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <p className={`text-[11px] mt-2 ${freshnessTone(m.freshness.safety.state)}`}>
            {m.freshness.safety.text}
            {safetySection.unavailableProviders.length > 0
              ? ` · unavailable: ${safetySection.unavailableProviders.join(", ")}`
              : ""}
          </p>
        </Section>

        <Section title="Signal details" summary={m.statusText.label} open={open.signal} onToggle={() => toggle("signal")}>
          <DataRows rows={m.sections.signal} />
        </Section>
      </div>

      {/* ---- footer ---- */}
      <div className="flex items-center justify-between text-xs text-zinc-600 pt-2 border-t border-base-800">
        {m.links.chart ? (
          <a href={m.links.chart} target="_blank" rel="noopener noreferrer" className="text-accent-400 hover:underline">
            View chart →
          </a>
        ) : (
          <span />
        )}
        <span title={new Date(signal.createdAt).toLocaleString()}>{new Date(signal.createdAt).toLocaleString()}</span>
      </div>
      <p className="text-[10px] text-zinc-700 leading-snug mt-2">{m.disclaimer}</p>
    </div>
  );
}

function PnlBadge({ entryPrice, currentPrice }: { entryPrice: string | null; currentPrice: string | null }) {
  if (!entryPrice || !currentPrice) return null;
  const entry = parseFloat(entryPrice);
  const current = parseFloat(currentPrice);
  if (!entry || Number.isNaN(current)) return null;

  const pct = ((current - entry) / entry) * 100;
  const positive = pct >= 0;

  return (
    <span
      title="Change since the signal's entry price"
      className={`text-xs font-mono font-semibold px-2 py-0.5 rounded ${
        positive ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
      }`}
    >
      {positive ? "+" : ""}
      {pct.toFixed(1)}% since entry
    </span>
  );
}
