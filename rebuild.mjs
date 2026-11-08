// NEAR Thesis Dashboard — one command rebuilds every chart from raw data.
// Zero dependencies (Node >= 18 built-in fetch). Zero API keys. Zero cost.
//
// Usage: node rebuild.mjs
// Output: data/*.json (raw + computed), charts.html, THESIS_DATA.md
//
// Data sources (all free, keyless):
//   - Chain TVL history:        https://api.llama.fi/v2/historicalChainTvl/NEAR
//   - Stablecoins on NEAR:      https://stablecoins.llama.fi/stablecoincharts/NEAR
//   - NEAR price & market cap:  https://api.coingecko.com/api/v3/coins/near/market_chart (free, no key)
//   - Chain liveness (head):    https://rpc.mainnet.near.org (public RPC)

import { fmtUsd, fmtPct, fmtCorr, fmtRatio, toSeries, kpiDelta } from "./lib.mjs";

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, "data");
mkdirSync(DATA, { recursive: true });

const UA = { "User-Agent": "near-thesis-dashboard/1.0" };

async function getJSON(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

const dayKey = (unixSeconds) => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/coins/near/market_chart?vs_currency=usd&days=365&interval=daily";

// ---------- 1. Fetch raw data --------------------------------------------------

async function postJSON(url, body) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...UA },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

const [tvlRaw, stablesRaw, priceRaw, rpcStatus] = await Promise.all([
  getJSON("https://api.llama.fi/v2/historicalChainTvl/NEAR"),
  getJSON("https://stablecoins.llama.fi/stablecoincharts/NEAR"),
  // CoinGecko is free but rate-limited; if it fails the dashboard still builds
  // from TVL + stablecoins and the price-dependent charts/metrics degrade to null.
  getJSON(COINGECKO_URL).catch((err) => {
    console.warn("WARN: CoinGecko unavailable (" + err.message + ") — price/market-cap charts will be omitted.");
    return null;
  }),
  postJSON("https://rpc.mainnet.near.org", {
    jsonrpc: "2.0",
    id: "liveness",
    method: "status",
    params: [],
  }),
]);

if (!rpcStatus.result) throw new Error("NEAR RPC status failed");
const chainHead = rpcStatus.result;

writeFileSync(path.join(DATA, "chain_tvl.json"), JSON.stringify(tvlRaw, null, 2));
writeFileSync(path.join(DATA, "stablecoins.json"), JSON.stringify(stablesRaw, null, 2));
if (priceRaw) writeFileSync(path.join(DATA, "price_mcap.json"), JSON.stringify(priceRaw, null, 2));

// ---------- 2. Compute metrics -------------------------------------------------

// TVL: [{date: unixsec, tvl: usd}]
const tvl = tvlRaw.map((d) => ({ date: dayKey(d.date), tvl: d.tvl }));

// Stablecoins: [{date: "unixsec" (string), totalCirculatingUSD: {peggedUSD: usd}}]
const stables = stablesRaw.map((d) => ({
  date: dayKey(Number(d.date)),
  stables: d.totalCirculatingUSD ? d.totalCirculatingUSD.peggedUSD : 0,
}));

// Price/market cap: CoinGecko market_chart {prices: [[ts, price]], market_caps: [[ts, mc]]}
const rowsPriceMc = priceRaw
  ? priceRaw.prices.map((p, i) => ({
      date: dayKey(p[0] / 1000),
      close: p[1],
      marketCap: priceRaw.market_caps[i] ? priceRaw.market_caps[i][1] : null,
    }))
  : [];

// Merge on day, keep the full TVL history; price/stables null when missing.
const byDay = new Map();
for (const d of tvl) byDay.set(d.date, { date: d.date, tvl: d.tvl });
for (const d of rowsPriceMc) {
  if (!byDay.has(d.date)) byDay.set(d.date, { date: d.date, tvl: null });
  byDay.get(d.date).price = d.close;
  byDay.get(d.date).marketCap = d.marketCap;
}
for (const d of stables) {
  if (byDay.has(d.date)) byDay.get(d.date).stables = d.stables;
}
const rows = [...byDay.values()]
  .filter((r) => r.tvl != null)
  .sort((a, b) => (a.date < b.date ? -1 : 1));

