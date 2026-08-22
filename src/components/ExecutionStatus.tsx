"use client";

type Execution = {
  status: "ELIGIBLE" | "SKIPPED" | "DRY_RUN" | "SUBMITTED" | "CONFIRMED" | "FAILED";
  skipReason: string | null;
  transactionId: string | null;
  dryRun: boolean;
};

const STATUS_STYLES: Record<string, string> = {
  ELIGIBLE: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  SKIPPED: "bg-zinc-700/30 text-zinc-400 border-zinc-600/40",
  DRY_RUN: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  SUBMITTED: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  CONFIRMED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  FAILED: "bg-red-500/15 text-red-400 border-red-500/30",
};

export default function ExecutionStatus({ execution }: { execution: Execution | null | undefined }) {
  if (!execution) return null;

  return (
    <div className="flex items-center flex-wrap gap-1.5 mb-3 text-[11px]">
      <span className={`px-2 py-0.5 rounded border font-semibold ${STATUS_STYLES[execution.status]}`}>
        {execution.dryRun && execution.status !== "SKIPPED" ? "DRY RUN · " : ""}
        {execution.status}
      </span>
      {execution.skipReason && <span className="text-zinc-600">{execution.skipReason}</span>}
      {execution.transactionId && (
        <span className="text-zinc-600 font-mono truncate max-w-[160px]" title={execution.transactionId}>
          tx: {execution.transactionId.slice(0, 10)}…
        </span>
      )}
    </div>
  );
}
