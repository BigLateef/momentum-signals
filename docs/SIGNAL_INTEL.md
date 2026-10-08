# Signal cards & alerts — data sources and integration needs

Rule: every value shown is a real provider value or **UNKNOWN**. Nothing is
defaulted to 0, derived from another metric, or guessed.

## Deploy order
1. Apply `migrations/005_signal_token_intel.sql` (additive; new table only).
2. Deploy the code. If you deploy first, nothing breaks: snapshot reads/writes
   are best-effort and cards show "No market snapshot recorded" until the table
   exists. Active signals get a snapshot on the next price-refresh cycle (~5 min).

## Field status

| Field | Source | Status |
|---|---|---|
| Name, ticker, chain, DEX id, pair address, chart link | DexScreener | Live |
| Contract address + copy, explorer link | signal record; explorer URL built from chain | Live |
| Token image | DexScreener `info.imageUrl` (DexScreener CDN hosts only) | Live, only for tokens with a DexScreener profile |
| Pair age | DexScreener `pairCreatedAt` | Live — this is the *pair's* age, labelled as such |
| Signal age / first detected / status | `signals` table | Live |
| Price, change 5m/1h/6h/24h, volume, liquidity, buys/sells (txn counts) | DexScreener | Live |
| Market cap, FDV | DexScreener `marketCap` / `fdv` | Live when reported |
| X / website / other links | DexScreener `info` | Live; shown as **listed · unverified**. "None listed" ≠ "UNKNOWN" (no profile) |
| Holders, top 1/5/10, mint/freeze, transfer restrictions, LP locked %, deployer %, buy/sell tax | Existing RugCheck / GoPlus checks (now carry structured `data`) | Live; RugCheck holder/LP fields depend on the still-unverified field mapping noted in HANDOFF.md |
| Deployer history / previous launches | This platform's own past reports | Live, labelled "platform history only" |
| Verdict, provider status, freshness | Existing safety report | Live |
| **Circulating / total supply** | — | **Not integrated.** Candidates: GoPlus `total_supply` (EVM, already in the response type); RugCheck supply + decimals (needs a verified raw sample). Circulating supply has no reliable free source for new tokens. |
| **ATH / drawdown** | — | **Not integrated.** Needs OHLCV history. Candidate: GeckoTerminal pool OHLCV endpoint (verify rate limits/terms), or Birdeye. Would show ATH *since first candle*, cached per signal. |
| **Bundler / sniper wallets and counts** | — | **Not integrated.** Needs on-chain launch-block analysis: e.g. Solana RPC/Helius tx history, Bitquery, or a cluster API such as Bubblemaps. Check whether RugCheck's full report already includes insider/cluster fields (use the existing raw-response capture) before buying anything. |
| **Deployer selling activity, LP lock expiry** | — | **Not integrated.** Same on-chain-history provider as above; RugCheck market/lock data may cover lock expiry (verify). |
| **Confluence** | — | No such metric exists in the scanner. Card shows momentum score + confidence *tier* (liquidity/volume based, not a probability). |

Candidate providers above are suggestions from general knowledge; confirm
endpoints, pricing and response shape against a real response before building.

## Behaviour notes
- The Discord alert is sent at signal creation, **before** the safety stage
  runs (unchanged). The richer alert therefore states "Safety: UNKNOWN —
  analysis runs after this alert". Existing behaviour worth knowing: the
  safety stage can deactivate a signal after its alert has already posted.
- Market data older than 15 min on an active signal is flagged stale; closed
  signals show their last snapshot as frozen. Safety older than 60 min is stale.
- `chartUrl` and provider links are restricted to https; token images to
  DexScreener hosts; Discord text is escaped and `allowed_mentions` disabled.
- No scoring, verdict, eligibility, trading or alert-gating logic changed.
  `SafetyCheckResult.data` is display-only.

## Rollback
`DROP TABLE IF EXISTS signal_token_intel;` — cards fall back to "unavailable".
