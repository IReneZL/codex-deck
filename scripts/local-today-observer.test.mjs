import assert from "node:assert/strict";
import test from "node:test";

import { updateLocalTodayObserver } from "../shared/local-today-observer.mjs";

const counters = (...entries) => entries.map(([id, totalTokens]) => ({ id, totalTokens }));

test("starts with a baseline instead of inventing earlier usage", () => {
  const state = updateLocalTodayObserver(null, counters(["thread-a", 1_000]), "account-a", new Date(2026, 6, 14, 9));
  assert.deepEqual(state.accounts, {});
  assert.deepEqual(state.counters, { "thread-a": 1_000 });
});

test("attributes only positive observed deltas to the active account", () => {
  const first = updateLocalTodayObserver(null, counters(["thread-a", 1_000]), "account-a", new Date(2026, 6, 14, 9));
  const second = updateLocalTodayObserver(first, counters(["thread-a", 1_240]), "account-a", new Date(2026, 6, 14, 10));
  const third = updateLocalTodayObserver(second, counters(["thread-a", 1_500]), "account-b", new Date(2026, 6, 14, 11));
  assert.deepEqual(third.accounts, { "account-a": 240, "account-b": 260 });
});

test("rebases a thread safely when its total decreases", () => {
  const state = updateLocalTodayObserver(
    { date: "2026-07-14", counters: { "thread-a": 2_000 }, accounts: { "account-a": 300 } },
    counters(["thread-a", 1_800]),
    "account-a",
    new Date(2026, 6, 14, 12),
  );
  assert.deepEqual(state.accounts, { "account-a": 300 });
  assert.deepEqual(state.counters, { "thread-a": 1_800 });
});

test("resets account increments on the next local day", () => {
  const state = updateLocalTodayObserver(
    { date: "2026-07-13", counters: { "thread-a": 2_000 }, accounts: { "account-a": 300 } },
    counters(["thread-a", 2_250]),
    "account-a",
    new Date(2026, 6, 14, 0, 1),
  );
  assert.deepEqual(state.accounts, {});
  assert.deepEqual(state.counters, { "thread-a": 2_250 });
});

test("does not count historical tokens when a task first appears", () => {
  const first = updateLocalTodayObserver(null, counters(["thread-a", 100]), "account-a", new Date(2026, 6, 14, 9));
  const second = updateLocalTodayObserver(
    first,
    counters(["thread-a", 120], ["thread-old", 5_000_000_000]),
    "account-a",
    new Date(2026, 6, 14, 9, 1),
  );
  assert.deepEqual(second.accounts, { "account-a": 20 });
});

test("does not count a task that disappears and later reappears", () => {
  const first = updateLocalTodayObserver(null, counters(["thread-a", 100]), "account-a", new Date(2026, 6, 14, 9));
  const missing = updateLocalTodayObserver(first, [], "account-a", new Date(2026, 6, 14, 9, 1));
  const returned = updateLocalTodayObserver(missing, counters(["thread-a", 1_000]), "account-a", new Date(2026, 6, 14, 9, 2));
  assert.deepEqual(returned.accounts, {});
});

test("drops legacy aggregate state so corrupted increments cannot survive the upgrade", () => {
  const state = updateLocalTodayObserver(
    { date: "2026-07-14", lastTotal: 10_000, accounts: { "account-a": 5_000_000_000 } },
    counters(["thread-a", 10_100]),
    "account-a",
    new Date(2026, 6, 14, 12),
  );
  assert.deepEqual(state.accounts, {});
  assert.deepEqual(state.counters, { "thread-a": 10_100 });
});
