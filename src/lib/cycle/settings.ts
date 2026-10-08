// Whether the unified monitoring scheduler (/api/cron/monitoring-scheduler)
// is the authoritative production job. When true, the legacy standalone
// routes (/api/cron/scan, /api/cron/update-prices, /api/cron/market-cycle)
// no-op instead of running independently — per the consolidation spec's
// "must not run independently in production once the unified scheduler is
// enabled" rule. Pass ?force=true to any legacy route to run it anyway for
// manual testing/rollback.
export function isUnifiedSchedulerAuthoritative(): boolean {
  return (process.env.MONITORING_SCHEDULER_ENABLED ?? "false").toLowerCase() === "true";
}
