"use client";

import type { Banner } from "@/lib/signal-intel/view-model";
import { BANNER_STYLES } from "./tones";

export default function RiskBanners({ banners }: { banners: Banner[] }) {
  if (banners.length === 0) return null;
  return (
    <div className="space-y-1.5 mb-3" role="region" aria-label="Risk warnings">
      {banners.map((b) => (
        <div
          key={b.key}
          role={b.level === "danger" ? "alert" : undefined}
          className={`border rounded px-2.5 py-1.5 text-xs ${BANNER_STYLES[b.level]}`}
        >
          <p className="font-semibold">
            <span aria-hidden>{b.level === "danger" ? "⛔ " : "⚠️ "}</span>
            {b.title}
          </p>
          {b.detail && <p className="opacity-80 leading-snug mt-0.5">{b.detail}</p>}
        </div>
      ))}
    </div>
  );
}
