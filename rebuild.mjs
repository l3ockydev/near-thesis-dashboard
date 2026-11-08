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

const fmtUsd = (v) => {
  if (v == null) return "n/a";
  if (Math.abs(v) >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (Math.abs(v) >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (Math.abs(v) >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
  return "$" + v.toFixed(0);
};
const fmtPct = (v) => (v == null ? "n/a" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%");
const fmtCorr = (v) => (v == null ? "n/a" : v.toFixed(3));
const fmtRatio = (v) => {
  if (v == null) return "n/a";
  const pctVal = v * 100;
  const pctStr = Math.abs(pctVal) >= 10 ? pctVal.toFixed(0) + "%" : pctVal.toFixed(1) + "%";
  return v.toFixed(3) + " (" + pctStr + ")";
};

function lineChart(id, series, opts = {}) {
  const W = 760, H = 260, padL = 62, padR = 12, padT = 16, padB = 30;
  const pts = series.filter((p) => p.v != null);
  if (pts.length < 2) return `<p>Not enough data points.</p>`;
  const ymin = opts.ymin ?? 0;
  const ymax = Math.max(...pts.map((p) => p.v));
  const t0 = new Date(pts[0].t).getTime();
  const t1 = new Date(pts[pts.length - 1].t).getTime();
  const x = (t) => padL + ((new Date(t).getTime() - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const y = (v) => H - padB - ((v - ymin) / Math.max(1e-9, ymax - ymin)) * (H - padT - padB);
  const pathAttr = pts.map((p) => (p === pts[0] ? "M" : "L") + x(p.t).toFixed(1) + "," + y(p.v).toFixed(1)).join(" ");
  const ticks = [
    { v: ymin, label: fmtUsd(ymin) },
    { v: ymax, label: fmtUsd(ymax) },
  ];
  const xlabels = [];
  for (let i = 0; i <= 4; i++) {
    const d = new Date(t0 + ((t1 - t0) * i) / 4);
    xlabels.push({ x: x(d.toISOString()), label: d.toISOString().slice(0, 7) });
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.title}">
    <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#334" />
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="#334" />
    ${ticks.map((tk) => `<text x="${padL - 6}" y="${y(tk.v) + 4}" text-anchor="end" font-size="11" fill="#89a">${tk.label}</text>`).join("")}
    <path d="${pathAttr}" fill="none" stroke="${opts.color || "#5ad"}" stroke-width="2" />
    ${xlabels.map((l) => `<text x="${l.x}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#89a">${l.label}</text>`).join("")}
  </svg>`;
}

const toSeries = (rows, key) =>
  rows.map((r) => ({ t: r.date, v: r[key] ?? null }));

const kpi = (v, sub) =>
  `<div class="kpi"><b>${v}</b><span>${sub}</span></div>`;

const s = stats;

const chartsHtml = `
  <section class="card">
    <h2>1. NEAR chain TVL over time</h2>
    <p class="plain">Real capital deposited on NEAR applications — the simplest proxy for real demand for the chain.</p>
    ${lineChart("tvl", toSeries(rows, "tvl"), { title: "NEAR TVL", color: "#5df" })}
    <p class="src">Source: DefiLlama chain TVL (api.llama.fi), (c) DefiLlama, free attribution license.</p>
  </section>

  <section class="card">
    <h2>2. Stablecoins circulating on NEAR</h2>
    <p class="plain">Dollars that live on NEAR even when people are not trading — slower money, arguably stickier demand.</p>
    ${lineChart("st", toSeries(rows, "stables"), { title: "Stablecoins on NEAR", color: "#5f9" })}
    <p class="src">Source: DefiLlama stablecoins per chain (stablecoins.llama.fi), (c) DefiLlama.</p>
  </section>

  <section class="card">
    <h2>3. NEAR token price (daily close, last 365d)</h2>
    <p class="plain">What the market pays for the token — we compare it against usage, not treat it as usage.</p>
    ${priceRaw ? lineChart("px", toSeries(rows, "price"), { title: "NEAR price", color: "#f93" }) : "<p>Price source (CoinGecko) unavailable at build time — see THESIS.md sources. No data, no chart.</p>"}
    <p class="src">Source: CoinGecko free public API (api.coingecko.com), last 365 days.</p>
  </section>

  <section class="card">
    <h2>4. Market cap vs TVL (last 365d)</h2>
    <p class="plain">Neither of these alone is "fabricated" — both are real market observations: market cap (speculative value) and TVL (capital actively used in NEAR apps).</p>
    ${priceRaw ? `<div class="dual">${lineChart("px2", toSeries(rows, "price"), { title: "Market cap", color: "#f93" })}${lineChart("mc", toSeries(rows, "marketCap"), { title: "Market cap", color: "#a6e" })}</div>` : "<p>Unavailable at build time.</p>"}
    <p class="src">Source: CoinGecko (market cap) + DefiLlama (TVL). Correlation: see THESIS_DATA.md. TVL/market-cap ratio today: ${fmtRatio(stats.tvlToMarketCap ? stats.tvlToMarketCap.latest : null)} of 365d overlap samples.</p>
  </section>
`;

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<title>NEAR Thesis Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { background:#0b0e14; color:#dde; font-family: system-ui, sans-serif; max-width: 860px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 22px; } h2 { font-size: 17px; color:#cff; margin-bottom: 4px; }
  .card { background:#11151f; border: 1px solid #22303f; border-radius: 10px; padding: 14px 18px; margin: 16px 0; }
  .plain { color:#aab; font-size: 14px; margin-top:0; }
  .src { color:#567; font-size: 11px; }
  .kpis { display:flex; flex-wrap: wrap; gap: 10px; }
  .kpi { display:flex; flex-direction: column; background:#151b29; padding: 10px 14px; border-radius: 8px; min-width: 140px;}
  .kpi b { font-size: 20px; color:#fff; } .kpi span { color:#789; font-size: 12px; }
  .meta { color:#567; font-size: 12px; }
  .dual { display: flex; flex-wrap: wrap; gap: 8px; } .dual svg { flex: 1 1 300px; }
</style></head><body>
<h1>NEAR Thesis Dashboard</h1>
<p class="plain">An evidence-first, fully re-runnable look at one question: <i>does the growth of real onchain capital on NEAR (TVL and stablecoins) tell a long-term story that the token price alone does not?</i> Built at NEAR HACKATHON.</p>
<div class="kpis">
  ${kpi(fmtUsd(s.tvl.latest), `TVL, as of ${s.tvl.latestDate}`)}
  ${kpi(fmtUsd(s.tvl.peak), `Peak TVL, ${s.tvl.peakDate}`)}
  ${kpi(fmtUsd(s.stables.latest), `Stablecoins, as of ${s.stables.latestDate}`)}
  ${kpi(fmtPct(s.momentum.tvl90dChange), "TVL change, 90 days")}
  ${kpi(fmtCorr(s.corrTvlPrice365d), "corr(daily TVL%, daily price%), 365d (" + s.corrSamples + " samples)")}
  ${kpi(fmtRatio(s.tvlToMarketCap ? s.tvlToMarketCap.latest : null), "TVL / market cap, as of " + (s.tvlToMarketCap ? s.tvlToMarketCap.latestDate : "n/a") + " (" + (s.tvlToMarketCap ? s.tvlToMarketCap.samples : 0) + " overlap days)")}
  ${kpi("#" + s.chainHead.blockHeight.toLocaleString("en-US"), "NEAR mainnet block height (liveness)")}</div>
<p class="meta">Chain head: ${s.chainHead.chainId}, block ${s.chainHead.blockHeight} (protocol ${s.chainHead.protocolVersion}, epoch ${s.chainHead.epoch}, latest block time ${s.chainHead.blockTime}) via public RPC rpc.mainnet.near.org, fetched ${s.chainHead.fetchedAt}. Rebuild everything with <code>node rebuild.mjs</code>. Every number above is computed from the raw JSON snapshots in <code>data/</code>. What we cannot compute from these sources is listed in THESIS.md — nothing is made up.</p>
${chartsHtml}
<p class="src">Method, claim, counter-evidence and falsification criteria: see THESIS.md and THESIS_DATA.md in the repository.</p>
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
