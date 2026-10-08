import type { Tone } from "@/lib/signal-intel/view-model";

// Maps view-model tones onto the app's existing Tailwind palette
// (base-*/accent-*, emerald/yellow/red used by SignalCard & SafetyPanel).
export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-emerald-400",
  warn: "text-yellow-400",
  danger: "text-red-400",
  neutral: "text-zinc-200",
  unknown: "text-zinc-500",
};

export const BANNER_STYLES = {
  danger: "bg-red-500/10 border-red-500/40 text-red-300",
  warn: "bg-yellow-500/10 border-yellow-500/40 text-yellow-300",
  info: "bg-base-800/60 border-base-700 text-zinc-300",
} as const;
