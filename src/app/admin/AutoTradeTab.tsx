"use client";

import { useEffect, useState, useCallback } from "react";
import SafetyReportModal from "@/components/SafetyReportModal";

const STATUS_FILTERS = ["All", "SUBMITTED,CONFIRMED,DRY_RUN", "SKIPPED", "FAILED"] as const;
const STATUS_LABELS: Record<string, string> = {
  All: "All",
  "SUBMITTED,CONFIRMED,DRY_RUN": "Executed",
  SKIPPED: "Skipped",
  FAILED: "Failed",
};

export default function AutoTradeTab() {
  const [killSwitch, setKillSwitch] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("All");
  const [executions, setExecutions] = useState<any[]>([]);
  const [reportTarget, setReportTarget] = useState<{ chain: string; tokenAddress: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const fetchKillSwitch = useCallback(async () => {
    const res = await fetch("/api/admin/trading/kill-switch");
    if (res.ok) {
      const data = await res.json();
      setKillSwitch(data.engaged);
    }
  }, []);

  const fetchExecutions = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter !== "All") params.set("status", filter);
    const res = await fetch(`/api/admin/trading/executions?${params}`);
    if (res.ok) {
      const data = await res.json();
      setExecutions(data.executions);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchKillSwitch();
  }, [fetchKillSwitch]);

  useEffect(() => {
    setLoading(true);
    fetchExecutions();
  }, [fetchExecutions]);

  async function toggleKillSwitch() {
    if (killSwitch == null) return;
    setToggling(true);
    const res = await fetch("/api/admin/trading/kill-switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engaged: !killSwitch }),
    });
    if (res.ok) {
      const data = await res.json();
      setKillSwitch(data.engaged);
    }
    setToggling(false);
  }

  return (
    <div>
      <div
        className={`rounded-lg border p-4 mb-6 flex items-center justify-between ${
          killSwitch
            ? "bg-red-500/10 border-red-500/30"
            : "bg-emerald-500/10 border-emerald-500/30"
        }`}
      >
        <div>
          <p className="text-white font-semibold mb-0.5">
            Emergency kill switch: {killSwitch == null ? "…" : killSwitch ? "ENGAGED" : "Off"}
          </p>
          <p className="text-xs text-zinc-400">
            {killSwitch
              ? "All automated trading is blocked, regardless of AUTO_TRADE_ENABLED."
              : "Automated trading follows AUTO_TRADE_ENABLED / AUTO_TRADE_DRY_RUN as configured."}
          </p>
        </div>
        <button
          onClick={toggleKillSwitch}
          disabled={killSwitch == null || toggling}
          className={`text-sm font-semibold px-4 py-2 rounded transition-colors ${
            killSwitch
              ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30"
              : "bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
          }`}
        >
          {toggling ? "…" : killSwitch ? "Disengage" : "Engage kill switch"}
        </button>
      </div>

      <div className="flex gap-1 mb-4">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded border ${
              filter === f
                ? "bg-accent-400/15 border-accent-400/40 text-accent-400"
                : "border-base-800 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {STATUS_LABELS[f]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : (
        <div className="bg-base-900 border border-base-800 rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-base-800/50 text-zinc-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Token</th>
                <th className="text-left px-4 py-2.5">Action</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Amount</th>
                <th className="text-left px-4 py-2.5">Reason</th>
                <th className="text-left px-4 py-2.5">Tx</th>
                <th className="text-left px-4 py-2.5">When</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((row) => (
                <tr key={row.execution.id} className="border-t border-base-800">
                  <td className="px-4 py-2.5 text-zinc-200">
                    {row.tokenName ?? "—"} <span className="text-zinc-600">${row.ticker ?? "?"}</span>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400">{row.execution.action}</td>
                  <td className="px-4 py-2.5 text-zinc-400">
                    {row.execution.dryRun && row.execution.status !== "SKIPPED" ? "DRY RUN · " : ""}
                    {row.execution.status}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400 font-mono">
                    {row.execution.amountIn ?? "—"} {row.execution.baseCurrency}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">
                    {row.execution.skipReason === "SAFETY_BLOCKED" ? (
                      <button
                        onClick={() =>
                          setReportTarget({ chain: row.execution.chain, tokenAddress: row.execution.tokenAddress })
                        }
                        className="text-accent-400 hover:underline"
                        title="View full safety report"
                      >
                        {row.execution.skipReason}
                      </button>
                    ) : (
                      row.execution.skipReason ?? "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500 font-mono">
                    {row.execution.transactionId ? `${row.execution.transactionId.slice(0, 10)}…` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-600">
                    {new Date(row.execution.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {executions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-zinc-600">
                    No executions match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {reportTarget && (
        <SafetyReportModal
          chain={reportTarget.chain}
          tokenAddress={reportTarget.tokenAddress}
          onClose={() => setReportTarget(null)}
        />
      )}
    </div>
  );
}
