"use client";

type SafetyCheck = {
  id: string;
  label: string;
  status: "PASS" | "WARNING" | "FAIL" | "UNKNOWN";
  explanation: string;
  scoreImpact: number;
  source: string;
};

export type SignalSafetyProps = {
  rugRiskScore: number | null;
  safetyScore: number | null;
  safetyVerdict: string | null;
  safetyCheckedAt: string | null;
  safetyOverride?: boolean;
};

const VERDICT_STYLES: Record<string, string> = {
  LOW_RISK: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  CAUTION: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  HIGH_RISK: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  VERY_HIGH_RISK: "bg-red-500/15 text-red-400 border-red-500/30",
  CRITICAL: "bg-red-600/20 text-red-300 border-red-600/40",
  BLOCKED: "bg-zinc-700/40 text-zinc-300 border-zinc-600/50",
  INSUFFICIENT_DATA: "bg-base-800 text-zinc-500 border-base-700",
};

function statusIcon(status?: string) {
  if (status === "PASS") return "🟢";
  if (status === "WARNING") return "🟡";
  if (status === "FAIL") return "🔴";
  return "⚪";
}

export function findCheck(checks: SafetyCheck[] | undefined, id: string) {
  return checks?.find((c) => c.id === id);
}

export default function SafetyPanel({
  props,
  checks,
  onViewReport,
}: {
  props: SignalSafetyProps;
  checks?: SafetyCheck[];
  onViewReport?: () => void;
}) {
  if (!props.safetyVerdict) {
    return (
      <div className="bg-base-800/40 border border-base-800 rounded px-2.5 py-2 mb-3 text-xs text-zinc-500">
        Safety data unavailable — not yet analyzed.
      </div>
    );
  }

  const warningCount = checks?.filter((c) => c.status === "WARNING" || c.status === "FAIL").length ?? null;
  const liquidity = findCheck(checks, "liquiditySize");
  const lp = findCheck(checks, "lpLockStatus");
  const mint = findCheck(checks, "mintAuthority");
  const freeze = findCheck(checks, "freezeAuthority");
  const holders = findCheck(checks, "topHolderConcentration");
  const holderCount = findCheck(checks, "holderCount");
  const age = findCheck(checks, "tokenAge");

  return (
    <div className="bg-base-800/40 border border-base-800 rounded px-2.5 py-2 mb-3">
      <div className="flex items-center justify-between mb-1.5">
        <span
          className={`text-xs font-bold px-2 py-0.5 rounded border ${
            VERDICT_STYLES[props.safetyVerdict] ?? VERDICT_STYLES.INSUFFICIENT_DATA
          }`}
        >
          {props.safetyVerdict.replace(/_/g, " ")}
          {props.safetyOverride ? " (overridden)" : ""}
        </span>
        <div className="text-[11px] text-zinc-500 font-mono">
          Risk {props.rugRiskScore ?? "?"} · Safety {props.safetyScore ?? "?"}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-zinc-400 mb-1.5">
        <span>{statusIcon(liquidity?.status)} Liquidity</span>
        <span>{statusIcon(lp?.status)} LP lock</span>
        <span>{statusIcon(mint?.status)} Mint auth</span>
        <span>{statusIcon(freeze?.status)} Freeze auth</span>
        <span>{statusIcon(holders?.status)} Concentration</span>
        <span>{statusIcon(holderCount?.status)} Holder count</span>
        <span>{statusIcon(age?.status)} Token age</span>
        {warningCount != null && <span>⚠️ {warningCount} warning(s)</span>}
      </div>

      <div className="flex items-center justify-between text-[11px] text-zinc-600">
        <span>
          {props.safetyCheckedAt ? `Analyzed ${new Date(props.safetyCheckedAt).toLocaleString()}` : "Not yet analyzed"}
        </span>
        {onViewReport && (
          <button onClick={onViewReport} className="text-accent-400 hover:underline">
            View safety report →
          </button>
        )}
      </div>
    </div>
  );
}
