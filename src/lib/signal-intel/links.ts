// URL sanitizing + explorer links. Everything user/provider-supplied that ends
// up in an href, <img src>, or a Discord embed goes through here first.

const MAX_URL_LENGTH = 300;

/** Returns a normalized https URL, or null. Rejects javascript:, data:, http:, userinfo, etc. */
export function safeHttpsUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// Token images are loaded straight into the viewer's browser, which tells the
// image host the viewer's IP. Only hosts we trust to be DexScreener's own CDN
// are allowed; anything else is treated as "no image".
const IMAGE_HOST_ALLOWLIST = ["dexscreener.com"];

export function safeImageUrl(input: unknown): string | null {
  const url = safeHttpsUrl(input);
  if (!url) return null;
  const host = new URL(url).hostname.toLowerCase();
  const ok = IMAGE_HOST_ALLOWLIST.some((h) => host === h || host.endsWith(`.${h}`));
  return ok ? url : null;
}

const EXPLORERS: Record<string, string> = {
  Solana: "https://solscan.io/token/",
  Base: "https://basescan.org/token/",
  BNB: "https://bscscan.com/token/",
  Ethereum: "https://etherscan.io/token/",
  Arbitrum: "https://arbiscan.io/token/",
  Polygon: "https://polygonscan.com/token/",
  Avalanche: "https://snowtrace.io/token/",
  Optimism: "https://optimistic.etherscan.io/token/",
};

export const EXPLORER_NAMES: Record<string, string> = {
  Solana: "Solscan",
  Base: "BaseScan",
  BNB: "BscScan",
  Ethereum: "Etherscan",
  Arbitrum: "Arbiscan",
  Polygon: "PolygonScan",
  Avalanche: "Snowtrace",
  Optimism: "OP Etherscan",
};

// Only characters that can appear in a Solana base58 or EVM hex address.
const ADDRESS_RE = /^[A-Za-z0-9]{20,64}$/;

export function explorerUrl(chain: string, address: string | null | undefined): string | null {
  if (!address || !ADDRESS_RE.test(address)) return null;
  const base = EXPLORERS[chain];
  return base ? `${base}${address}` : null;
}

export function explorerName(chain: string): string {
  return EXPLORER_NAMES[chain] ?? "Explorer";
}

export function shortenAddress(address: string | null | undefined, head = 6, tail = 4): string {
  if (!address) return "—";
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}
