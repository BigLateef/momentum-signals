"use client";

import { useState } from "react";

const CHAINS = ["Solana", "Base", "BNB", "Ethereum", "Arbitrum", "Polygon", "Avalanche", "Optimism"];
const TYPES = ["BUY", "SELL", "ALERT", "LAUNCH"];
const CONFIDENCE = ["LOW", "MEDIUM", "HIGH"];

const empty = {
  token_name: "",
  ticker: "",
  contract_address: "",
  chain: "Solana",
  exchange: "",
  signal_type: "BUY",
  entry_price: "",
  target_price_1: "",
  target_price_2: "",
  stop_loss: "",
  momentum_score: 5,
  reason: "",
  chart_url: "",
  confidence: "MEDIUM",
};

export default function PostSignalTab() {
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  function set<K extends keyof typeof empty>(key: K, value: (typeof empty)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const payload = {
      ...form,
      entry_price: form.entry_price ? Number(form.entry_price) : null,
      target_price_1: form.target_price_1 ? Number(form.target_price_1) : null,
      target_price_2: form.target_price_2 ? Number(form.target_price_2) : null,
      stop_loss: form.stop_loss ? Number(form.stop_loss) : null,
      momentum_score: Number(form.momentum_score),
    };

    const res = await fetch("/api/signals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      setMessage("Signal posted.");
      setForm(empty);
    } else {
      const data = await res.json();
      setMessage(data.error ?? "Failed to post signal.");
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="bg-base-900 border border-base-800 rounded-lg p-5 max-w-2xl space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Token name">
          <input required value={form.token_name} onChange={(e) => set("token_name", e.target.value)} className="input" />
        </Field>
        <Field label="Ticker">
          <input required value={form.ticker} onChange={(e) => set("ticker", e.target.value)} className="input" />
        </Field>
      </div>

      <Field label="Contract address (optional)">
        <input value={form.contract_address} onChange={(e) => set("contract_address", e.target.value)} className="input" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Chain">
          <select value={form.chain} onChange={(e) => set("chain", e.target.value)} className="input">
            {CHAINS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Exchange (optional)">
          <input value={form.exchange} onChange={(e) => set("exchange", e.target.value)} className="input" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Signal type">
          <select value={form.signal_type} onChange={(e) => set("signal_type", e.target.value)} className="input">
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Confidence">
          <select value={form.confidence} onChange={(e) => set("confidence", e.target.value)} className="input">
            {CONFIDENCE.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Field label="Entry price">
          <input type="number" step="any" value={form.entry_price} onChange={(e) => set("entry_price", e.target.value)} className="input" />
        </Field>
        <Field label="TP1">
          <input type="number" step="any" value={form.target_price_1} onChange={(e) => set("target_price_1", e.target.value)} className="input" />
        </Field>
        <Field label="TP2">
          <input type="number" step="any" value={form.target_price_2} onChange={(e) => set("target_price_2", e.target.value)} className="input" />
        </Field>
        <Field label="Stop loss">
          <input type="number" step="any" value={form.stop_loss} onChange={(e) => set("stop_loss", e.target.value)} className="input" />
        </Field>
      </div>

      <Field label={`Momentum score: ${form.momentum_score}/10`}>
        <input
          type="range"
          min={1}
          max={10}
          value={form.momentum_score}
          onChange={(e) => set("momentum_score", Number(e.target.value))}
          className="w-full accent-accent-500"
        />
      </Field>

      <Field label="Reason">
        <textarea
          rows={3}
          value={form.reason}
          onChange={(e) => set("reason", e.target.value)}
          className="input resize-none"
        />
      </Field>

      <Field label="Chart URL (optional)">
        <input value={form.chart_url} onChange={(e) => set("chart_url", e.target.value)} className="input" />
      </Field>

      {message && <p className="text-sm text-accent-400">{message}</p>}

      <button
        disabled={loading}
        className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-base-950 font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
      >
        {loading ? "Posting..." : "Post signal"}
      </button>

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
    </form>
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
