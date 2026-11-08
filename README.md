# NEAR Thesis Dashboard

Built at **NEAR HACKATHON** · Track: `thesis` (Investment Thesis)

An evidence-first investment thesis on NEAR that anyone can re-run for **$0**: one command
rebuilds every chart and every number from raw public data. No API keys, no dependencies,
no paid services — and every claim has an evidence counterweight in THESIS.md.

## What it is — do X, see Y

| Step | Command / action | What you see |
| --- | --- | --- |
| 1 | `node rebuild.mjs` | console prints the KPI check line (`TVL latest: … \| stables: … \| head: …`) |
| 2 | open `charts.html` in a browser | 4 charts: chain TVL, stablecoins on NEAR, token price, market cap vs TVL — plus a live mainnet block-height check |
| 3 | open `THESIS_DATA.md` | every KPI as a table, freshly computed (never hand-edited) |
| 4 | open `THESIS.md` | the claim, evidence for, evidence against, falsification criteria, and what cannot be computed |
| 5 | open `data/*.json` | the raw snapshots the numbers come from (chain_tvl, stablecoins, price_mcap) |
| 6 | open `sql/*.sql` | BigQuery queries a judge can run on the public NEAR dataset for metrics we do not compute here |

Requirements: Node.js >= 18 only. There are **zero npm dependencies** — no install step exists.

## How to try (judge checklist)

1. Clone this repo. Run `node rebuild.mjs`. It must succeed on any network (see the degradation note below).
2. Run `node --test`. 13/13 checks must pass (formatting helpers and honest-null behavior; Node >= 18 built-in `node:test`, no dependencies).
3. Open `charts.html`. Note the build timestamp, chain head block, and the `data/*.json` fingerprints.
4. Spot-check any number in `THESIS_DATA.md` against the raw JSON in `data/`.
5. The rerun produces fresh numbers — they will not equal the committed ones in value (data moves on), and that is the point: the pipeline is the evidence, not a static screenshot.

## Data sources (all free, keyless)

| Source | What | URL |
| --- | --- | --- |
| DefiLlama | NEAR chain TVL history (daily) | `https://api.llama.fi/v2/historicalChainTvl/NEAR` |
| DefiLlama | Stablecoins circulating on NEAR (daily) | `https://stablecoins.llama.fi/stablecoincharts/NEAR` |
| CoinGecko (free) | NEAR price and market cap, last 365 days | `https://api.coingecko.com/api/v3/coins/near/market_chart` |
| NEAR public RPC | mainnet chain head (liveness) | `https://rpc.mainnet.near.org` |

Re-run cost: **$0**. All endpoints are public and keyless (CoinGecko free tier is
rate-limited; on failure the build still completes and price/market-cap charts are
marked unavailable rather than faked or cached).

## NEAR's role

- The analyzed object is NEAR itself: NEAR the chain is the thesis subject (track requirement).
- The liveness check queries NEAR mainnet directly through the public RPC.
- `sql/` targets the official NEAR BigQuery public dataset
  (`bigquery-public-data.crypto_near_mainnet_us`), always filtered on `block_date`.
- Libraries/templates used: Node stdlib only (`fetch`, `fs`, `path`, `url`). DefiLlama and
  CoinGecko are third-party data APIs whose terms allow non-commercial reads; attribution is shown on each chart.

## Methodology notes (honesty items)

- **Chain filter bug found mid-build**: `stablecoins.llama.fi/stablecoincharts/all?chain=NEAR`
  returned *global* stablecoin totals (~$292B) while the path form
  `/stablecoincharts/NEAR` returns the per-chain series (~$130M). The repo uses the path
  form; the repo history contains both. Sane-number checks are part of `rebuild.mjs` output.
- **Correlation is not causation**, and 365 samples of daily returns move with fat tails.
  The Pearson figure is displayed as a descriptive statistic, not a proof of anything.
- **Which we do not compute** (and say so instead of faking): daily active accounts,
  transaction counts, per-contract usage and NEAR Intents swap volume — the first three
  require BigQuery (metered cost; SQL provided for anyone with access), the last needs a
  1Click partner JWT that this zero-cost build deliberately does not depend on. See THESIS.md.

## License

MIT — see `LICENSE`.