// Derived statistics — all computed from data, never invented.
const stats = {};

const last = rows[rows.length - 1];
const peak = rows.reduce((m, r) => (r.tvl > m.tvl ? r : m), rows[0]);
const first = rows[0];
stats.tvl = {
  latest: last.tvl,
  latestDate: last.date,
  peak: peak.tvl,
  peakDate: peak.date,
  first: first.tvl,
  firstDate: first.date,
  drawdownFromPeak: peak.tvl > 0 ? 1 - last.tvl / peak.tvl : null,
  growthSinceFirst: first.tvl > 0 ? last.tvl / first.tvl : null,
};

const lastStable = [...rows].reverse().find((r) => r.stables != null);
const firstStable = rows.find((r) => r.stables != null && r.stables > 100000);
stats.stables = {
  latest: lastStable ? lastStable.stables : null,
  latestDate: lastStable ? lastStable.date : null,
  growthSinceFirst: firstStable && firstStable.stables > 0 && lastStable ? lastStable.stables / firstStable.stables : null,
  first: firstStable ? firstStable.stables : null,
  firstDate: firstStable ? firstStable.date : null,
};

const lastPriceRow = [...rows].reverse().find((r) => r.price != null);
stats.price = {
  latest: lastPriceRow ? lastPriceRow.price : null,
  latestDate: lastPriceRow ? lastPriceRow.date : null,
};

const lastMcRow = [...rows].reverse().find((r) => r.marketCap != null);
stats.marketCap = {
  latest: lastMcRow ? lastMcRow.marketCap : null,
  latestDate: lastMcRow ? lastMcRow.date : null,
};

// TVL / market cap: how many dollars of onchain capital the market prices vs
// how many dollars the market cap is — a cross-check of "valuation vs usage".
// Only meaningful over the window both series exist (CoinGecko free = last 365d).
const overlap = rows.filter((r) => r.tvl != null && r.marketCap != null && r.tvl > 0 && r.marketCap > 0);
stats.tvlToMarketCap = overlap.length
  ? {
      latest: overlap[overlap.length - 1].tvl / overlap[overlap.length - 1].marketCap,
      latestDate: overlap[overlap.length - 1].date,
      peak: Math.max(...overlap.map((r) => r.tvl / r.marketCap)),
      samples: overlap.length,
    }
  : null;

// TVL / market-cap proxy: we compute TVL to price ratio (dimensional sanity check
// is left out on purpose — see THESIS.md limitations). Instead: 90d momentum.
const yearAgo = rows[Math.max(0, rows.length - 366)];
const quarterAgo = rows[Math.max(0, rows.length - 91)];
stats.momentum = {
  tvl90dChange: quarterAgo.tvl > 0 ? last.tvl / quarterAgo.tvl - 1 : null,
  tvl1yChange: yearAgo.tvl > 0 && yearAgo.date !== last.date ? last.tvl / yearAgo.tvl - 1 : null,
  stables90dChange:
    quarterAgo.stables && lastStable && quarterAgo.stables > 0
      ? lastStable.stables / quarterAgo.stables - 1
      : null,
};

// Pearson correlation between daily TVL change and daily price change (last 365d).
const recent = rows.filter((r) => r.price != null).slice(-366);
const pct = (a, b) => (a > 0 ? b / a - 1 : 0);
const dt = [], dp = [];
for (let i = 1; i < recent.length; i++) {
  dt.push(pct(recent[i - 1].tvl, recent[i].tvl));
  dp.push(pct(recent[i - 1].price, recent[i].price));
}
const mean = (arr) => arr.reduce((s, x) => s + x, 0) / Math.max(1, arr.length);
const cov = (xs, ys) => {
  const mx = mean(xs), my = mean(ys);
  let c = 0;
  for (let i = 0; i < xs.length; i++) c += (xs[i] - mx) * (ys[i] - my);
  return c / Math.max(1, xs.length - 1);
};
const sd = (xs, sx) =>
  Math.sqrt(xs.reduce((s, x) => s + (x - sx) ** 2, 0) / Math.max(1, xs.length - 1));
