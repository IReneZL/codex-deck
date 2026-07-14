import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSnapshot } from "../shared/normalize-codex-snapshot.mjs";

test("normalizes real account quota, monthly usage, and unavailable desktop thread state", () => {
  const snapshot = normalizeSnapshot({
    2: { data: [{
      id: "thread-1",
      name: "Deck integration",
      preview: "fallback",
      status: { type: "notLoaded" },
      updatedAt: 1_783_948_789,
      cwd: "C:\\work",
    }] },
    3: { account: { type: "chatgpt", email: "user@example.com", planType: "plus" } },
    4: { rateLimits: {
      planType: "pro",
      primary: { usedPercent: 24, resetsAt: 1_784_526_014 },
    } },
    5: {
      summary: { lifetimeTokens: 1000 },
      dailyUsageBuckets: [
        { startDate: "2026-07-12", tokens: 300 },
        { startDate: "2026-07-13", tokens: 700 },
      ],
    },
  }, { running: true, count: 1 }, new Date("2026-07-13T12:00:00+08:00"));

  assert.equal(snapshot.account.plan, "pro");
  assert.equal(snapshot.account.quotaRemainingPercent, 76);
  assert.equal(snapshot.account.todayTokens, 700);
  assert.equal(snapshot.account.monthTokens, 1000);
  assert.equal(snapshot.threads[0].status, "unavailable");
  assert.equal(snapshot.capabilities.liveDesktopThreadStatus, false);
  assert.equal(snapshot.capabilities.cacheBreakdown, false);
});

test("maps active approval and idle statuses without guessing", () => {
  const snapshot = normalizeSnapshot({
    2: { data: [
      { id: "a", preview: "a", status: { type: "active", activeFlags: [] }, updatedAt: 1, cwd: "C:\\a" },
      { id: "b", preview: "b", status: { type: "active", activeFlags: ["waitingOnApproval"] }, updatedAt: 1, cwd: "C:\\b" },
      { id: "c", preview: "c", status: { type: "idle" }, updatedAt: 1, cwd: "C:\\c" },
    ] },
    3: { account: null },
    4: {},
    5: { summary: {}, dailyUsageBuckets: [] },
  }, { running: false, count: 0 }, new Date("2026-07-13T12:00:00+08:00"));

  assert.deepEqual(snapshot.threads.map((thread) => thread.status), ["running", "attention", "completed"]);
  assert.equal(snapshot.account, null);
  assert.equal(snapshot.capabilities.accountSummary, false);
  assert.equal(snapshot.capabilities.liveDesktopThreadStatus, true);
});
