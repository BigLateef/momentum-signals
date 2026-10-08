// Pure display formatters. Contract: null / undefined / NaN / Infinity never
// become "0" or "$0" — they render as the UNKNOWN placeholder.

export const UNKNOWN = "—";

function isNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** 1234 -> 1.2K, 9_200_000 -> 9.2M. Rolls 999.95K over to 1M instead of "1000K". */
export function formatCompact(n: number | null | undefined, decimals = 1): string {
  if (!isNum(n)) return UNKNOWN;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const units: [number, string][] = [
    [1e3, "K"],
    [1e6, "M"],
    [1e9, "B"],
    [1e12, "T"],
  ];
  let idx = -1;
  for (let i = 0; i < units.length; i++) if (abs >= units[i][0]) idx = i;
  if (idx === -1) return `${sign}${trimZero(abs.toFixed(abs < 10 ? 2 : 0))}`;
  let rounded = Number((abs / units[idx][0]).toFixed(decimals));
  if (rounded >= 1000 && idx < units.length - 1) {
    idx += 1;
    rounded = Number((abs / units[idx][0]).toFixed(decimals));
  }
  return `${sign}${trimZero(rounded.toFixed(decimals))}${units[idx][1]}`;
}

function trimZero(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

export function formatUsdCompact(n: number | null | undefined): string {
  if (!isNum(n)) return UNKNOWN;
  return `${n < 0 ? "-" : ""}$${formatCompact(Math.abs(n))}`;
}

const SUBSCRIPT = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
function toSubscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPT[Number(d)])
    .join("");
}

/**
 * Token prices span many orders of magnitude. Values below $0.0001 use the
 * compact zero-count notation: 0.000000092270 -> $0.0₇9227 (seven zeros, then
 * the significant digits).
 */
export function formatPriceUsd(n: number | null | undefined): string {
  if (!isNum(n)) return UNKNOWN;
  if (n < 0) return UNKNOWN;
  if (n === 0) return "$0";
  if (n >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.0001) return `$${trimZero(n.toFixed(6))}`;

  // Count leading zeros after the decimal point using exponent form so we
  // never depend on toFixed() on tiny values.
  const [mantissa, exp] = n.toExponential(3).split("e");
  const zeros = Math.abs(Number(exp)) - 1;
  const digits = mantissa.replace(".", "").replace(/0+$/, "") || "0";
  return `$0.0${toSubscript(zeros)}${digits}`;
}

/** Percent change with explicit sign: +155.0%, -12.3%, 0.0%. */
export function formatPercentChange(n: number | null | undefined): string {
  if (!isNum(n)) return UNKNOWN;
  const abs = Math.abs(n);
  const body = abs >= 100_000 ? formatCompact(abs, 1) : abs >= 1000 ? Math.round(abs).toLocaleString("en-US") : abs.toFixed(1);
  if (n > 0 && body !== "0.0") return `+${body}%`;
  if (n < 0 && body !== "0.0") return `-${body}%`;
  return `${body}%`;
}

/** Plain percent (not a change): 43% / 7.9%. */
export function formatPercent(n: number | null | undefined, decimals = 1): string {
  if (!isNum(n)) return UNKNOWN;
  return `${n.toFixed(decimals)}%`;
}

export function formatCount(n: number | null | undefined): string {
  if (!isNum(n)) return UNKNOWN;
  return Math.round(n).toLocaleString("en-US");
}

/** "45s", "3m", "2h 5m", "3d 4h", "2y". Null for clock-skewed/invalid input. */
export function formatAgeMs(ms: number | null | undefined): string {
  if (!isNum(ms)) return UNKNOWN;
  if (ms < -60_000) return UNKNOWN; // timestamp meaningfully in the future → don't pretend
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 365) return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
  return `${Math.floor(d / 365)}y`;
}

export function ageSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : now.getTime() - t;
}

export function formatAgeSince(iso: string | null | undefined, now: Date): string {
  return formatAgeMs(ageSince(iso, now));
}

/** Deterministic UTC timestamp for tooltips/alerts: "2026-10-07 13:27 UTC". */
export function formatUtc(iso: string | null | undefined): string {
  if (!iso) return UNKNOWN;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return UNKNOWN;
  return new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/** "1,200 / 340" style buys/sells pair; unknown if either side is missing. */
export function formatBuysSells(v: { buys: number; sells: number } | null | undefined): string {
  if (!v || !isNum(v.buys) || !isNum(v.sells)) return UNKNOWN;
  return `${formatCount(v.buys)} / ${formatCount(v.sells)}`;
}

/** Token prices for entry/targets arrive as numeric strings from the DB. */
export function parseDecimal(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
