"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const codeFromUrl = searchParams.get("code") ?? "";

  const [mode, setMode] = useState<"signup" | "login">(codeFromUrl ? "signup" : "login");
  const [code, setCode] = useState(codeFromUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const body =
        mode === "signup" ? { email, password, code } : { email, password };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        router.push("/auth/dashboard");
      } else {
        setError(data.error ?? "Something went wrong.");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-bold text-white mb-1">
        {mode === "signup" ? "Create your account" : "Welcome back"}
      </h1>
      <p className="text-zinc-500 text-sm mb-6">
        {mode === "signup"
          ? "Invite code verified — set up your login."
          : "Sign in to view live signals."}
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === "signup" && (
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Invite code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="INVITE CODE"
              maxLength={6}
              className="w-full bg-base-900 border border-base-700 rounded-lg px-4 py-2.5 text-white font-mono tracking-widest placeholder:text-zinc-600 focus:border-accent-400 outline-none transition-colors"
            />
          </div>
        )}
        <div>
          <label className="text-xs text-zinc-500 mb-1 block">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-base-900 border border-base-700 rounded-lg px-4 py-2.5 text-white focus:border-accent-400 outline-none transition-colors"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-500 mb-1 block">Password</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-base-900 border border-base-700 rounded-lg px-4 py-2.5 text-white focus:border-accent-400 outline-none transition-colors"
          />
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-base-950 font-semibold rounded-lg py-2.5 transition-colors"
        >
          {loading ? "Please wait..." : mode === "signup" ? "Create account" : "Log in"}
        </button>
      </form>

      <button
        onClick={() => setMode(mode === "signup" ? "login" : "signup")}
        className="w-full text-center text-sm text-zinc-500 hover:text-accent-400 mt-4 transition-colors"
      >
        {mode === "signup"
          ? "Already have an account? Log in"
          : "Have an invite code? Sign up"}
      </button>
    </div>
  );
}
