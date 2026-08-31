"use client";

import { useEffect, useState, useCallback } from "react";

const CHAINS = ["Solana", "Base", "BNB", "Ethereum", "Arbitrum", "Polygon", "Avalanche", "Optimism"];

export default function KolWalletsTab() {
  const [wallets, setWallets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [chain, setChain] = useState("Solana");
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchWallets = useCallback(async () => {
    const res = await fetch("/api/admin/kol-wallets");
    if (res.ok) {
      const data = await res.json();
      setWallets(data.wallets);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/admin/kol-wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chain, address, label }),
    });
    if (res.ok) {
      setAddress("");
      setLabel("");
      fetchWallets();
    }
    setSaving(false);
  }

  async function handleRemove(id: string) {
    await fetch("/api/admin/kol-wallets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchWallets();
  }

  return (
    <div className="space-y-6">
      <div className="bg-base-900 border border-base-800 rounded-lg p-4">
        <p className="text-sm text-zinc-400 leading-relaxed">
          Track known KOL/influencer wallets here. When the scanner posts a signal, it checks
          whether any tracked wallet appears among that token's top holders (via the chain's
          block explorer API) and shows a badge if so.{" "}
          <strong className="text-zinc-300">
            Requires an explorer API key configured per chain
          </strong>{" "}
          — see the README. Chains without a key configured are silently skipped, not treated
          as an error.
        </p>
      </div>

      <form onSubmit={handleAdd} className="bg-base-900 border border-base-800 rounded-lg p-5">
        <p className="text-sm font-semibold text-white mb-4">Add tracked wallet</p>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Chain</label>
            <select value={chain} onChange={(e) => setChain(e.target.value)} className="input">
              {CHAINS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-zinc-500 mb-1 block">Wallet address</label>
            <input
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x... or Solana address"
              className="input font-mono text-xs"
            />
          </div>
        </div>
        <div className="mb-4">
          <label className="text-xs text-zinc-500 mb-1 block">Label</label>
          <input
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. @SomeKolHandle"
            className="input"
          />
        </div>
        <button
          disabled={saving}
          className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-base-950 font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
        >
          {saving ? "Adding..." : "Add wallet"}
        </button>
      </form>

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading...</p>
      ) : (
        <div className="bg-base-900 border border-base-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-base-800/50 text-zinc-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Label</th>
                <th className="text-left px-4 py-2.5">Chain</th>
                <th className="text-left px-4 py-2.5">Address</th>
                <th className="text-left px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {wallets.map((w) => (
                <tr key={w.id} className="border-t border-base-800">
                  <td className="px-4 py-2.5 text-zinc-200">{w.label}</td>
                  <td className="px-4 py-2.5 text-zinc-400">{w.chain}</td>
                  <td className="px-4 py-2.5 text-zinc-500 font-mono text-xs">
                    {w.address.slice(0, 8)}...{w.address.slice(-6)}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => handleRemove(w.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {wallets.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-zinc-600">
                    No tracked wallets yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

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
