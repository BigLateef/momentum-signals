"use client";

import type { SignalCardModel } from "@/lib/signal-intel/view-model";

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function SocialsList({ socials }: { socials: SignalCardModel["sections"]["socials"] }) {
  return (
    <div className="text-xs">
      <ul className="space-y-1.5">
        {socials.rows.map((r) => (
          <li key={r.kind} className="grid grid-cols-[7.5rem_1fr] gap-x-2">
            <span className="text-zinc-600">{r.label}</span>
            <span className="min-w-0">
              {r.status === "listed" &&
                r.links.map((l) => (
                  <span key={l.url} className="block">
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-accent-400 hover:underline break-all"
                    >
                      {host(l.url)}
                    </a>{" "}
                    <span className="text-[10px] px-1 rounded border border-yellow-500/30 text-yellow-400/80">
                      listed · unverified
                    </span>
                  </span>
                ))}
              {r.status === "not_listed" && <span className="text-zinc-400">None listed by provider</span>}
              {r.status === "unknown" && (
                <span className="px-1 rounded bg-base-800 border border-base-700 text-[10px] font-semibold tracking-wide text-zinc-500">
                  UNKNOWN
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-zinc-600 leading-snug mt-2">{socials.note}</p>
    </div>
  );
}
