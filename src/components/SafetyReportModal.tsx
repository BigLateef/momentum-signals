"use client";

import { useEffect, useState } from "react";

type SafetyCheck = {
  id: string;
  label: string;
  status: "PASS" | "WARNING" | "FAIL" | "UNKNOWN";
  explanation: string;
  scoreImpact: number;
  source: string;
};

type SafetyReport = {
  tokenAddress: string;
  chain: string;
  rugRiskScore: number;
  safetyScore: number;
  verdict: string;
  checks: SafetyCheck[];
  warnings: string[];
  dataSources: Record<string, "ok" | "unavailable" | "error">;
  analyzedAt: string;
};

const STATUS_STYLES: Record<string, string> = {
  PASS: "text-emerald-400",
  WARNING: "text-yellow-400",
  FAIL: "text-red-400",
  UNKNOWN: "text-zinc-500",
};

export default function SafetyReportModal({
  chain,
  tokenAddress,
  onClose,
}: {
  chain: string;
  tokenAddress: string;
  onClose: () => void;
}) {
  const [report, setReport] = useState<SafetyReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/safety/${tokenAddress}?chain=${encodeURIComponent(chain)}`);
      if (!cancelled && res.ok) {
        const data = await res.json();
        setReport(data.report);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [chain, tokenAddress]);

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-base-900 border border-base-800 rounded-lg max-w-lg w-full max-h-[85vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Safety report</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">
            ✕
          </button>
        </div>

        {loading && <p className="text-zinc-500 text-sm">Loading…</p>}
        {!loading && !report && (
          <p className="text-zinc-500 text-sm">No safety report on file for this token yet.</p>
        )}

        {report && (
          <>
            <div className="flex items-center justify-between mb-3 text-sm">
              <span className="text-zinc-400">
                Verdict: <span className="text-white font-semibold">{report.verdict.replace(/_/g, " ")}</span>
              </span>
              <span className="text-zinc-400 font-mono">
                Risk {report.rugRiskScore} · Safety {report.safetyScore}
              </span>
            </div>
            <p className="text-xs text-zinc-600 mb-4">
              Last analyzed {new Date(report.analyzedAt).toLocaleString()}
            </p>

            <div className="space-y-2 mb-4">
              {report.checks.map((c) => (
                <div key={c.id} className="bg-base-800/50 rounded px-3 py-2 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-zinc-200 font-medium">{c.label}</span>
                    <span className={`font-semibold ${STATUS_STYLES[c.status]}`}>
                      {c.status}
                      {c.scoreImpact > 0 ? ` (-${c.scoreImpact})` : ""}
                    </span>
                  </div>
                  <p className="text-zinc-500">{c.explanation}</p>
                  <p className="text-zinc-700 mt-1">source: {c.source}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-base-800 pt-3">
              <p className="text-xs text-zinc-500 mb-1.5">Provider status</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(report.dataSources).map(([source, status]) => (
                  <span
                    key={source}
                    className={`text-[11px] px-1.5 py-0.5 rounded border ${
                      status === "ok"
                        ? "border-emerald-500/30 text-emerald-400"
                        : "border-zinc-700 text-zinc-500"
                    }`}
                  >
                    {source}: {status}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
