import assert from "node:assert/strict";
import test from "node:test";

import { dailyUsageTotals, reportingDate } from "../shared/usage-metrics.mjs";

test("treats a missing current-day bucket as pending instead of zero", () => {
  const totals = dailyUsageTotals([
    { date: "2026-07-12", tokens: 10 },
    { date: "2026-07-13", tokens: 25 },
  ], new Date(2026, 6, 14, 12));

  assert.equal(totals.hasToday, false);
  assert.equal(totals.today, 0);
  assert.equal(totals.month, 35);
  assert.equal(totals.latestDate, "2026-07-13");
});

test("preserves a reported zero when the current-day bucket exists", () => {
  const totals = dailyUsageTotals([
    { date: "2026-07-14", tokens: 0 },
  ], new Date(2026, 6, 14, 12));

  assert.equal(totals.hasToday, true);
  assert.equal(totals.today, 0);
});

test("anchors a delayed chart to the reporting date", () => {
  const date = reportingDate("2026-07-13");
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 6);
  assert.equal(date.getDate(), 13);
});
