"use client";

import { useEffect, useState, useCallback } from "react";
import SignalCard from "@/components/SignalCard";

const CHAINS = ["All", "Solana", "Base", "BNB", "Ethereum", "Arbitrum", "Polygon", "Avalanche", "Optimism"];
const TYPES = ["All", "BUY", "SELL", "ALERT", "LAUNCH"];

export default function DashboardFeed() {
  const [chain, setChain] = useState("All");
  const [type, setType] = useState("All");
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [signals, setSignals] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchSignals = useCallback(async () => {
    const params = new URLSearchParams({
      chain,
      type,
      page: String(page),
      watchlist: String(watchlistOnly),
    });
    const res = await fetch(`/api/signals?${params}`);
    if (res.ok) {
      const data = await res.json();
      setSignals(data.signals);
      setTotal(data.total);
    }
    setLoading(false);
  }, [chain, type, page, watchlistOnly]);

  useEffect(() => {
    setLoading(true);
    fetchSignals();
    // Poll for new signals every 20s so the feed stays live without a manual refresh
    const interval = setInterval(fetchSignals, 20000);
    return () => clearInterval(interval);
  }, [fetchSignals]);

  async function toggleWatchlist(signalId: string) {
    const res = await fetch("/api/signals/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signal_id: signalId }),
    });
    if (res.ok) fetchSignals();
  }

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Select value={chain} onChange={(v) => { setChain(v); setPage(1); }} options={CHAINS} />
        <Select value={type} onChange={(v) => { setType(v); setPage(1); }} options={TYPES} />
        <button
          onClick={() => { setWatchlistOnly((w) => !w); setPage(1); }}
          className={`text-sm px-3 py-2 rounded-lg border transition-colors ${
            watchlistOnly
              ? "bg-accent-500/15 text-accent-400 border-accent-500/30"
              : "bg-base-900 text-zinc-400 border-base-700 hover:border-base-600"
          }`}
        >
          ★ Watchlist
        </button>
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading signals...</p>
      ) : signals.length === 0 ? (
        <p className="text-zinc-500 text-sm">No signals match these filters yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {signals.map((s) => (
            <SignalCard key={s.id} signal={s} onToggleWatchlist={toggleWatchlist} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-8">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="text-sm text-zinc-500 hover:text-white disabled:opacity-30 transition-colors"
          >
            ← Prev
          </button>
          <span className="text-sm text-zinc-600">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="text-sm text-zinc-500 hover:text-white disabled:opacity-30 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-base-900 border border-base-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:border-accent-400 outline-none"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
