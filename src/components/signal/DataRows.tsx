"use client";

import type { Row } from "@/lib/signal-intel/view-model";
import { TONE_TEXT } from "./tones";
import CopyButton from "./CopyButton";

export default function DataRows({ rows }: { rows: Row[] }) {
  return (
    <dl className="space-y-1.5 text-xs">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[7.5rem_1fr] gap-x-2">
          <dt className="text-zinc-600">{r.label}</dt>
          <dd className="min-w-0">
            <div className="flex items-start gap-2">
              {r.tone === "unknown" ? (
                <span className="inline-flex items-center gap-1 text-zinc-500">
                  <span className="px-1 rounded bg-base-800 border border-base-700 text-[10px] font-semibold tracking-wide">
                    UNKNOWN
                  </span>
                </span>
              ) : (
                <span className={`font-mono break-words min-w-0 ${TONE_TEXT[r.tone]}`}>{r.value}</span>
              )}
              {r.copy && <CopyButton text={r.copy} />}
            </div>
            {(r.note || r.source) && (
              <p className="text-[11px] text-zinc-600 leading-snug mt-0.5">
                {r.note}
                {r.note && r.source ? " " : ""}
                {r.source ? <span className="text-zinc-700">· {r.source}</span> : null}
              </p>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
