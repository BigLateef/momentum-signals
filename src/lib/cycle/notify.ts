// Single consolidated summary alert for a full market-cycle/scheduler run —
// separate from the per-signal HIGH-confidence alert (src/lib/discord.ts)
// and the per-trade alerts (src/lib/trading/discord-trade.ts), both of
// which are left untouched.

export type CycleHealthReport = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stages: Record<string, { status: "ok" | "error" | "skipped"; durationMs: number; detail?: unknown; error?: string }>;
};

export async function sendCycleSummaryAlert(report: CycleHealthReport, label: string) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const sendSummaries = (process.env.MONITORING_SCHEDULER_SEND_SUMMARY_ALERTS ?? "true").toLowerCase() === "true";
  if (!webhookUrl || !sendSummaries) return;

  const failedStages = Object.entries(report.stages).filter(([, s]) => s.status === "error");

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: `${label} — ${failedStages.length > 0 ? "⚠️ completed with errors" : "✅ completed"}`,
            color: failedStages.length > 0 ? 0xf59e0b : 0x34d399,
            fields: Object.entries(report.stages).map(([name, s]) => ({
              name,
              value: `${s.status.toUpperCase()} · ${s.durationMs}ms${s.error ? ` · ${s.error}` : ""}`,
              inline: false,
            })),
            footer: { text: `run ${report.runId} · ${report.durationMs}ms total` },
            timestamp: report.finishedAt,
          },
        ],
      }),
    });
  } catch (err) {
    console.error("Cycle summary alert failed:", err);
  }
}
