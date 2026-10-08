"use client";

import { useState } from "react";
import InviteCodesTab from "./InviteCodesTab";
import SignalsTab from "./SignalsTab";
import PostSignalTab from "./PostSignalTab";
import UsersTab from "./UsersTab";
import AuditLogTab from "./AuditLogTab";
import KolWalletsTab from "./KolWalletsTab";
import PerformanceTab from "./PerformanceTab";
import AutoTradeTab from "./AutoTradeTab";

const TABS = [
  "Invite Codes",
  "Signals",
  "Post Signal",
  "Users",
  "KOL Wallets",
  "Performance",
  "Auto-Trade",
  "Audit Log",
] as const;
type Tab = (typeof TABS)[number];

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>("Invite Codes");

  return (
    <div>
      <div className="flex gap-1 mb-6 border-b border-base-800 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              tab === t
                ? "border-accent-400 text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Invite Codes" && <InviteCodesTab />}
      {tab === "Signals" && <SignalsTab />}
      {tab === "Post Signal" && <PostSignalTab />}
      {tab === "Users" && <UsersTab />}
      {tab === "KOL Wallets" && <KolWalletsTab />}
      {tab === "Performance" && <PerformanceTab />}
      {tab === "Auto-Trade" && <AutoTradeTab />}
      {tab === "Audit Log" && <AuditLogTab />}
    </div>
  );
}
