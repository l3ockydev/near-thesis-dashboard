// test.mjs — zero-dependency test suite (node:test, Node >= 18) for lib.mjs.
// Run with: node --test
// These test the REAL helpers the build uses (imported, not copies).

import test from "node:test";
import assert from "node:assert/strict";
import { fmtUsd, fmtPct, fmtCorr, fmtRatio, toSeries, kpiDelta } from "./lib.mjs";

test("fmtUsd: null/nullish -> n/a", () => {
  assert.equal(fmtUsd(null), "n/a");
  assert.equal(fmtUsd(undefined), "n/a");
});

test("fmtUsd: thousands -> $K with one decimal", () => {
  assert.equal(fmtUsd(1000), "$1.0K");
  assert.equal(fmtUsd(2500), "$2.5K");
});

test("fmtUsd: millions -> $M (TVL/stables scale)", () => {
  assert.equal(fmtUsd(2_500_000), "$2.5M");
  assert.equal(fmtUsd(169_700_000), "$169.7M");
});

test("fmtUsd: billions -> $B (market-cap scale)", () => {
  assert.equal(fmtUsd(4_780_000_000), "$4.78B");
});

test("fmtUsd: below 1k -> plain dollars", () => {
  assert.equal(fmtUsd(0), "$0");
  assert.equal(fmtUsd(999), "$999");
});

test("fmtPct: null -> n/a; signs and one decimal", () => {
  assert.equal(fmtPct(null), "n/a");
  assert.equal(fmtPct(0), "+0.0%");
  assert.equal(fmtPct(0.084), "+8.4%");
  assert.equal(fmtPct(-0.648), "-64.8%");
});

test("fmtCorr: null -> n/a; three decimals", () => {
  assert.equal(fmtCorr(null), "n/a");
  assert.equal(fmtCorr(0.306), "0.306");
  assert.equal(fmtCorr(0), "0.000");
});

test("fmtRatio: null -> n/a; small ratio -> one decimal pct", () => {
  assert.equal(fmtRatio(null), "n/a");
  assert.equal(fmtRatio(0.036), "0.036 (3.6%)");
  assert.equal(fmtRatio(0), "0.000 (0.0%)");
});

test("fmtRatio: >= 10 pct -> whole percent", () => {
  assert.equal(fmtRatio(0.5), "0.500 (50%)");
  assert.equal(fmtRatio(0.12), "0.120 (12%)");
});

test("toSeries: maps {date,key} -> {t,v}; missing key -> null (honest gaps)", () => {
  const rows = [
    { date: "2026-01-01", tvl: 40_000_000, price: 1.23 },
    { date: "2026-01-02", tvl: 42_000_000 }, // price missing on purpose
  ];
  const s = toSeries(rows, "price");
  assert.deepEqual(s[0], { t: "2026-01-01", v: 1.23 });
  assert.equal(s[1].v, null);
});

test("kpiDelta: null -> em dash (no invented delta)", () => {
  assert.equal(kpiDelta(null), "—");
});

test("kpiDelta: positive -> up arrow + signed pct + class pos", () => {
  const out = kpiDelta(0.084);
  assert.ok(out.includes("▲"), "up arrow present");
  assert.ok(out.includes("+8.4%"));
  assert.ok(out.includes('class="pos"'));
});

test("kpiDelta: negative -> down arrow + signed pct + class neg", () => {
  const out = kpiDelta(-0.005);
  assert.ok(out.includes("▼"));
  assert.ok(out.includes("-0.5%"));
  assert.ok(out.includes('class="neg"'));
});
