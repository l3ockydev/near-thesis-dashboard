// lib.mjs — pure formatting helpers shared by rebuild.mjs and the test suite.
// No side effects: importing this module never fetches anything.

export const fmtUsd = (v) => {
  if (v == null) return "n/a";
  if (Math.abs(v) >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (Math.abs(v) >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (Math.abs(v) >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
  return "$" + v.toFixed(0);
};

export const fmtPct = (v) => (v == null ? "n/a" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%");

export const fmtCorr = (v) => (v == null ? "n/a" : v.toFixed(3));

export const fmtRatio = (v) => {
  if (v == null) return "n/a";
  const pctVal = v * 100;
  const pctStr = Math.abs(pctVal) >= 10 ? pctVal.toFixed(0) + "%" : pctVal.toFixed(1) + "%";
  return v.toFixed(3) + " (" + pctStr + ")";
};

export const toSeries = (rows, key) =>
  rows.map((r) => ({ t: r.date, v: r[key] ?? null }));

export const kpiDelta = (v) =>
  v == null ? "—" : `<span class="${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "▲" : "▼"} ${fmtPct(v)}</span>`;