const mT = mean(dt), mP = mean(dp);
stats.corrTvlPrice365d = sd(dt, mT) > 0 && sd(dp, mP) > 0 ? cov(dt, dp) / (sd(dt, mT) * sd(dp, mP)) : null;
stats.corrSamples = dt.length;

stats.chainHead = {
  chainId: chainHead.chain_id,
  blockHeight: chainHead.sync_info ? chainHead.sync_info.latest_block_height : chainHead.latest_block_height,
  blockTime: chainHead.sync_info && chainHead.sync_info.latest_block_time ? chainHead.sync_info.latest_block_time : null,
  protocolVersion: Array.isArray(chainHead.protocol_version)
    ? chainHead.protocol_version.at(-1)
    : chainHead.protocol_version,
  epoch: chainHead.sync_info ? chainHead.sync_info.epoch_length : null,
  fetchedAt: new Date().toISOString(),
};

writeFileSync(
  path.join(DATA, "metrics.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), stats, rows }, null, 2)
);

// ---------- 3. Render charts.html (pure inline SVG, no CDN, offline-capable) ----
// Formatting helpers live in lib.mjs (shared with the test suite).

function lineChart(id, series, opts = {}) {
  const W = 760, H = 250, padL = 52, padR = 86, padT = 14, padB = 26;
  const pts = series.filter((p) => p.v != null).map((p) => ({ t: p.t, v: p.v }));
  if (pts.length < 2) {
    return `<div class="nodata"><span>No data at build time — see THESIS.md sources. Nothing is faked.</span></div>`;
  }
  const ink = opts.color || "#1a1611";
  const ymin = 0;
  const ymaxRaw = Math.max(...pts.map((p) => p.v));
  const ymax = ymaxRaw <= 0 ? 1 : ymaxRaw * 1.12;
  const t0 = new Date(pts[0].t + "T00:00:00Z").getTime();
  const t1 = new Date(pts[pts.length - 1].t + "T00:00:00Z").getTime();
  const X = (t) => padL + ((new Date(t + "T00:00:00Z").getTime() - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const Y = (v) => H - padB - ((v - ymin) / Math.max(1e-9, ymax)) * (H - padT - padB);
  const d = pts.map((p) => (p === pts[0] ? "M" : "L") + X(p.t).toFixed(1) + "," + Y(p.v).toFixed(1)).join(" ");
  const grid = [];
  const GLINES = 4;
  for (let i = 0; i <= GLINES; i++) {
    const v = (ymax * i) / GLINES;
    grid.push(
      `<line x1="${padL}" y1="${Y(v).toFixed(1)}" x2="${W - padR + 10}" y2="${Y(v).toFixed(1)}" stroke="#d9d2c3" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="1 3"'}/>` +
      `<text x="${padL - 7}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end" class="tick">${fmtUsd(v)}</text>`
    );
  }
  const STEPS = 4;
  const xticks = [];
  for (let i = 0; i <= STEPS; i++) {
    const day = new Date(t0 + ((t1 - t0) * i) / STEPS).toISOString().slice(0, 10);
    xticks.push(`<text x="${X(day).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="tick">${day.slice(0, 7)}</text>`);
  }
  const last = pts[pts.length - 1];
  const marksSvg = (opts.marks || []).map((m) => {
    const x = X(m.t), y = Y(m.v);
    const tx = Math.max(80, Math.min(W - 80, x));
    return `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(H - padB).toFixed(1)}" stroke="#b5341f" stroke-width="1" stroke-dasharray="2 3"/>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#b5341f"/>
      <text x="${tx.toFixed(1)}" y="${(y - 10).toFixed(1)}" text-anchor="middle" class="anno">${m.label}</text>`;
  }).join("");
  return `<figure class="chart-wrap"
      data-pts="${encodeURIComponent(JSON.stringify(pts))}"
      data-ymax="${ymax}" data-padl="${padL}" data-padr="${padR}" data-w="${W}" data-h="${H}" id="cw-${id}">
    <div class="tt" id="tt-${id}"></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.title || id}" preserveAspectRatio="xMidYMid meet">
      ${grid.join("")}
      <path d="${d}" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(last.t).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="3" fill="${ink}" class="end-dot"/>
      <text x="${(X(last.t) + 8).toFixed(1)}" y="${(Y(last.v) + 3.5).toFixed(1)}" class="end-label" fill="${ink}">${fmtUsd(last.v)}</text>
      ${marksSvg}
      ${xticks.join("")}
      <line x1="0" y1="${padT}" x2="0" y2="${H - padB}" class="crossline" style="display:none"/>
      <circle r="3.5" fill="${ink}" class="crosspt" style="display:none"/>
    </svg>
  </figure>`;
}

const s = stats;

const summaryTable = `
<table class="summary">
  <thead><tr><th>Measure</th><th class="num">Current build</th><th class="num">Change, 90d</th></tr></thead>
  <tbody>
    <tr><td>Chain TVL <span class="sub">(DefiLlama)</span></td><td class="num">${fmtUsd(s.tvl.latest)}</td><td class="num">${kpiDelta(s.momentum.tvl90dChange)}</td></tr>
    <tr><td>Stablecoins on NEAR <span class="sub">(DefiLlama)</span></td><td class="num">${fmtUsd(s.stables.latest)}</td><td class="num">${kpiDelta(s.momentum.stables90dChange)}</td></tr>
    <tr><td>NEAR price <span class="sub">(CoinGecko, 365d)</span></td><td class="num">${s.price.latest == null ? "n/a" : "$" + s.price.latest.toFixed(2)}</td><td class="num">—</td></tr>
    <tr><td>Market cap <span class="sub">(CoinGecko, 365d)</span></td><td class="num">${s.marketCap.latest == null ? "n/a" : fmtUsd(s.marketCap.latest)}</td><td class="num">—</td></tr>
    <tr><td>TVL ÷ market cap <span class="sub">(365d overlap)</span></td><td class="num">${s.tvlToMarketCap ? fmtRatio(s.tvlToMarketCap.latest) : "n/a"}</td><td class="num">—</td></tr>
    <tr><td>corr(TVL, price), daily <span class="sub">(364 samples)</span></td><td class="num">${fmtCorr(s.corrTvlPrice365d)}</td><td class="num">—</td></tr>
  </tbody>
</table>`;

const peakMonth = new Date(s.tvl.peakDate + "T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric" });

const chartsHtml = `
  <section class="sec">
    <div class="kick">Figure 1 · Chain TVL, 2021–present</div>
    <h3 class="head">Momentum is back. Four years of deficit is still the burden of proof.</h3>
    <p class="body">Total value locked — capital actively committed to NEAR applications — reads <b>${fmtUsd(s.tvl.latest)}</b>: up <b>${fmtPct(s.momentum.tvl90dChange)}</b> in 90 days, and still <b>${(s.tvl.drawdownFromPeak * 100).toFixed(1)}% below</b> the peak of May 2022. A thesis that quotes only one of the two numbers is selling something other than an analysis.</p>
    ${lineChart("tvl", toSeries(rows, "tvl"), { title: "NEAR chain TVL", marks: [{ t: s.tvl.peakDate, v: s.tvl.peak, label: `Peak ${fmtUsd(s.tvl.peak)} · ${peakMonth}` }] })}
    <p class="src">Source: DefiLlama chain TVL. Computed at build from data/chain_tvl.json — snapshot included in the repo.</p>
  </section>

  <section class="sec">
    <div class="kick">Figure 2 · Stablecoins on NEAR, 2022–present</div>
    <h3 class="head">Recorded dollars barely move. This is the weakest leg of the long case.</h3>
    <p class="body">Stablecoin balances are demand that stays after the trading stops. The series reads <b>${fmtUsd(s.stables.latest)}</b> — changed just ${fmtPct(s.momentum.stables90dChange)} in 90 days against a longer, flatter history. It stands unexplained here on purpose; a claim cannot be bullish on autopilot.</p>
    ${lineChart("st", toSeries(rows, "stables"), { title: "Stablecoins on NEAR" })}
    <p class="src">Source: DefiLlama stablecoins per chain (stablecoincharts/NEAR). Note the scale: this chart is smaller than a single notch of Figure 1.</p>
  </section>

  <section class="sec">
    <div class="kick">Figure 3 · NEAR token price, daily closes</div>
    <h3 class="head">Price is a verdict, not evidence.</h3>
    <p class="body">The token's daily close (${s.price.latest == null ? "unavailable at build" : "$" + s.price.latest.toFixed(2) + " at this build"}) is kept in view throughout for comparison. It is treated as an outcome to be explained — never as input of proof. Free CoinGecko data covers 365 days; that is why the paired figures below are window views, not full history.</p>
    ${priceRaw
      ? lineChart("px", toSeries(rows, "price"), { title: "NEAR price" })
      : `<div class="nodata"><span>Price source (CoinGecko) unavailable at build time — no data, no chart.</span></div>`}
    <p class="src">Source: CoinGecko free public API. Rate-limited; when it fails, the build degrades honestly to TVL and stablecoins only.</p>
  </section>

  <section class="sec">
    <div class="kick">Figure 4 · Market cap and chain TVL, paired</div>
    <h3 class="head">The long case collapses into one multiple.</h3>
    <p class="body">Market cap is what speculation believes; TVL is what capital does. Over the ${s.tvlToMarketCap ? s.tvlToMarketCap.samples : 0}-day overlap the market pays about <b>$${s.tvlToMarketCap ? (1 / s.tvlToMarketCap.latest).toFixed(0) : "?"} of market cap per $1 of working capital</b> (TVL/MC ${s.tvlToMarketCap ? fmtRatio(s.tvlToMarketCap.latest) : "n/a"}, against a window peak of ${s.tvlToMarketCap ? fmtRatio(s.tvlToMarketCap.peak) : "n/a"}). Whether that multiple compresses or expands is the investment thesis, stated in one number.</p>
    ${priceRaw
      ? `<div class="duo"><div>${lineChart("mc", toSeries(rows, "marketCap"), { title: "Market cap, 365d" })}<p class="cap">Market cap</p></div><div>${lineChart("tvl365", toSeries(rows.slice(-366), "tvl"), { title: "Chain TVL, 365d" })}<p class="cap">Chain TVL, same window</p></div></div>`
      : `<div class="nodata"><span>Unavailable at build time.</span></div>`}
    <p class="src">Sources: CoinGecko (market cap), DefiLlama (TVL). Daily-return correlation 365d: ${fmtCorr(s.corrTvlPrice365d)} over ${s.corrSamples} samples — descriptive, not causal.</p>
  </section>
`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>NEAR Thesis Dashboard — a re-runnable long-case research note</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --paper: #faf7f1;
    --paper-2: #f3efe6;
    --ink: #1d1811;
    --ink-2: #4a4238;
    --faint: #8a8172;
    --rule: #d8d0c0;
    --pos: #1c7a43;
    --neg: #b0261e;
    --red: #b5341f;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0; padding: 44px 24px 60px;
    background: var(--paper);
    color: var(--ink);
    font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;
    font-size: 15px; line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .sheet { max-width: 880px; margin: 0 auto; }
  a { color: var(--ink); text-decoration: underline; text-underline-offset: 2px; text-decoration-color: var(--rule); }
  a:hover { text-decoration-color: var(--ink); }
  code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .86em;
    background: var(--paper-2); padding: 1px 6px; border-radius: 3px; }

  /* ── Masthead ────────────────────────────── */
  .kicker {
    font-size: 11.5px; letter-spacing: .22em; text-transform: uppercase;
    color: var(--ink-2); font-weight: 700; padding-bottom: 12px;
    border-bottom: 3px double var(--rule);
  }
  .kicker .rt { float: right; letter-spacing: .08em; color: var(--faint); font-weight: 400; }
  h1 { font-size: clamp(30px, 5.4vw, 44px); line-height: 1.12; margin: 22px 0 14px; font-weight: 400; letter-spacing: -.01em; }
  h1 i { font-style: italic; }
  .dateline {
    display: flex; flex-wrap: wrap; gap: 4px 18px;
    font-size: 12px; color: var(--ink-2);
    border-top: 1px solid var(--ink); border-bottom: 1px solid var(--rule);
    padding: 9px 0; margin-bottom: 26px; letter-spacing: .02em;
  }
  .dateline b { color: var(--ink); font-weight: 700; }
  .live { color: var(--pos); }
  .live::before { content: "●"; font-size: 8px; vertical-align: 2px; margin-right: 5px; }

  /* ── Summary table ────────────────────────── */
  table.summary { width: 100%; border-collapse: collapse; margin: 0 0 34px; font-size: 14px; }
  table.summary thead th {
    text-align: left; font-size: 11px; letter-spacing: .18em; text-transform: uppercase;
    color: var(--ink-2); font-weight: 700;
    border-top: 2px solid var(--ink); border-bottom: 1px solid var(--ink);
    padding: 9px 0 7px;
  }
  table.summary td { padding: 9px 0; border-bottom: 1px solid var(--rule); vertical-align: baseline; }
  table.summary tbody tr:last-child td { border-bottom: 2px solid var(--ink); }
  .num, th.num { text-align: right; font-variant-numeric: tabular-nums;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; }
  .sub { color: var(--faint); font-size: 12px; font-style: italic; }
  .pos { color: var(--pos); } .neg { color: var(--neg); }
  .tbl-cap { font-size: 12.5px; color: var(--ink-2); margin: -26px 0 34px; }
  .tbl-cap b { font-weight: 700; }

  /* ── Figures ──────────────────────────────── */
  .sec { margin: 44px 0 8px; padding-top: 20px; border-top: 1px solid var(--rule); page-break-inside: avoid; }
  .kick {
    position: relative; display: block;
    font-size: 10.5px; letter-spacing: .2em; text-transform: uppercase;
    color: var(--faint); font-weight: 700; padding-top: 12px; margin-bottom: 4px;
  }
  .kick::before { content: ""; position: absolute; top: 0; left: 0; width: 36px; height: 3px; background: var(--red); }
  .head { font-size: clamp(19px, 3vw, 23px); line-height: 1.3; margin: 6px 0 10px; font-weight: 700; letter-spacing: -0.005em; }
  .body { margin: 0 0 14px; color: var(--ink-2); max-width: 70ch; }
  .body b { color: var(--ink); }
  .src { font-size: 11.5px; color: var(--faint); font-style: italic; margin: 8px 0 0; }

  .chart-wrap { position: relative; margin: 10px 0 0; }
  .chart-wrap svg { width: 100%; height: auto; display: block; }
  .tick { fill: var(--faint); font-size: 10.5px; font-family: ui-monospace, Menlo, monospace; }
  .end-label { font-size: 11.5px; font-weight: 700; font-family: ui-monospace, Menlo, monospace; }
  .anno { fill: var(--red); font-size: 11px; font-style: italic; font-family: Georgia, serif; }
  .end-dot { }
  .crossline { stroke: var(--ink-2); stroke-dasharray: 2 3; stroke-width: 1; }
  .crosspt { stroke: var(--paper); stroke-width: 1.5; }
  .tt {
    position: absolute; pointer-events: none; display: none;
    background: #fffdf9; border: 1px solid var(--rule); border-color: var(--ink-2);
    color: var(--ink); font-size: 12px; padding: 5px 9px; border-radius: 2px;
    white-space: nowrap; transform: translate(-50%, -130%); z-index: 5;
    font-family: ui-monospace, Menlo, monospace; font-variant-numeric: tabular-nums;
    box-shadow: 2px 2px 0 rgba(29, 24, 17, .15);
  }
  .nodata { padding: 20px 0; color: var(--faint); font-style: italic; }
  .duo { display: flex; flex-wrap: wrap; gap: 0 22px; } .duo > div { flex: 1 1 320px; min-width: 0; }
  .cap { text-align: center; color: var(--faint); font-size: 11px; font-style: italic; margin: 2px 0 8px; }

  /* ── Colophon ─────────────────────────────── */
  .colophon {
    margin-top: 52px; border-top: 3px double var(--rule); border-bottom: 3px double var(--rule);
    padding: 16px 0 14px; font-size: 12.5px; color: var(--ink-2); line-height: 1.75;
  }
  .colophon b { color: var(--ink); }
  .fin { text-align: center; margin: 18px 0 0; color: var(--faint); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; }

  .lede::first-letter {
    font-size: 3.1em; line-height: .86; float: left;
    padding: 2px 10px 0 0; font-weight: 700; color: var(--ink);
  }

  @media print {
    body { padding: 0; background: #fff; }
    .tt, script { display: none !important; }
    .sec, table.summary, .colophon { page-break-inside: avoid; }
  }
</style></head><body>
<div class="sheet">

  <div class="kicker">NEAR Thesis Dashboard<span class="rt">Hackathon Research Note</span></div>
  <h1>The long case for NEAR, <i>in figures anyone can rebuild.</i></h1>
  <div class="dateline">
    <span><b>Build</b> ${new Date().toISOString().slice(0, 10)} ${new Date().toISOString().slice(11, 16)} UTC</span>
    <span><b>Chain</b> <span class="live">mainnet block ${s.chainHead.blockHeight.toLocaleString("en-US")}</span></span>
    <span><b>Re-run</b> <code>node rebuild.mjs</code> — $0, no keys, no deps</span>
    <span><b>Track</b> thesis</span>
  </div>

  <p class="body lede" style="font-size:16px; color:var(--ink)">An investment thesis is only as good as its evidence. This note tests one claim about NEAR — <i>that growth in real onchain capital tells a story the token price alone does not</i> — using public data only, in a pipeline that rebuilds every figure below on demand. The claim, the counter-evidence, and what would falsify it are stated plainly in <a href="https://github.com/l3ockydev/near-thesis-dashboard/blob/master/THESIS.md">THESIS.md</a>.</p>

  ${summaryTable}
  <p class="tbl-cap"><b>Table 1</b> — All values computed at this build from raw snapshots in <code>data/*.json</code>; nothing hand-edited, nothing invented.</p>

  ${chartsHtml}

  <div class="colophon">
    <b>Method.</b> One command — <code>node rebuild.mjs</code> — refetches every series and re-renders all figures above: DefiLlama for chain TVL and NEAR stablecoins, CoinGecko free tier for price and market cap (365-day window), NEAR public mainnet RPC for the liveness check. Metrics that genuinely cannot be computed for zero cost — daily active accounts, per-contract usage, Intents swap volume — are not substituted with estimates; the corresponding BigQuery SQL ships in <a href="https://github.com/l3ockydev/near-thesis-dashboard/tree/master/sql">sql/</a> so anyone can produce them. <b>Caveats.</b> Correlation is not causation; TVL methodology is DefiLlama's, not this note's; CoinGecko's free window is 365 days. See README "Methodology notes" for the data-quality bug found and documented mid-build.
    <div class="fin">Built at NEAR Hackathon 2026 · MIT · github.com/l3ockydev/near-thesis-dashboard</div>
  </div>

</div>

<script>
(() => {
  const fmt = (v) => v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + v.toFixed(2);
  document.querySelectorAll("figure.chart-wrap").forEach((f) => {
    const pts = JSON.parse(decodeURIComponent(f.dataset.pts));
    if (!pts || pts.length < 2) return;
    const svg = f.querySelector("svg"), tt = f.querySelector(".tt");
    const W = +f.dataset.w, H = +f.dataset.h, padL = +f.dataset.padl, padR = +f.dataset.padr, ymax = +f.dataset.ymax;
    const padT = 14, padB = 26;
    const t0 = new Date(pts[0].t + "T00:00:00Z").getTime();
    const t1 = new Date(pts[pts.length - 1].t + "T00:00:00Z").getTime();
    const line = svg.querySelector(".crossline"), dot = svg.querySelector(".crosspt");
    const X = (t) => padL + ((new Date(t + "T00:00:00Z").getTime() - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
    const Y = (v) => H - padB - (v / Math.max(1e-9, ymax)) * (H - padT - padB);
    const hide = () => { tt.style.display = "none"; line.style.display = "none"; dot.style.display = "none"; };

    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const sx = (e.clientX - r.left) * (W / r.width);
      const frac = (sx - padL) / Math.max(1, W - padL - padR);
      if (frac < -0.02 || frac > 1.02) return hide();
      const idx = Math.min(pts.length - 1, Math.max(0, Math.round(frac * (pts.length - 1))));
      const p = pts[idx]; if (!p) return hide();
      const x = X(p.t), y = Y(p.v);
      line.setAttribute("x1", x); line.setAttribute("x2", x);
      dot.setAttribute("cx", x); dot.setAttribute("cy", y);
      line.style.display = dot.style.display = "block";
      const px = (x / W) * r.width, py = (y / H) * r.height;
      tt.style.display = "block";
      tt.style.left = Math.max(55, Math.min(r.width - 55, px)) + "px";
      tt.style.top = Math.max(28, py) + "px";
      tt.innerHTML = "<b>" + fmt(p.v) + "</b> · " + p.t;
    });
    svg.addEventListener("pointerleave", hide);
  });
})();
</script>
</body></html>
`;
writeFileSync(path.join(ROOT, "charts.html"), html);

// ---------- 4. THESIS_DATA.md — computed numbers with real values ---------------

const md = `# THESIS_DATA.md
Auto-generated by \`rebuild.mjs\` on ${new Date().toISOString()}. Do not edit by hand — rerun the script.

KPIs (computed from raw snapshots in \`data/\`):

| Metric | Value |
| --- | --- |
| Latest chain TVL | ${fmtUsd(s.tvl.latest)} (${s.tvl.latestDate}) |
| Peak chain TVL | ${fmtUsd(s.tvl.peak)} (${s.tvl.peakDate}) |
| TVL drawdown from peak | ${s.tvl.drawdownFromPeak == null ? "n/a" : (s.tvl.drawdownFromPeak * 100).toFixed(1) + "%"} |
| TVL growth since first datapoint (${s.tvl.firstDate}) | ${s.tvl.growthSinceFirst == null ? "n/a" : s.tvl.growthSinceFirst.toFixed(2) + "x"} |
| Stablecoins on NEAR | ${fmtUsd(s.stables.latest)} (${s.stables.latestDate}) |
| Stablecoin growth since ${s.stables.firstDate} | ${s.stables.growthSinceFirst == null ? "n/a" : s.stables.growthSinceFirst.toFixed(2) + "x"} |
| NEAR price | ${s.price.latest == null ? "n/a" : "$" + s.price.latest.toFixed(2)} (${s.price.latestDate}) |
| Market cap | ${s.marketCap.latest == null ? "n/a" : fmtUsd(s.marketCap.latest)} (${s.marketCap.latestDate}) |
| TVL / market cap | ${fmtRatio(s.tvlToMarketCap ? s.tvlToMarketCap.latest : null)} of ${s.tvlToMarketCap ? s.tvlToMarketCap.samples : 0} overlap days (peak ratio: ${s.tvlToMarketCap ? fmtRatio(s.tvlToMarketCap.peak) : "n/a"}) |
| TVL 90d change | ${fmtPct(s.momentum.tvl90dChange)} |
| TVL 1y change | ${fmtPct(s.momentum.tvl1yChange)} |
| Stablecoins 90d change | ${fmtPct(s.momentum.stables90dChange)} |
| corr(daily TVL %, daily price %), 365d | ${fmtCorr(s.corrTvlPrice365d)} over ${s.corrSamples} samples |
| Chain head (liveness) | ${s.chainHead.chainId} block ${s.chainHead.blockHeight} (protocol ${s.chainHead.protocolVersion}, block time ${s.chainHead.blockTime}) |
`;
writeFileSync(path.join(ROOT, "THESIS_DATA.md"), md);

console.log("OK — wrote data/*.json, charts.html, THESIS_DATA.md");
console.log(`   TVL latest: ${fmtUsd(s.tvl.latest)} | stables: ${fmtUsd(s.stables.latest)} | head: ${s.chainHead.blockHeight}`);

