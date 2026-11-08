# THESIS.md

## Claim

> NEAR's long-term value rests on real onchain capital (TVL and stablecoins living on the
> chain). These grow on their own schedule and are *not* explained by the token's day-to-day
> price. A long-term bet on NEAR is therefore effectively a bet that onchain capital
> formation continues to grow — and that metric is observable, without trust, using only
> free public data.

This is deliberately a *re-run anything* thesis: `node rebuild.mjs` rebuilds every number.

## Evidence from this build's own data (auto-generated, see THESIS_DATA.md)

These figures are real outputs of `rebuild.mjs` from raw public snapshots; update them by
re-running — the script never hand-edits numbers.

- 90-day TVL change: **+88.4%** — onchain capital formation accelerated sharply within the last quarter.
- Stablecoins on NEAR: **$130.5M**, +1.9% in 90 days — slow but nonzero dollar presence.
- corr(daily TVL %, daily price %) over 364 samples: **0.306** — positive but weak. Daily
  price moves do *not* closely track daily capital-in moves. Interpretation (careful): usage
  and price are partially decoupled in the short term.
- TVL / market cap: **~3.7%** currently (365-day overlap), peak ~6.5% — i.e., the market
  currently pays ~$27 per $1 of active onchain capital. This is the "valuation vs usage"
  cross-check.

## Evidence against the claim (from the same data)

- TVL is still **63.9% below** its 2022 peak ($481.7M → $174.1M). "Capital formation
  continues to grow" is emphatically false on a 4-year horizon.
- 1-year TVL change: **–5.5%** — the 90-day burst sits inside a flat-to-down year.
- Stablecoins have grown only **1.16x since mid-2022** — dollar residents do not treat
  NEAR as a large settlement chain.
- The daily correlation (0.306) also admits the opposite reading: part of the TVL moves
  *because of* price (measured TVL includes token-priced assets), so TVL is not a clean
  "independent" usage signal.

## What would change my mind (falsification)

1. TVL and stablecoin growth on NEAR going negative together for **4+ consecutive quarters**
   (`rebuild.mjs` prints both; the `data/` history covers the window). Thesis out.
2. TVL/market-cap ratio approaching zero (market cap decoupling from usage entirely) while
   stablecoins also shrink — i.e., pure narrative valuation. Thesis out.
3. BigQuery-based daily active accounts (see `sql/`) showing canonical usage at a small fixed
   set of contracts rather than economic activity — would falsify this build's *reasoning*
   about "real usage" even if TVL rises. Inspectable, not hidden.

## What this build cannot compute (and does not fake)

- **Daily active accounts, tx counts, contract usage**: these require the NEAR BigQuery
  public dataset, which incurs metered BigQuery cost — incompatible with this
  repo's zero-cost promise. `sql/01_daily_active_accounts.sql` and
  `sql/02_contract_usage.sql` are provided so any judge with BigQuery access can produce them.
- **NEAR Intents swap volume**: the Explorer API requires a 1Click partner JWT
  (https://partners.near-intents.org), not obtainable with $0. Marked out of scope instead of invented.
- *CoinGecko free tier* supplies only 365 days of price/market-cap. The earlier TVL rows
  have no coinciding price, so the two-series charts are 365d-window views, not full history.

## Related work (what exists, and how this build differs)

Public NEAR dashboards are plentiful. None of them, at the time of writing, publishes a
zero-cost pipeline that reproduces its own numbers. This build's position against the
existing landscape:

- **DefiLlama — NEAR chain page** (defillama.com/chain/near). The most complete free
  surface for NEAR's TVL, stablecoins, fees, revenue and DEX volume. This project takes
  DefiLlama's raw endpoints as data sources rather than as analysis, and adds the layer
  DefiLlama does not provide: a re-runnable pipeline (`node rebuild.mjs`), a stated claim
  with counter-evidence, and reproducible snapshots committed to the repo.
- **revenue.near.org** (official NEAR dashboard). Presents the protocol's own 2026
  narrative — fee capture funding buybacks, deflation as a measurable threshold. Valuable,
  but it is the promoter's own dashboard: metric windows and framing are chosen by the
  party with the thesis to sell. This build exists precisely because outside parties
  should be able to recreate the numbers behind any such narrative.
- **near.org/research-analytics hub** (Artemis, Dune, Flipside, DappRadar). Third-party
  investor dashboards with broader multi-chain scope than this build. They require
  accounts/infrastructure and expose no re-runnable artifact; the numbers a judge sees
  cannot be traced to source data the way `data/*.json` snapshots can here.
- **Oak Research** (oakresearch.io/projects/Near) and similar institutional notes.
  Substantive analysis behind gated reports; not reproducible at $0.
- **Price-prediction articles** (e.g. "$9.50–$15.25 by 2026" genre). Included only to name
  the genre this build deliberately rejects: a thesis on conviction with no falsifiable
  criteria, no counter-evidence, and no data a reader can rerun.
- **"TVL mirrors token prices" critique** (daic.capital, "Blockchain in 2026: Beyond
  Price and TVL"). Independently argues that TVL alone is a weak indicator and that
  stablecoin supply and payment volume are the better 2026 signals — the same pairing
  this build puts at the center of its claim. Cited as convergent support, not as
  substitute evidence.
- **NEAR Intents volume (Q3 2026: ~$10.4B, +66.8% QoQ)**. A major capital-flow leg of the
  2026 thesis that this build cannot compute for free (see "What this build cannot
  compute") and therefore does not use. Anyone with BigQuery access can extend the
  analysis via `sql/`.

The one-sentence difference: every source above shows you numbers; this repo shows you
numbers **and** hands you the machine that produced them.

## Sources & raw data

- BigQuery-ish sanity of the used endpoints is handled by DefiLlama's published methodology
  for chain TVL; per their attribution license, charts credit DefiLlama.
- The chain-filter bug this project hit (see README "Methodology notes") is a reminder that
  even credible public dashboards can be quoted wrongly by the very tooling meant to lower
  the bar to entry — reproducing rather than trusting is the whole point of the build.
