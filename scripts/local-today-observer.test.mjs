import assert from "node:assert/strict";
import test from "node:test";

import { updateLocalTodayObserver } from "../shared/local-today-observer.mjs";

test("starts with a baseline instead of inventing earlier usage", () => {
  const state = updateLocalTodayObserver(null, 1_000, "account-a", new Date(2026, 6, 14, 9));
  assert.deepEqual(state.accounts, {});
  assert.equal(state.lastTotal, 1_000);
});

test("attributes only positive observed deltas to the active account", () => {
  const first = updateLocalTodayObserver(null, 1_000, "account-a", new Date(2026, 6, 14, 9));
  const second = updateLocalTodayObserver(first, 1_240, "account-a", new Date(2026, 6, 14, 10));
  const third = updateLocalTodayObserver(second, 1_500, "account-b", new Date(2026, 6, 14, 11));
  assert.deepEqual(third.accounts, { "account-a": 240, "account-b": 260 });
});

test("rebases safely when the rolling local total decreases", () => {
  const state = updateLocalTodayObserver(
    { date: "2026-07-14", lastTotal: 2_000, accounts: { "account-a": 300 } },
    1_800,
    "account-a",
    new Date(2026, 6, 14, 12),
  );
  assert.deepEqual(state.accounts, { "account-a": 300 });
  assert.equal(state.lastTotal, 1_800);
});

test("resets account increments on the next local day", () => {
  const state = updateLocalTodayObserver(
    { date: "2026-07-13", lastTotal: 2_000, accounts: { "account-a": 300 } },
    2_250,
    "account-a",
    new Date(2026, 6, 14, 0, 1),
  );
  assert.deepEqual(state.accounts, {});
  assert.equal(state.lastTotal, 2_250);
});
