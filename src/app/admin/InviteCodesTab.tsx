"use client";

import { useEffect, useState, useCallback } from "react";

export default function InviteCodesTab() {
  const [quantity, setQuantity] = useState(5);
  const [expiresDays, setExpiresDays] = useState(30);
  const [generated, setGenerated] = useState<string[]>([]);
  const [codes, setCodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState("");

  const fetchCodes = useCallback(async () => {
    const res = await fetch("/api/invite/list");
    if (res.ok) {
      const data = await res.json();
      setCodes(data.codes);
    }
  }, []);

  useEffect(() => {
    fetchCodes();
  }, [fetchCodes]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/invite/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        count: quantity,
        expires_in_days: expiresDays,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setGenerated(data.codes);
      fetchCodes();
    }
    setLoading(false);
  }

  async function handleRevoke(id: string) {
    await fetch("/api/invite/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchCodes();
  }

  function copy(code: string) {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(""), 1500);
  }

  function statusOf(c: any) {
    if (c.revoked) return { label: "Revoked", cls: "text-zinc-500" };
    if (c.expiresAt && new Date(c.expiresAt) < new Date())
      return { label: "Expired", cls: "text-red-400" };
    if (c.useCount >= c.maxUses) return { label: "Used", cls: "text-zinc-500" };
    return { label: "Available", cls: "text-emerald-400" };
  }

  return (
    <div className="space-y-8">
      <form onSubmit={handleGenerate} className="bg-base-900 border border-base-800 rounded-lg p-5">
        <p className="text-sm font-semibold text-white mb-1">Generate invite codes</p>
        <p className="text-xs text-zinc-500 mb-4">
          Every code is single-use — one signup, then it expires automatically.
        </p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Field label="Quantity (1–50)">
            <input
              type="number"
              min={1}
              max={50}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="input"
            />
          </Field>
          <Field label="Expires in (days, 1–90)">
            <input
              type="number"
              min={1}
              max={90}
              value={expiresDays}
              onChange={(e) => setExpiresDays(Number(e.target.value))}
              className="input"
            />
          </Field>
        </div>
        <button
          disabled={loading}
          className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-base-950 font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
        >
          {loading ? "Generating..." : "Generate"}
        </button>

        {generated.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mt-4">
            {generated.map((c) => (
              <button
                key={c}
                onClick={() => copy(c)}
                type="button"
                className="font-mono text-sm bg-base-800 hover:bg-base-700 border border-base-700 rounded px-3 py-2 text-center text-accent-400 transition-colors"
              >
                {copiedCode === c ? "Copied!" : c}
              </button>
            ))}
          </div>
        )}
      </form>

      <div className="bg-base-900 border border-base-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-base-800/50 text-zinc-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Code</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Used by</th>
              <th className="text-left px-4 py-2.5">Uses</th>
              <th className="text-left px-4 py-2.5">Created</th>
              <th className="text-left px-4 py-2.5">Expires</th>
              <th className="text-left px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => {
              const status = statusOf(c);
              return (
                <tr key={c.id} className="border-t border-base-800">
                  <td className="px-4 py-2.5 font-mono text-zinc-300">{c.code}</td>
                  <td className={`px-4 py-2.5 ${status.cls}`}>{status.label}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{c.usedByEmail ?? "—"}</td>
                  <td className="px-4 py-2.5 text-zinc-500">
                    {c.useCount}/{c.maxUses}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">
                    {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {!c.revoked && (
                      <button
                        onClick={() => handleRevoke(c.id)}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <style jsx global>{`
        .input {
          width: 100%;
          background: #18181b;
          border: 1px solid #3f3f46;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: #e4e4e7;
        }
        .input:focus {
          outline: none;
          border-color: #34d399;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-zinc-500 mb-1 block">{label}</label>
      {children}
    </div>
  );
}
