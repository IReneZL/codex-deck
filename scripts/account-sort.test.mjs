import assert from "node:assert/strict";
import test from "node:test";

import { sortAccounts } from "../shared/account-sort.mjs";

const accounts = [
  { id: "a", name: { en: "Zed" }, quota: 30, resetTime: 300 },
  { id: "b", name: { en: "Amy" }, quota: 80, resetTime: 200 },
  { id: "c", name: { en: "Max" }, quota: 50, resetTime: 100 },
];

test("preserves addition order while keeping the active account first", () => {
  assert.deepEqual(sortAccounts(accounts, "b", "addition", "en").map((account) => account.id), ["b", "a", "c"]);
});

test("sorts non-active accounts by remaining quota", () => {
  assert.deepEqual(sortAccounts(accounts, "a", "quota", "en").map((account) => account.id), ["a", "b", "c"]);
});

test("sorts non-active accounts by earliest reset", () => {
  assert.deepEqual(sortAccounts(accounts, "b", "reset", "en").map((account) => account.id), ["b", "c", "a"]);
});
