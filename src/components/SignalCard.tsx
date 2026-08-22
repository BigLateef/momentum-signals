"use client";

import { useState } from "react";
import SafetyPanel from "./SafetyPanel";
import SafetyReportModal from "./SafetyReportModal";
import ExecutionStatus from "./ExecutionStatus";

type Signal = {
  id: string;
  tokenName: string;
  ticker: string;
  chain: string;
  signalType: "BUY" | "SELL" | "ALERT" | "LAUNCH";
  entryPrice: string | null;
  currentPrice: string | null;
  targetPrice1: string | null;
  targetPrice2: string | null;
  stopLoss: string | null;
  momentumScore: number | null;
  confidence: "LOW" | "MEDIUM" | "HIGH" | null;
  reason: string | null;
  chartUrl: string | null;
  createdAt: string;
  isWatchlisted?: boolean;
  kolSummary?: string | null;
  contractAddress?: string | null;
  rugRiskScore?: number | null;
  safetyScore?: number | null;
  safetyVerdict?: string | null;
  safetyCheckedAt?: string | null;
  safetyOverride?: boolean;
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

export default function SignalCard({
  signal,
  onToggleWatchlist,
}: {
  signal: Signal;
  onToggleWatchlist?: (id: string) => void;
}) {
  const [showReport, setShowReport] = useState(false);

  return (
    <div className="bg-base-900 border border-base-800 rounded-lg p-4 hover:border-base-700 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded border ${TYPE_STYLES[signal.signalType]}`}
          >
            {signal.signalType}
          </span>
          <span className="text-xs px-2 py-0.5 rounded bg-base-800 text-zinc-400 border border-base-700">
            {signal.chain}
          </span>
        </div>
        <button
          onClick={() => onToggleWatchlist?.(signal.id)}
          aria-label="Toggle watchlist"
          className={`text-lg leading-none ${signal.isWatchlisted ? "text-accent-400" : "text-zinc-600 hover:text-zinc-400"}`}
        >
          {signal.isWatchlisted ? "★" : "☆"}
        </button>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-white font-semibold">{signal.tokenName}</p>
          <p className="text-zinc-500 text-sm font-mono">${signal.ticker}</p>
        </div>
        <PnlBadge entryPrice={signal.entryPrice} currentPrice={signal.currentPrice} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
        <PriceStat label="Entry" value={signal.entryPrice} />
        <PriceStat label="TP1" value={signal.targetPrice1} />
        <PriceStat label="TP2" value={signal.targetPrice2} />
        <PriceStat label="Stop" value={signal.stopLoss} />
      </div>

      {signal.momentumScore != null && (
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-xs text-zinc-500 mr-1">Momentum</span>
          {Array.from({ length: 10 }).map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full ${
                i < signal.momentumScore! ? "bg-accent-400" : "bg-base-700"
              }`}
            />
          ))}
        </div>
      )}

      {signal.confidence && (
        <p className={`text-xs font-medium mb-2 ${CONFIDENCE_STYLES[signal.confidence]}`}>
          {signal.confidence} confidence
        </p>
      )}

      {signal.reason && (
        <p className="text-sm text-zinc-400 leading-relaxed mb-3">{signal.reason}</p>
      )}

      <SafetyPanel
        props={{
          rugRiskScore: signal.rugRiskScore ?? null,
          safetyScore: signal.safetyScore ?? null,
          safetyVerdict: signal.safetyVerdict ?? null,
          safetyCheckedAt: signal.safetyCheckedAt ?? null,
          safetyOverride: signal.safetyOverride,
        }}
        onViewReport={signal.contractAddress ? () => setShowReport(true) : undefined}
      />

      <ExecutionStatus execution={signal.latestExecution} />

      {showReport && signal.contractAddress && (
        <SafetyReportModal
          chain={signal.chain}
          tokenAddress={signal.contractAddress}
          onClose={() => setShowReport(false)}
        />
      )}

      {signal.kolSummary && (
        <p className="text-xs text-purple-400 bg-purple-500/10 border border-purple-500/20 rounded px-2 py-1 mb-3">
          🐋 {signal.kolSummary}
        </p>
      )}

      <div className="flex items-center justify-between text-xs text-zinc-600 pt-2 border-t border-base-800">
        {signal.chartUrl ? (
          <a
            href={signal.chartUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-400 hover:underline"
          >
            View chart →
          </a>
        ) : (
          <span />
        )}
        <span>{new Date(signal.createdAt).toLocaleString()}</span>
      </div>
    </div>
  );
}

function PnlBadge({
  entryPrice,
  currentPrice,
}: {
  entryPrice: string | null;
  currentPrice: string | null;
}) {
  if (!entryPrice || !currentPrice) return null;
  const entry = parseFloat(entryPrice);
  const current = parseFloat(currentPrice);
  if (!entry || Number.isNaN(current)) return null;

  const pct = ((current - entry) / entry) * 100;
  const positive = pct >= 0;

  return (
    <span
      className={`text-xs font-mono font-semibold px-2 py-0.5 rounded ${
        positive ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
      }`}
    >
      {positive ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

function PriceStat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="bg-base-800/50 rounded px-2 py-1.5">
      <p className="text-zinc-600">{label}</p>
      <p className="text-zinc-200 font-mono">{value ? `$${value}` : "—"}</p>
    </div>
  );
}
