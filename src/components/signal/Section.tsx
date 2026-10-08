"use client";

import { useId, type ReactNode } from "react";

export default function Section({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="border-t border-base-800">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className="w-full flex items-center justify-between gap-2 py-2 text-left text-xs text-zinc-300 hover:text-white"
      >
        <span className="font-medium">{title}</span>
        <span className="flex items-center gap-2 min-w-0">
          {summary && !open && <span className="truncate text-zinc-600">{summary}</span>}
          <span aria-hidden className="text-zinc-600">
            {open ? "−" : "+"}
          </span>
        </span>
      </button>
      {open && (
        <div id={id} className="pb-3">
          {children}
        </div>
      )}
    </div>
  );
}
