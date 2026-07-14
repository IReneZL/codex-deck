import assert from "node:assert/strict";
import test from "node:test";

import {
  apiBlendedRate,
  estimateApiCost,
  resolveMonthlyPricingBasis,
} from "../shared/api-cost.mjs";

const firstBlend = {
  totalTokens: 1_000,
  inputTokens: 600,
  cachedInputTokens: 400,
  outputTokens: 400,
  models: [{ name: "gpt-5.4", tokens: 1_000 }],
};

const laterBlend = {
  totalTokens: 1_000,
  inputTokens: 900,
  cachedInputTokens: 800,
  outputTokens: 100,
  models: [{ name: "gpt-5.6-luna", tokens: 1_000 }],
};

test("freezes the first pricing rate for the same account and calendar month", () => {
  const bases = {};
  const first = resolveMonthlyPricingBasis(bases, "account-a", "2026-07", apiBlendedRate(firstBlend));
  const refreshed = resolveMonthlyPricingBasis(first.bases, "account-a", "2026-07", apiBlendedRate(laterBlend));

  assert.equal(refreshed.rate, first.rate);
  assert.deepEqual(refreshed.bases, first.bases);
});

test("creates independent pricing rates for another account or month", () => {
  const first = resolveMonthlyPricingBasis({}, "account-a", "2026-07", apiBlendedRate(firstBlend));
  const otherAccount = resolveMonthlyPricingBasis(first.bases, "account-b", "2026-07", apiBlendedRate(laterBlend));
  const nextMonth = resolveMonthlyPricingBasis(otherAccount.bases, "account-a", "2026-08", apiBlendedRate(laterBlend));

  assert.notEqual(otherAccount.rate, first.rate);
  assert.notEqual(nextMonth.rate, first.rate);
});

test("keeps a monthly estimate stable when only the live blend changes", () => {
  const first = resolveMonthlyPricingBasis({}, "account-a", "2026-07", apiBlendedRate(firstBlend));
  const refreshed = resolveMonthlyPricingBasis(first.bases, "account-a", "2026-07", apiBlendedRate(laterBlend));

  assert.equal(estimateApiCost(1_000_000_000, refreshed.rate), estimateApiCost(1_000_000_000, first.rate));
});

test("does not invent prices for unsupported models", () => {
  assert.equal(apiBlendedRate({ ...firstBlend, models: [{ name: "unknown-model", tokens: 1_000 }] }), null);
  assert.equal(estimateApiCost(1_000_000, null), null);
});
