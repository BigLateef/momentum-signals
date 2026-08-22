// Vercel Cron sends GET requests and auto-attaches `Authorization: Bearer $CRON_SECRET`.
// cron-job.org (or any manual trigger) sends whatever method you configure, with
// whatever header you set — this app uses `Authorization: Bearer $CRON_API_KEY`.
//
// To use Vercel Cron, set CRON_SECRET in Vercel's env vars to the SAME value as
// CRON_API_KEY, so both paths validate against one shared secret.
export function isAuthorizedCronRequest(req: Request): boolean {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_API_KEY}`;
  return Boolean(process.env.CRON_API_KEY) && authHeader === expected;
}
