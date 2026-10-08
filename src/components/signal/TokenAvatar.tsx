"use client";

import { useState } from "react";

export default function TokenAvatar({ src, ticker }: { src: string | null; ticker: string }) {
  const [failed, setFailed] = useState(false);
  const initials = ticker.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";

  if (!src || failed) {
    return (
      <div
        aria-hidden
        className="w-9 h-9 shrink-0 rounded-full bg-base-800 border border-base-700 flex items-center justify-center text-[11px] font-semibold text-zinc-400"
      >
        {initials}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={36}
      height={36}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="w-9 h-9 shrink-0 rounded-full bg-base-800 object-cover"
    />
  );
}
