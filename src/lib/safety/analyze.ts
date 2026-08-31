import { db } from "@/db";
import { tokenSafetyReports, signals } from "@/db/schema";
import { and, desc, eq, ne } from "drizzle-orm";
import { getPairsForToken, bestPair, CHAIN_MAP } from "@/lib/dexscreener";
import { getRugCheckReport } from "./providers/rugcheck";
import { getGoPlusTokenSecurity, GOPLUS_CHAIN_IDS } from "./providers/goplus";
import { runSafetyChecks, type PastReport } from "./checks";
import { scoreChecks, deriveVerdict } from "./score";
import type { SafetyDataSources, SafetyReport } from "./types";

// Re-analyzing the same token more often than this just burns API quota and
// DB writes for a result that hasn't meaningfully changed.
const CACHE_TTL_MS = 15 * 60 * 1000;

const REVERSE_CHAIN_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(CHAIN_MAP).map(([k, v]) => [v, k])
);

export type AnalyzeOptions = {
  chain: string;
  tokenAddress: string;
  signalId?: string | null;
  forceRefresh?: boolean;
};

function toSafetyReport(row: typeof tokenSafetyReports.$inferSelect): SafetyReport {
  return {
    tokenAddress: row.tokenAddress,
    chain: row.chain,
    rugRiskScore: row.rugRiskScore,
    safetyScore: row.safetyScore,
    verdict: row.verdict as SafetyReport["verdict"],
    checks: row.checks as SafetyReport["checks"],
    warnings: row.warnings as string[],
    dataSources: row.dataSources as SafetyDataSources,
    rawProviderResponses: (row.rawProviderResponses as SafetyReport["rawProviderResponses"]) ?? null,
    analyzedAt: (row.analyzedAt instanceof Date ? row.analyzedAt : new Date(row.analyzedAt)).toISOString(),
  };
}

export async function getCachedReport(chain: string, tokenAddress: string) {
  const [row] = await db
    .select()
    .from(tokenSafetyReports)
    .where(and(eq(tokenSafetyReports.tokenAddress, tokenAddress), eq(tokenSafetyReports.chain, chain)))
    .orderBy(desc(tokenSafetyReports.analyzedAt))
    .limit(1);
  return row ?? null;
}

export async function analyzeToken(opts: AnalyzeOptions): Promise<SafetyReport> {
  const { chain, tokenAddress } = opts;
  const isSolana = chain === "Solana";

  if (!opts.forceRefresh) {
    const cached = await getCachedReport(chain, tokenAddress);
    if (cached && Date.now() - new Date(cached.analyzedAt).getTime() < CACHE_TTL_MS) {
      if (opts.signalId) await linkReportToSignal(opts.signalId, cached);
      return toSafetyReport(cached);
    }
  }

  const dataSources: SafetyDataSources = {};

  // DexScreener — used for liquidity/volume/age/tx data.
  let pair = null as Awaited<ReturnType<typeof bestPair>>;
  try {
    const chainId = REVERSE_CHAIN_MAP[chain];
    const pairs = chainId ? await getPairsForToken(chainId, tokenAddress) : [];
    pair = bestPair(pairs);
    dataSources.dexscreener = pair ? "ok" : "unavailable";
  } catch {
    dataSources.dexscreener = "error";
  }

  // Chain-specific safety provider.
  let rugcheck = null;
  let goplus = null;
  const rawSamples: { rugcheck?: string | null; goplus?: string | null } = {};
  if (isSolana) {
    try {
      const result = await getRugCheckReport(tokenAddress);
      rugcheck = result.parsed;
      rawSamples.rugcheck = result.raw;
      dataSources.rugcheck = result.parsed ? "ok" : "unavailable";
    } catch {
      dataSources.rugcheck = "error";
    }
  } else if (GOPLUS_CHAIN_IDS[chain]) {
    try {
      const result = await getGoPlusTokenSecurity(chain, tokenAddress);
      goplus = result.parsed;
      rawSamples.goplus = result.raw;
      dataSources.goplus = result.parsed ? "ok" : "unavailable";
    } catch {
      dataSources.goplus = "error";
    }
  } else {
    dataSources.goplus = "unavailable"; // chain not covered by GoPlus mapping
  }

  // Our own history for this token (sudden-liquidity-withdrawal comparison).
  const priorForToken = await db
    .select()
    .from(tokenSafetyReports)
    .where(and(eq(tokenSafetyReports.tokenAddress, tokenAddress), eq(tokenSafetyReports.chain, chain)))
    .orderBy(desc(tokenSafetyReports.analyzedAt))
    .limit(5);

  const deployerAddress = isSolana ? rugcheck?.creator ?? null : goplus?.creator_address ?? null;

  // Our own history for this deployer, across other tokens (deployer-history check).
  let priorForDeployer: PastReport[] = [];
  if (deployerAddress) {
    const rows = await db
      .select()
      .from(tokenSafetyReports)
      .where(
        and(
          eq(tokenSafetyReports.deployerAddress, deployerAddress),
          eq(tokenSafetyReports.chain, chain),
          ne(tokenSafetyReports.tokenAddress, tokenAddress)
        )
      )
      .orderBy(desc(tokenSafetyReports.analyzedAt))
      .limit(20);
    priorForDeployer = rows.map((r) => ({ analyzedAt: r.analyzedAt, checks: r.checks as any }));
  }

  const checks = runSafetyChecks({
    chain,
    tokenAddress,
    isSolana,
    pair,
    rugcheck,
    goplus,
    priorReportsForToken: priorForToken.map((r) => ({ analyzedAt: r.analyzedAt, checks: r.checks as any })),
    priorReportsForDeployer: priorForDeployer,
    deployerAddress,
  });

  const { safetyScore, rugRiskScore, warnings } = scoreChecks(checks);
  const verdict = deriveVerdict(checks, safetyScore);

  const [inserted] = await db
    .insert(tokenSafetyReports)
    .values({
      signalId: opts.signalId ?? null,
      tokenAddress,
      chain,
      deployerAddress,
      rugRiskScore,
      safetyScore,
      verdict,
      checks,
      warnings,
      dataSources,
      rawProviderResponses: rawSamples,
    })
    .returning();

  if (opts.signalId) await linkReportToSignal(opts.signalId, inserted);

  return toSafetyReport(inserted);
}

async function linkReportToSignal(signalId: string, report: typeof tokenSafetyReports.$inferSelect) {
  await db
    .update(signals)
    .set({
      safetyReportId: report.id,
      rugRiskScore: report.rugRiskScore,
      safetyScore: report.safetyScore,
      safetyVerdict: report.verdict,
      safetyCheckedAt: new Date(),
    })
    .where(eq(signals.id, signalId));
}
