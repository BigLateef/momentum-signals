"use client";

import { useEffect, useState } from "react";

// Re-renders the caller every `intervalMs` so relative labels ("updated 42s
// ago") stay honest between the feed's 20-second polls. A per-card timer is
// fine at 20 cards/page.
export function useNow(intervalMs = 15_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
