"use client";

import { useRouter } from "next/navigation";

export default function TopBar({ email, isAdmin }: { email: string; isAdmin: boolean }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  return (
    <header className="border-b border-base-800 bg-base-900/50 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-bold text-white tracking-tight">Momentum Signals</span>
          {isAdmin && (
            <a
              href="/admin"
              className="text-xs px-2 py-0.5 rounded bg-accent-500/15 text-accent-400 border border-accent-500/30"
            >
              Admin
            </a>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-500">{email}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-zinc-500 hover:text-red-400 transition-colors"
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
