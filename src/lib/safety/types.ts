import type { SafetyVerdict } from "@/db/schema";

export type CheckStatus = "PASS" | "WARNING" | "FAIL" | "UNKNOWN";

export type SafetyCheckId =
  | "mintAuthority"
  | "freezeAuthority"
  | "upgradeableContract"
  | "transferRestrictions"
  | "blacklistOrPause"
  | "liquiditySize"
  | "lpLockStatus"
  | "lpLockExpiry"
  | "creatorLiquidityControl"
  | "topHolderConcentration"
  | "creatorAllocation"
  | "holderCount"
  | "failedSellTransactions"
  | "buySellRatio"
  | "suddenLiquidityWithdrawal"
  | "tokenAge"
  | "deployerHistory"
  | "previousTokenLaunches"
  | "deployAndDumpBehavior"
  | "suspiciousLinkedWallets"
  | "washTrading"
  | "abnormalVolumeSlippageImpact";

// One row of the safety report. `scoreImpact` is how many points this check
// subtracted from the 100-point safety score (0 for PASS/UNKNOWN).
export type SafetyCheckResult = {
  id: SafetyCheckId;
  label: string;
  status: CheckStatus;
  explanation: string;
  scoreImpact: number;
  source: string; // e.g. "dexscreener", "rugcheck.xyz", "goplus", "derived", "unavailable"
};

export type SafetyDataSources = Record<string, "ok" | "unavailable" | "error">;

export type SafetyReport = {
  tokenAddress: string;
  chain: string;
  rugRiskScore: number; // 0-100, higher = riskier
  safetyScore: number; // 0-100, higher = safer
  verdict: SafetyVerdict;
  checks: SafetyCheckResult[];
  warnings: string[];
  dataSources: SafetyDataSources;
  analyzedAt: string;
};

export const SAFETY_CHECK_LABELS: Record<SafetyCheckId, string> = {
  mintAuthority: "Mint authority",
  freezeAuthority: "Freeze authority / pausable transfers",
  upgradeableContract: "Upgradeable contract / program",
  transferRestrictions: "Transfer restrictions",
  blacklistOrPause: "Blacklist or pause functions",
  liquiditySize: "Liquidity size",
  lpLockStatus: "LP locked / burned status",
  lpLockExpiry: "LP lock expiry",
  creatorLiquidityControl: "Creator liquidity control",
  topHolderConcentration: "Top holder concentration",
  creatorAllocation: "Creator allocation",
  holderCount: "Holder count",
  failedSellTransactions: "Failed sell transactions (honeypot proxy)",
  buySellRatio: "Buy/sell ratio",
  suddenLiquidityWithdrawal: "Sudden liquidity withdrawal",
  tokenAge: "Token age",
  deployerHistory: "Deployer history",
  previousTokenLaunches: "Previous token launches by deployer",
  deployAndDumpBehavior: "Deploy-and-dump behaviour",
  suspiciousLinkedWallets: "Suspicious linked wallets",
  washTrading: "Wash trading",
  abnormalVolumeSlippageImpact: "Abnormal volume, slippage & price impact",
};

export function unavailableCheck(id: SafetyCheckId, reason?: string): SafetyCheckResult {
  return {
    id,
    label: SAFETY_CHECK_LABELS[id],
    status: "UNKNOWN",
    explanation: reason
      ? `Safety data unavailable — ${reason}`
      : "Safety data unavailable for this chain/provider.",
    scoreImpact: 0,
    source: "unavailable",
  };
}
