"use client";

import { useEffect, useState } from "react";

export default function AuditLogTab() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/audit-log?page=${page}`)
      .then((r) => r.json())
      .then((data) => {
        setEntries(data.entries);
        setTotal(data.total);
        setLoading(false);
      });
  }, [page]);

  const pageSize = 30;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function actionColor(action: string) {
    if (action.includes("revoke") || action.includes("deactivate")) return "text-red-400";
    if (action.includes("post") || action.includes("generate") || action.includes("add"))
      return "text-emerald-400";
    return "text-zinc-400";
  }

  return (
    <div>
      {loading ? (
        <p className="text-zinc-500 text-sm">Loading...</p>
      ) : (
        <div className="bg-base-900 border border-base-800 rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-base-800/50 text-zinc-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Action</th>
                <th className="text-left px-4 py-2.5">Actor</th>
                <th className="text-left px-4 py-2.5">Target</th>
                <th className="text-left px-4 py-2.5">When</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-base-800">
                  <td className={`px-4 py-2.5 font-mono text-xs ${actionColor(e.action)}`}>
                    {e.action}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400">{e.actorLabel ?? "—"}</td>
                  <td className="px-4 py-2.5 text-zinc-500 text-xs">
                    {e.targetType ? `${e.targetType}${e.targetId ? ` · ${e.targetId.slice(0, 8)}...` : ""}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500 text-xs">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-zinc-600">
                    No activity logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="text-sm text-zinc-500 hover:text-white disabled:opacity-30"
          >
            ← Prev
          </button>
          <span className="text-sm text-zinc-600">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="text-sm text-zinc-500 hover:text-white disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
