import assert from "node:assert/strict";
import test from "node:test";

import {
  dismissUnreadCompletion,
  reconcileCompletionTracking,
  unreadCompletedThreads,
} from "../shared/thread-status.mjs";

test("treats already completed tasks on first observation as a read baseline", () => {
  const completed = [
    { id: "a", status: "completed", completionKey: "a:1" },
    { id: "b", status: "completed", completionKey: "b:2" },
  ];
  const tracking = reconcileCompletionTracking(null, completed);

  assert.deepEqual(tracking.unreadKeys, []);
  assert.deepEqual(unreadCompletedThreads(completed, tracking.unreadKeys), []);
});

test("adds unread only when an observed active task becomes completed", () => {
  const running = [
    { id: "a", status: "running", completionKey: "a:1" },
    { id: "b", status: "attention", completionKey: "b:1" },
  ];
  const baseline = reconcileCompletionTracking(null, running);
  const completed = [
    { id: "a", status: "completed", completionKey: "a:2" },
    { id: "b", status: "attention", completionKey: "b:1" },
    { id: "c", status: "completed", completionKey: "c:1" },
  ];
  const tracking = reconcileCompletionTracking(baseline, completed);

  assert.deepEqual(
    unreadCompletedThreads(completed, tracking.unreadKeys).map((thread) => thread.completionKey),
    ["a:2"],
  );
});

test("does not create another unread completion when an idle file timestamp changes", () => {
  const baseline = reconcileCompletionTracking(null, [
    { id: "a", status: "completed", completionKey: "a:1" },
  ]);
  const refreshed = reconcileCompletionTracking(baseline, [
    { id: "a", status: "completed", completionKey: "a:2" },
  ]);

  assert.deepEqual(refreshed.unreadKeys, []);
});

test("opening one completed task dismisses only that unread completion", () => {
  const tracking = {
    observed: {},
    unreadKeys: ["a:2", "b:2"],
  };

  assert.deepEqual(dismissUnreadCompletion(tracking, { completionKey: "a:2" }).unreadKeys, ["b:2"]);
});

test("does not count the latest completion while Codex is in the foreground", () => {
  const baseline = reconcileCompletionTracking(null, [
    { id: "a", status: "running", completionKey: "a:1", updatedAt: "2026-07-14T10:00:00Z" },
    { id: "b", status: "running", completionKey: "b:1", updatedAt: "2026-07-14T10:00:00Z" },
  ]);
  const tracking = reconcileCompletionTracking(baseline, [
    { id: "a", status: "completed", completionKey: "a:2", updatedAt: "2026-07-14T10:01:00Z" },
    { id: "b", status: "completed", completionKey: "b:2", updatedAt: "2026-07-14T10:02:00Z" },
  ], { codexForeground: true });

  assert.deepEqual(tracking.unreadKeys, ["a:2"]);
});

test("counts every observed completion while Codex is in the background", () => {
  const baseline = reconcileCompletionTracking(null, [
    { id: "a", status: "running", completionKey: "a:1", updatedAt: "2026-07-14T10:00:00Z" },
    { id: "b", status: "running", completionKey: "b:1", updatedAt: "2026-07-14T10:00:00Z" },
  ]);
  const tracking = reconcileCompletionTracking(baseline, [
    { id: "a", status: "completed", completionKey: "a:2", updatedAt: "2026-07-14T10:01:00Z" },
    { id: "b", status: "completed", completionKey: "b:2", updatedAt: "2026-07-14T10:02:00Z" },
  ], { codexForeground: false });

  assert.deepEqual(tracking.unreadKeys, ["a:2", "b:2"]);
});
