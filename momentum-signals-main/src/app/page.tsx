"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LandingPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (code.length !== 6) {
      setError("Enter your 6-character invite code.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/invite/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.toUpperCase() }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        router.push(`/auth/login?code=${code.toUpperCase()}`);
      } else {
        setError(data.error ?? "Invalid invite code.");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <p className="font-mono text-xs tracking-[0.3em] text-accent-400 uppercase mb-3">
            Access Restricted
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-white">
            Momentum Signals
          </h1>
          <p className="mt-2 text-zinc-400">Lateef&apos;s Alpha Terminal</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
            placeholder="INVITE CODE"
            maxLength={6}
            className="w-full bg-base-900 border border-base-700 rounded-lg px-4 py-3 text-center font-mono text-lg tracking-[0.3em] text-white placeholder:text-zinc-600 focus:border-accent-400 outline-none transition-colors"
          />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-base-950 font-semibold rounded-lg py-3 transition-colors"
          >
            {loading ? "Checking..." : "Enter"}
          </button>
        </form>

        <button
          onClick={() => router.push("/auth/login")}
          className="w-full text-center text-sm text-zinc-500 hover:text-accent-400 mt-4 transition-colors"
        >
          Already have an account? Log in
        </button>

        <div className="grid grid-cols-3 gap-3 mt-12">
          <FeatureCard title="Momentum Signals" desc="Real-time BUY/SELL/ALERT calls with score & confidence." />
          <FeatureCard title="Gated Access" desc="Invite-only entry. No public sign-ups." />
          <FeatureCard title="Admin Control" desc="Full control over codes, signals, and access." />
        </div>
      </div>
    </main>
  );
}

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="bg-base-900 border border-base-800 rounded-lg p-4">
      <p className="text-sm font-semibold text-white mb-1">{title}</p>
      <p className="text-xs text-zinc-500 leading-relaxed">{desc}</p>
    </div>
  );
}
