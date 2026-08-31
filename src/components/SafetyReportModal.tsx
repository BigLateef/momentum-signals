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
  rawProviderResponses?: { rugcheck?: string | null; goplus?: string | null } | null;
  analyzedAt: string;
};

const STATUS_STYLES: Record<string, string> = {
  PASS: "text-emerald-400",
  WARNING: "text-yellow-400",
  FAIL: "text-red-400",
  UNKNOWN: "text-zinc-500",
};

// Plain-text rendering of the full report — designed to be pasted somewhere
// else (a chat, a support ticket, Discord) and still be fully readable
// without any of the UI around it.
function formatReportAsText(report: SafetyReport, chain: string, tokenAddress: string): string {
  const lines: string[] = [];
  lines.push(`Safety report — ${chain} ${tokenAddress}`);
  lines.push(`Verdict: ${report.verdict}`);
  lines.push(`Risk score: ${report.rugRiskScore} · Safety score: ${report.safetyScore}`);
  lines.push(`Analyzed: ${new Date(report.analyzedAt).toLocaleString()}`);
  lines.push("");
  lines.push("Checks:");
  for (const c of report.checks) {
    lines.push(
      `- [${c.status}${c.scoreImpact > 0 ? ` -${c.scoreImpact}` : ""}] ${c.label}: ${c.explanation} (source: ${c.source})`
    );
  }
  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of report.warnings) lines.push(`- ${w}`);
  }
  lines.push("");
  lines.push("Provider status:");
  for (const [source, status] of Object.entries(report.dataSources)) {
    lines.push(`- ${source}: ${status}`);
  }
  if (report.rawProviderResponses?.rugcheck || report.rawProviderResponses?.goplus) {
    lines.push("");
    lines.push("Raw provider response (most recent sample, for debugging field mappings):");
    if (report.rawProviderResponses.rugcheck) {
      lines.push("--- rugcheck ---");
      lines.push(report.rawProviderResponses.rugcheck);
    }
    if (report.rawProviderResponses.goplus) {
      lines.push("--- goplus ---");
      lines.push(report.rawProviderResponses.goplus);
    }
  }
  return lines.join("\n");
}

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
  const [copied, setCopied] = useState(false);

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

  async function handleCopy() {
    if (!report) return;
    const text = formatReportAsText(report, chain, tokenAddress);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API can be unavailable (older browser, non-HTTPS,
      // permission denied) — fall back to a hidden-textarea copy so the
      // button still works instead of silently doing nothing.
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
      } catch {
        // Nothing more we can do — leave `copied` false so the button
        // doesn't falsely claim success.
        document.body.removeChild(textarea);
        return;
      }
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-base-900 border border-base-800 rounded-lg max-w-lg w-full max-h-[85vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Safety report</h3>
          <div className="flex items-center gap-3">
            {report && (
              <button
                onClick={handleCopy}
                className="text-xs text-zinc-400 hover:text-zinc-200 border border-base-700 rounded px-2 py-1"
              >
                {copied ? "Copied ✓" : "Copy report"}
              </button>
            )}
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">
              ✕
            </button>
          </div>
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

            {(report.rawProviderResponses?.rugcheck || report.rawProviderResponses?.goplus) && (
              <details className="border-t border-base-800 pt-3 mt-3">
                <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300">
                  Raw provider response (debug — for fixing field mappings)
                </summary>
                {report.rawProviderResponses.rugcheck && (
                  <pre className="text-[10px] text-zinc-500 bg-base-800/50 rounded p-2 mt-2 overflow-x-auto whitespace-pre-wrap break-all">
                    {report.rawProviderResponses.rugcheck}
                  </pre>
                )}
                {report.rawProviderResponses.goplus && (
                  <pre className="text-[10px] text-zinc-500 bg-base-800/50 rounded p-2 mt-2 overflow-x-auto whitespace-pre-wrap break-all">
                    {report.rawProviderResponses.goplus}
                  </pre>
                )}
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
