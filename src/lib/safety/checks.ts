import type { DexPair } from "@/lib/dexscreener";
import type { RugCheckReport } from "./providers/rugcheck";
import type { GoPlusTokenSecurity } from "./providers/goplus";
import { unavailableCheck, type SafetyCheckResult } from "./types";

// A minimal shape of a past safety report, used for the "our own history"
// derived checks (deployer history, sudden liquidity withdrawal). Deliberately
// small so callers can pass rows straight from `token_safety_reports`.
export type PastReport = {
  analyzedAt: Date | string;
  checks: SafetyCheckResult[];
};

export type CheckInputs = {
  chain: string;
  tokenAddress: string;
  isSolana: boolean;
  pair: DexPair | null;
  rugcheck: RugCheckReport | null;
  goplus: GoPlusTokenSecurity | null;
  // Prior reports for the SAME token, most recent first — used to detect
  // sudden liquidity withdrawal and to build a deployer track record.
  priorReportsForToken: PastReport[];
  // Prior reports for OTHER tokens from the same deployer address, if one
  // could be identified — used for deployer-history / serial-launcher checks.
  priorReportsForDeployer: PastReport[];
  deployerAddress: string | null;
};

const pct = (n: number | undefined | null) => (n == null ? null : n <= 1 ? n * 100 : n);

