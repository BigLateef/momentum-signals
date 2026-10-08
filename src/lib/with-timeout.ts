// Races a promise against a timeout, rejecting if the promise hasn't
// settled in time. Does NOT cancel the underlying operation (there's no
// universal way to do that for an arbitrary promise) — it only bounds how
// long a *caller* waits for a result. For a DB query, this is currently the
// only layer that actually bounds a hang (see src/db/index.ts for why a
// server-side statement_timeout isn't set — real risk of a PgBouncer-family
// pooler like Supabase's rejecting it outright), so a timeout here doesn't
// free the underlying connection, it just stops the caller waiting on it.
//
// Extracted as its own module (rather than inlined in whichever route
// needed it first) specifically so it's unit-testable — a route file only
// exports HTTP method handlers, so a helper defined inline there can't be
// imported by a test.
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}
