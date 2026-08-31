"use client";

import { useEffect, useState } from "react";

export default function PerformanceTab() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => r.json())
      .then((data) => {
        setStats(data);
        setLoading(false);
      });
  }, []);

  if (loading) return <p className="text-zinc-500 text-sm">Loading...</p>;
  if (!stats || stats.totalSignals === 0) {
    return (
      <p className="text-zinc-500 text-sm">
        No priced signals yet — stats appear once signals have entry/current prices (the
        scanner and price-refresh cron populate these automatically).
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <StatCard title="Closed signals" data={stats.closed} />
        <StatCard title="Open signals (unrealized)" data={stats.open} />
      </div>

      <div className="bg-base-900 border border-base-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-base-800">
          <p className="text-sm font-semibold text-white">By chain</p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-base-800/50 text-zinc-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Chain</th>
              <th className="text-left px-4 py-2.5">Signals</th>
              <th className="text-left px-4 py-2.5">Win rate</th>
              <th className="text-left px-4 py-2.5">Avg return</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(stats.byChain).map(([chain, data]: [string, any]) => (
              <tr key={chain} className="border-t border-base-800">
                <td className="px-4 py-2.5 text-zinc-200">{chain}</td>
                <td className="px-4 py-2.5 text-zinc-500">{data.count}</td>
                <td className="px-4 py-2.5 text-zinc-400">{data.winRate.toFixed(0)}%</td>
                <td
                  className={`px-4 py-2.5 font-mono ${
                    data.avgReturn >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {data.avgReturn >= 0 ? "+" : ""}
                  {data.avgReturn.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-600">
        "Closed" = deactivated signals (return is realized/frozen at deactivation). "Open" =
        still-active signals (return is unrealized, based on the latest price-refresh cron run).
      </p>
    </div>
  );
}

function StatCard({ title, data }: { title: string; data: any }) {
  if (!data || data.count === 0) {
    return (
      <div className="bg-base-900 border border-base-800 rounded-lg p-4">
        <p className="text-sm font-semibold text-white mb-2">{title}</p>
        <p className="text-zinc-600 text-sm">No data yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-base-900 border border-base-800 rounded-lg p-4">
      <p className="text-sm font-semibold text-white mb-3">{title}</p>
      <div className="grid grid-cols-2 gap-3 text-sm mb-3">
        <Stat label="Count" value={data.count} />
        <Stat label="Win rate" value={`${data.winRate.toFixed(0)}%`} />
        <Stat
          label="Avg return"
          value={`${data.avgReturn >= 0 ? "+" : ""}${data.avgReturn.toFixed(1)}%`}
          positive={data.avgReturn >= 0}
        />
      </div>
      {data.best && (
        <p className="text-xs text-zinc-500">
          Best: <span className="text-emerald-400">${data.best.ticker}</span>{" "}
          {data.best.returnPct >= 0 ? "+" : ""}
          {data.best.returnPct.toFixed(1)}%
        </p>
      )}
      {data.worst && (
        <p className="text-xs text-zinc-500">
          Worst: <span className="text-red-400">${data.worst.ticker}</span>{" "}
          {data.worst.returnPct.toFixed(1)}%
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  positive,
}: {
  label: string;
  value: string | number;
  positive?: boolean;
}) {
  return (
    <div>
      <p className="text-zinc-600 text-xs">{label}</p>
      <p
        className={`font-mono font-semibold ${
          positive === undefined ? "text-zinc-200" : positive ? "text-emerald-400" : "text-red-400"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