function num(v: string | number | undefined | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export function runSafetyChecks(input: CheckInputs): SafetyCheckResult[] {
  const results: SafetyCheckResult[] = [];
  const { pair, rugcheck, goplus, isSolana } = input;

  // -------------------- mintAuthority --------------------
  if (isSolana) {
    // Read both possible locations — real RugCheck API clients show this as
    // a top-level field; the original implementation assumed it was nested
    // under `.token`, which real responses don't populate. Whichever is
    // actually present is used. Deliberately conservative: only emit a real
    // PASS/FAIL when a value was actually found at one of the two
    // locations. If rugcheck succeeded but the field is absent from both,
    // this stays UNKNOWN rather than assuming "absent means renounced" —
    // that assumption is unverified and, if wrong, would hide a genuinely
    // active mint authority behind a false PASS, which is worse for a
    // system feeding auto-trade decisions than just staying honestly
    // uncertain. See rugcheck.ts's top-of-file comment.
    // Preserve the distinction between an explicit `null` (a real signal —
    // RugCheck confirming the authority was renounced) and `undefined`
    // (the field is genuinely absent, we have no answer). `??` would
    // collapse both into "fall through to the next location," discarding a
    // real null-renounced signal if it happened to sit at the top level —
    // so this only falls back to the nested location when the top-level
    // field is strictly undefined, never when it's null.
    const mintAuthorityValue =
      rugcheck?.mintAuthority !== undefined ? rugcheck?.mintAuthority : rugcheck?.token?.mintAuthority;
    if (rugcheck && mintAuthorityValue !== undefined) {
      const active = !!mintAuthorityValue;
      results.push({
        id: "mintAuthority",
        label: "Mint authority",
        status: active ? "FAIL" : "PASS",
        explanation: active
          ? "Mint authority is still active — the deployer can mint new supply at will, diluting holders."
          : "Mint authority has been revoked/renounced — supply is fixed.",
        scoreImpact: active ? 18 : 0,
        source: "rugcheck.xyz",
      });
    } else if (rugcheck) {
      results.push(
        unavailableCheck("mintAuthority", "RugCheck report loaded but did not include a mint authority field")
      );
    } else {
      results.push(unavailableCheck("mintAuthority", "RugCheck report unavailable for this mint"));
    }
  } else if (goplus) {
    const mintable = goplus.is_mintable === "1";
    results.push({
      id: "mintAuthority",
      label: "Mint authority",
      status: mintable ? "FAIL" : "PASS",
      explanation: mintable
        ? "Contract exposes a mint function — supply can be inflated after launch."
        : "No mint function detected in the contract.",
      scoreImpact: mintable ? 18 : 0,
      source: "goplus",
    });
  } else {
    results.push(unavailableCheck("mintAuthority", "GoPlus has no data for this chain/contract"));
  }

  // -------------------- freezeAuthority --------------------
  if (isSolana) {
    // Same conservative dual-location read as mintAuthority above — only a
    // real PASS/FAIL when a value was actually found, UNKNOWN otherwise
    // rather than assuming absence means renounced.
    const freezeAuthorityValue =
      rugcheck?.freezeAuthority !== undefined ? rugcheck?.freezeAuthority : rugcheck?.token?.freezeAuthority;
    if (rugcheck && freezeAuthorityValue !== undefined) {
      const active = !!freezeAuthorityValue;
      results.push({
        id: "freezeAuthority",
        label: "Freeze authority",
        status: active ? "FAIL" : "PASS",
        explanation: active
          ? "Freeze authority is active — the deployer can freeze any holder's token account."
          : "Freeze authority has been revoked/renounced.",
        scoreImpact: active ? 15 : 0,
        source: "rugcheck.xyz",
      });
    } else if (rugcheck) {
      results.push(
        unavailableCheck("freezeAuthority", "RugCheck report loaded but did not include a freeze authority field")
      );
    } else {
      results.push(unavailableCheck("freezeAuthority", "RugCheck report unavailable for this mint"));
    }
  } else if (goplus) {
    const pausable = goplus.transfer_pausable === "1";
    results.push({
      id: "freezeAuthority",
      label: "Freeze authority / pausable transfers",
      status: pausable ? "FAIL" : "PASS",
      explanation: pausable
        ? "Contract can pause transfers — functionally equivalent to a freeze authority."
        : "No pausable-transfer function detected.",
      scoreImpact: pausable ? 15 : 0,
      source: "goplus",
    });
  } else {
    results.push(unavailableCheck("freezeAuthority", "GoPlus has no data for this chain/contract"));
  }

  // -------------------- upgradeableContract --------------------
  if (!isSolana && goplus) {
    const proxy = goplus.is_proxy === "1";
    const openSource = goplus.is_open_source === "1";
    results.push({
      id: "upgradeableContract",
      label: "Upgradeable contract",
      status: proxy ? "WARNING" : openSource ? "PASS" : "UNKNOWN",
      explanation: proxy
        ? "Contract is a proxy — logic can be swapped by the owner post-launch."
        : openSource
        ? "Contract is not a proxy and source is verified/open."
        : "Contract source is not verified — upgradeability can't be confirmed.",
      scoreImpact: proxy ? 8 : openSource ? 0 : 4,
      source: "goplus",
    });
  } else {
    // Solana program-upgrade-authority isn't exposed by RugCheck's summary
    // endpoint, so this is honestly unknown rather than guessed.
    results.push(unavailableCheck("upgradeableContract", "Program upgrade-authority data not available"));
  }

  // -------------------- transferRestrictions --------------------
  if (!isSolana && goplus) {
    const restricted = goplus.cannot_sell_all === "1" || goplus.trading_cooldown === "1";
    results.push({
      id: "transferRestrictions",
      label: "Transfer restrictions",
      status: restricted ? "FAIL" : "PASS",
      explanation: restricted
        ? "Contract restricts selling (cannot-sell-all and/or a trading cooldown was detected)."
        : "No sell restriction or trading-cooldown function detected.",
      scoreImpact: restricted ? 15 : 0,
      source: "goplus",
    });
  } else {
    results.push(unavailableCheck("transferRestrictions", "Not exposed by available Solana data sources"));
  }

  // -------------------- blacklistOrPause --------------------
  if (!isSolana && goplus) {
    const flagged = goplus.is_blacklisted === "1" || goplus.is_whitelisted === "1";
    results.push({
      id: "blacklistOrPause",
      label: "Blacklist or pause functions",
      status: flagged ? "WARNING" : "PASS",
      explanation: flagged
        ? "Contract implements blacklist/whitelist gating on transfers."
        : "No blacklist/whitelist gating detected.",
      scoreImpact: flagged ? 10 : 0,
      source: "goplus",
    });
  } else {
    results.push(unavailableCheck("blacklistOrPause", "Not exposed by available Solana data sources"));
  }

  // -------------------- liquiditySize --------------------
  const liquidityUsd = pair?.liquidity?.usd ?? null;
  if (liquidityUsd != null) {
    const status: SafetyCheckResult["status"] =
      liquidityUsd < 3_000 ? "FAIL" : liquidityUsd < 10_000 ? "WARNING" : "PASS";
    results.push({
      id: "liquiditySize",
      label: "Liquidity size",
      status,
      explanation: `Pool liquidity is $${Math.round(liquidityUsd).toLocaleString()}.`,
      scoreImpact: status === "FAIL" ? 15 : status === "WARNING" ? 6 : 0,
      source: "dexscreener",
    });
  } else {
    results.push(unavailableCheck("liquiditySize", "No DexScreener pair found"));
  }

  // -------------------- lpLockStatus --------------------
  if (isSolana && rugcheck?.markets?.length) {
    const lp = rugcheck.markets[0]?.lp;
    const lockedPct = pct(lp?.lpLockedPct);
    if (lockedPct != null) {
      const status: SafetyCheckResult["status"] =
        lockedPct >= 80 ? "PASS" : lockedPct >= 30 ? "WARNING" : "FAIL";
      results.push({
        id: "lpLockStatus",
        label: "LP locked/burned status",
        status,
        explanation: `${lockedPct.toFixed(1)}% of LP tokens are locked or burned.`,
        scoreImpact: status === "FAIL" ? 18 : status === "WARNING" ? 8 : 0,
        source: "rugcheck.xyz",
      });
    } else {
      results.push(unavailableCheck("lpLockStatus", "RugCheck did not report an LP lock percentage"));
    }
  } else if (!isSolana && goplus?.lp_holders) {
    const totalLocked = goplus.lp_holders
      .filter((h) => h.is_locked === 1)
      .reduce((sum, h) => sum + (num(h.percent) ?? 0), 0);
    const lockedPct = pct(totalLocked);
    const status: SafetyCheckResult["status"] =
      lockedPct == null ? "UNKNOWN" : lockedPct >= 80 ? "PASS" : lockedPct >= 30 ? "WARNING" : "FAIL";
    results.push({
      id: "lpLockStatus",
      label: "LP locked/burned status",
      status,
      explanation:
        lockedPct == null
          ? "GoPlus reported no LP holder breakdown for this pair."
          : `${lockedPct.toFixed(1)}% of tracked LP holders show as locked.`,
      scoreImpact: status === "FAIL" ? 18 : status === "WARNING" ? 8 : 0,
      source: "goplus",
    });
  } else {
    results.push(unavailableCheck("lpLockStatus"));
  }

  // -------------------- lpLockExpiry --------------------
  // Neither provider's free/summary endpoint reliably exposes a lock-expiry
  // timestamp — reporting a fabricated date would be worse than reporting
  // unknown, so this is always UNKNOWN unless a future provider adds it.
  results.push(unavailableCheck("lpLockExpiry", "No provider in use exposes LP lock expiry timestamps"));

  // -------------------- creatorLiquidityControl --------------------
  if (!isSolana && goplus) {
    const canReclaim = goplus.owner_change_balance === "1" || goplus.can_take_back_ownership === "1";
    results.push({
      id: "creatorLiquidityControl",
      label: "Creator liquidity control",
      status: canReclaim ? "FAIL" : "PASS",
      explanation: canReclaim
        ? "Owner can change balances or reclaim ownership — liquidity is not fully out of creator control."
        : "No owner mechanism detected for reclaiming control or balances.",
      scoreImpact: canReclaim ? 12 : 0,
      source: "goplus",
    });
  } else {
    results.push(unavailableCheck("creatorLiquidityControl", "Not exposed by available Solana data sources"));
  }

  // -------------------- topHolderConcentration --------------------
  {
    let top1: number | null = null;
    let top5: number | null = null;
    let top10: number | null = null;
    let source = "unavailable";

    if (isSolana && rugcheck?.topHolders?.length) {
      const sorted = [...rugcheck.topHolders].sort((a, b) => b.pct - a.pct);
      top1 = pct(sorted[0]?.pct);
      top5 = pct(sorted.slice(0, 5).reduce((s, h) => s + h.pct, 0));
      top10 = pct(sorted.slice(0, 10).reduce((s, h) => s + h.pct, 0));
      source = "rugcheck.xyz";
    } else if (!isSolana && goplus?.holders?.length) {
      const sorted = [...goplus.holders].sort((a, b) => (num(b.percent) ?? 0) - (num(a.percent) ?? 0));
      top1 = pct(num(sorted[0]?.percent));
      top5 = pct(sorted.slice(0, 5).reduce((s, h) => s + (num(h.percent) ?? 0), 0));
      top10 = pct(sorted.slice(0, 10).reduce((s, h) => s + (num(h.percent) ?? 0), 0));
      source = "goplus";
    }

    if (top10 != null) {
      const status: SafetyCheckResult["status"] =
        top10 > 60 || (top1 ?? 0) > 25 ? "FAIL" : top10 > 35 ? "WARNING" : "PASS";
      results.push({
        id: "topHolderConcentration",
        label: "Top holder concentration",
        status,
        explanation: `Top 1: ${top1?.toFixed(1) ?? "?"}% · Top 5: ${top5?.toFixed(1) ?? "?"}% · Top 10: ${top10.toFixed(
          1
        )}% of supply.`,
        scoreImpact: status === "FAIL" ? 15 : status === "WARNING" ? 7 : 0,
        source,
      });
    } else {
      results.push(unavailableCheck("topHolderConcentration", "No holder list returned by available providers"));
    }
  }

  // -------------------- creatorAllocation --------------------
  {
    let creatorPct: number | null = null;
    let source = "unavailable";
    if (isSolana && rugcheck?.creatorBalance != null && rugcheck.token?.supply) {
      creatorPct = (rugcheck.creatorBalance / rugcheck.token.supply) * 100;
      source = "rugcheck.xyz";
    } else if (!isSolana && goplus?.creator_percent != null) {
      creatorPct = pct(num(goplus.creator_percent));
      source = "goplus";
    }
    if (creatorPct != null) {
      const status: SafetyCheckResult["status"] =
        creatorPct > 20 ? "FAIL" : creatorPct > 8 ? "WARNING" : "PASS";
      results.push({
        id: "creatorAllocation",
        label: "Creator allocation",
        status,
        explanation: `Deployer/creator address holds an estimated ${creatorPct.toFixed(1)}% of supply.`,
        scoreImpact: status === "FAIL" ? 12 : status === "WARNING" ? 5 : 0,
        source,
      });
    } else {
      results.push(unavailableCheck("creatorAllocation", "Creator balance not reported by available providers"));
    }
  }

  // -------------------- holderCount --------------------
  {
    const holderCount = isSolana ? rugcheck?.totalHolders ?? null : num(goplus?.holder_count);
    if (holderCount != null) {
      const status: SafetyCheckResult["status"] =
        holderCount < 25 ? "FAIL" : holderCount < 100 ? "WARNING" : "PASS";
      results.push({
        id: "holderCount",
        label: "Holder count",
        status,
        explanation: `${holderCount.toLocaleString()} holders reported.`,
        scoreImpact: status === "FAIL" ? 10 : status === "WARNING" ? 4 : 0,
        source: isSolana ? "rugcheck.xyz" : "goplus",
      });
    } else {
      results.push(unavailableCheck("holderCount"));
    }
  }

  // -------------------- failedSellTransactions (honeypot proxy) --------------------
  if (!isSolana && goplus) {
    const honeypot = goplus.is_honeypot === "1" || goplus.cannot_sell_all === "1";
    results.push({
      id: "failedSellTransactions",
      label: "Failed sell transactions (honeypot proxy)",
      status: honeypot ? "FAIL" : "PASS",
      explanation: honeypot
        ? "Simulated sell fails or is blocked for some/all holders — classic honeypot signature."
        : "Simulated sell succeeded in GoPlus's honeypot check.",
      scoreImpact: honeypot ? 25 : 0,
      source: "goplus",
    });
  } else if (isSolana && rugcheck?.risks?.length) {
    const honeypotRisk = rugcheck.risks.find((r) => /honeypot|cannot sell|transfer.?fee/i.test(r.name));
    results.push({
      id: "failedSellTransactions",
      label: "Failed sell transactions (honeypot proxy)",
      status: honeypotRisk ? "FAIL" : "PASS",
      explanation: honeypotRisk
        ? `RugCheck flagged: ${honeypotRisk.name}${honeypotRisk.description ? " — " + honeypotRisk.description : ""}`
        : "No honeypot-pattern risk flagged by RugCheck.",
      scoreImpact: honeypotRisk ? 25 : 0,
      source: "rugcheck.xyz",
    });
  } else {
    results.push(unavailableCheck("failedSellTransactions", "No honeypot-simulation data available"));
  }

  // -------------------- buySellRatio --------------------
  {
    const buys = pair?.txns?.h1?.buys ?? null;
    const sells = pair?.txns?.h1?.sells ?? null;
    if (buys != null && sells != null && buys + sells > 0) {
      const ratio = buys / (buys + sells);
      // Extreme skew in either direction, with real volume, is worth flagging
      // (all-buys can be wash-trading prep; all-sells can be an active dump).
      const status: SafetyCheckResult["status"] =
        buys + sells >= 10 && (ratio > 0.95 || ratio < 0.05) ? "WARNING" : "PASS";
      results.push({
        id: "buySellRatio",
        label: "Buy/sell ratio",
        status,
        explanation: `${buys} buys / ${sells} sells in the last hour (${(ratio * 100).toFixed(0)}% buys).`,
        scoreImpact: status === "WARNING" ? 5 : 0,
        source: "dexscreener",
      });
    } else {
      results.push(unavailableCheck("buySellRatio", "No recent transaction data from DexScreener"));
    }
  }

  // -------------------- suddenLiquidityWithdrawal --------------------
  {
    const prior = input.priorReportsForToken[0];
    const priorLiqCheck = prior?.checks.find((c) => c.id === "liquiditySize");
    const priorLiqMatch = priorLiqCheck?.explanation.match(/\$([\d,]+)/);
    const priorLiqUsd = priorLiqMatch ? parseFloat(priorLiqMatch[1].replace(/,/g, "")) : null;

    if (priorLiqUsd != null && liquidityUsd != null && priorLiqUsd > 0) {
      const dropPct = ((priorLiqUsd - liquidityUsd) / priorLiqUsd) * 100;
      const status: SafetyCheckResult["status"] = dropPct > 40 ? "FAIL" : dropPct > 15 ? "WARNING" : "PASS";
      results.push({
        id: "suddenLiquidityWithdrawal",
        label: "Sudden liquidity withdrawal",
        status,
        explanation:
          dropPct > 15
            ? `Liquidity dropped ${dropPct.toFixed(1)}% since our last analysis of this token.`
            : `Liquidity is stable or growing versus our last analysis (${dropPct.toFixed(1)}% change).`,
        scoreImpact: status === "FAIL" ? 20 : status === "WARNING" ? 8 : 0,
        source: "derived",
      });
    } else {
      results.push(unavailableCheck("suddenLiquidityWithdrawal", "No prior analysis of this token to compare against yet"));
    }
  }

  // -------------------- tokenAge --------------------
  if (pair?.pairCreatedAt) {
    const ageHours = (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60);
    const status: SafetyCheckResult["status"] = ageHours < 1 ? "FAIL" : ageHours < 24 ? "WARNING" : "PASS";
    results.push({
      id: "tokenAge",
      label: "Token age",
      status,
      explanation:
        ageHours < 48
          ? `Pool is ${ageHours.toFixed(1)} hours old.`
          : `Pool is ${(ageHours / 24).toFixed(1)} days old.`,
      scoreImpact: status === "FAIL" ? 10 : status === "WARNING" ? 4 : 0,
      source: "dexscreener",
    });
  } else {
    results.push(unavailableCheck("tokenAge", "DexScreener did not report a pair creation timestamp"));
  }

  // -------------------- deployerHistory / previousTokenLaunches --------------------
  // Built from our own accumulated safety-report history rather than a
  // third-party API (none of the free providers expose deployer track
  // record reliably) — so this only has data once we've analyzed other
  // tokens from the same deployer before.
  if (input.deployerAddress && input.priorReportsForDeployer.length > 0) {
    const count = input.priorReportsForDeployer.length;
    const status: SafetyCheckResult["status"] = count >= 5 ? "WARNING" : "PASS";
    results.push({
      id: "deployerHistory",
      label: "Deployer history",
      status,
      explanation: `This deployer address has ${count} other token(s) previously analyzed by this platform.`,
      scoreImpact: status === "WARNING" ? 6 : 0,
      source: "derived",
    });
    results.push({
      id: "previousTokenLaunches",
      label: "Previous token launches by deployer",
      status: count >= 5 ? "WARNING" : "PASS",
      explanation: `${count} prior launch(es) on record for this deployer within this platform's own history.`,
      scoreImpact: count >= 5 ? 6 : 0,
      source: "derived",
    });
  } else {
    results.push(
      unavailableCheck(
        "deployerHistory",
        input.deployerAddress
          ? "No prior launches on record for this deployer yet"
          : "Deployer address could not be identified from available providers"
      )
    );
    results.push(
      unavailableCheck(
        "previousTokenLaunches",
        input.deployerAddress
          ? "No prior launches on record for this deployer yet"
          : "Deployer address could not be identified from available providers"
      )
    );
  }

  // -------------------- deployAndDumpBehavior --------------------
  // Requires historical price series per past launch, which none of the
  // free providers in use expose — always unknown rather than guessed.
  results.push(
    unavailableCheck("deployAndDumpBehavior", "Requires historical price data this platform does not yet retain")
  );

  // -------------------- suspiciousLinkedWallets --------------------
  // Requires wallet-graph/clustering data not available from DexScreener,
  // RugCheck's summary endpoint, or GoPlus's token-security endpoint.
  results.push(unavailableCheck("suspiciousLinkedWallets", "No wallet-clustering data source configured"));

  // -------------------- washTrading (heuristic on real fetched data) --------------------
  {
    const volume24h = pair?.volume?.h24 ?? null;
    const holderCount = isSolana ? rugcheck?.totalHolders ?? null : num(goplus?.holder_count);
    if (volume24h != null && liquidityUsd != null && liquidityUsd > 0) {
      const turnoverRatio = volume24h / liquidityUsd;
      const suspicious = turnoverRatio > 40 && (holderCount == null || holderCount < 50);
      results.push({
        id: "washTrading",
        label: "Wash trading",
        status: suspicious ? "WARNING" : "PASS",
        explanation: suspicious
          ? `24h volume is ${turnoverRatio.toFixed(1)}x pool liquidity with a low holder count — pattern consistent with wash trading, not confirmed.`
          : `24h volume/liquidity ratio (${turnoverRatio.toFixed(1)}x) is within a normal range for the holder count.`,
        scoreImpact: suspicious ? 8 : 0,
        source: "derived",
      });
    } else {
      results.push(unavailableCheck("washTrading", "Insufficient volume/liquidity data to evaluate"));
    }
  }

  // -------------------- abnormalVolumeSlippageImpact --------------------
  {
    const buyTax = num(goplus?.buy_tax);
    const sellTax = num(goplus?.sell_tax);
    if (buyTax != null || sellTax != null) {
      const bt = pct(buyTax) ?? 0;
      const st = pct(sellTax) ?? 0;
      const status: SafetyCheckResult["status"] = bt > 15 || st > 15 ? "FAIL" : bt > 8 || st > 8 ? "WARNING" : "PASS";
      results.push({
        id: "abnormalVolumeSlippageImpact",
        label: "Abnormal volume, slippage & price impact",
        status,
        explanation: `Buy tax ${bt.toFixed(1)}% · Sell tax ${st.toFixed(1)}%.`,
        scoreImpact: status === "FAIL" ? 15 : status === "WARNING" ? 6 : 0,
        source: "goplus",
      });
    } else {
      results.push(
        unavailableCheck("abnormalVolumeSlippageImpact", "No buy/sell tax simulation available for this chain")
      );
    }
  }

  return results;
}
