"use client";

import { useEffect, useState, useCallback } from "react";
import SafetyReportModal from "@/components/SafetyReportModal";

const VERDICT_STYLES: Record<string, string> = {
  LOW_RISK: "text-emerald-400",
  CAUTION: "text-yellow-400",
  HIGH_RISK: "text-orange-400",
  VERY_HIGH_RISK: "text-red-400",
  CRITICAL: "text-red-300",
  BLOCKED: "text-zinc-400",
  INSUFFICIENT_DATA: "text-zinc-600",
};

export default function SignalsTab() {
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<{ id: string; approve: boolean } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [reportTarget, setReportTarget] = useState<{ chain: string; contractAddress: string } | null>(null);

  const fetchAll = useCallback(async () => {
    const res = await fetch("/api/signals?chain=All&type=All&page=1&all=true");
    if (res.ok) {
      const data = await res.json();
      setSignals(data.signals);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function toggleActive(id: string, isActive: boolean) {
    await fetch(`/api/signals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !isActive }),
    });
    fetchAll();
  }

  async function runSafetyCheck(id: string, forceRefresh: boolean) {
    setBusyId(id);
    await fetch(`/api/signals/${id}/safety-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force_refresh: forceRefresh }),
    });
    await fetchAll();
    setBusyId(null);
  }

  async function submitOverride() {
    if (!overrideTarget || overrideReason.trim().length < 3) return;
    setBusyId(overrideTarget.id);
    await fetch("/api/admin/safety/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signal_id: overrideTarget.id,
        override: overrideTarget.approve,
        reason: overrideReason.trim(),
      }),
    });
    setOverrideTarget(null);
    setOverrideReason("");
    await fetchAll();
    setBusyId(null);
  }

  if (loading) return <p className="text-zinc-500 text-sm">Loading...</p>;

  return (
    <div className="bg-base-900 border border-base-800 rounded-lg overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-base-800/50 text-zinc-500 text-xs uppercase">
          <tr>
            <th className="text-left px-4 py-2.5">Token</th>
            <th className="text-left px-4 py-2.5">Ticker</th>
            <th className="text-left px-4 py-2.5">Type</th>
            <th className="text-left px-4 py-2.5">Chain</th>
            <th className="text-left px-4 py-2.5">Entry</th>
            <th className="text-left px-4 py-2.5">Score</th>
            <th className="text-left px-4 py-2.5">Safety</th>
            <th className="text-left px-4 py-2.5">Active</th>
            <th className="text-left px-4 py-2.5">Actions</th>
          </tr>
        </thead>
        <tbody>
          {signals.map((s) => (
            <tr key={s.id} className="border-t border-base-800">
              <td className="px-4 py-2.5 text-zinc-200">{s.tokenName}</td>
              <td className="px-4 py-2.5 text-zinc-500 font-mono">${s.ticker}</td>
              <td className="px-4 py-2.5 text-zinc-400">{s.signalType}</td>
              <td className="px-4 py-2.5 text-zinc-400">{s.chain}</td>
              <td className="px-4 py-2.5 text-zinc-400">{s.entryPrice ?? "—"}</td>
              <td className="px-4 py-2.5 text-zinc-400">{s.momentumScore ?? "—"}</td>
              <td className="px-4 py-2.5">
                {s.safetyVerdict ? (
                  <button
                    onClick={() =>
                      s.contractAddress && setReportTarget({ chain: s.chain, contractAddress: s.contractAddress })
                    }
                    className={`hover:underline ${VERDICT_STYLES[s.safetyVerdict] ?? "text-zinc-600"}`}
                    title="View full safety report"
                  >
                    {s.safetyVerdict.replace(/_/g, " ")}
                  </button>
                ) : (
                  <span className="text-zinc-600">Not checked</span>
                )}
                {s.safetyOverride && <span className="text-zinc-600 ml-1">(override)</span>}
              </td>
              <td className="px-4 py-2.5">
                {s.isActive ? (
                  <span className="text-emerald-400">Active</span>
                ) : (
                  <span className="text-zinc-600">Inactive</span>
                )}
              </td>
              <td className="px-4 py-2.5">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => runSafetyCheck(s.id, false)}
                    disabled={busyId === s.id}
                    className="text-xs text-accent-400 hover:text-accent-300"
                  >
                    Run safety
                  </button>
                  <button
                    onClick={() => runSafetyCheck(s.id, true)}
                    disabled={busyId === s.id}
                    className="text-xs text-accent-400 hover:text-accent-300"
                  >
                    Refresh
                  </button>
                  {s.safetyVerdict === "VERY_HIGH_RISK" && !s.safetyOverride && (
                    <button
                      onClick={() => setOverrideTarget({ id: s.id, approve: true })}
                      className="text-xs text-emerald-400 hover:text-emerald-300"
                    >
                      Approve override
                    </button>
                  )}
                  {!s.isActive && s.safetyVerdict && (
                    <button
                      onClick={() => setOverrideTarget({ id: s.id, approve: false })}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Block
                    </button>
                  )}
                  <button
                    onClick={() => toggleActive(s.id, s.isActive)}
                    className="text-xs text-zinc-400 hover:text-zinc-200"
                  >
                    {s.isActive ? "Deactivate" : "Reactivate"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {overrideTarget && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-base-900 border border-base-800 rounded-lg max-w-sm w-full p-5">
            <h3 className="text-white font-semibold mb-3">
              {overrideTarget.approve ? "Approve with override" : "Block signal"}
            </h3>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Reason (required, stored with your admin ID and timestamp)"
              className="w-full bg-base-800 border border-base-700 rounded px-3 py-2 text-sm text-zinc-200 mb-3"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setOverrideTarget(null);
                  setOverrideReason("");
                }}
                className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                onClick={submitOverride}
                disabled={overrideReason.trim().length < 3}
                className="text-xs bg-accent-400/20 text-accent-400 border border-accent-400/40 rounded px-3 py-1.5 hover:bg-accent-400/30 disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {reportTarget && (
        <SafetyReportModal
          chain={reportTarget.chain}
          tokenAddress={reportTarget.contractAddress}
          onClose={() => setReportTarget(null)}
        />
      )}
    </div>
  );
}
