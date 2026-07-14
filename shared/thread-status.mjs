const activeStatuses = new Set(["running", "attention"]);

export function reconcileCompletionTracking(previous, threads, { codexForeground = false } = {}) {
  const currentThreads = threads || [];
  const observed = Object.fromEntries(currentThreads.map((thread) => [
    thread.id,
    { status: thread.status, completionKey: thread.completionKey },
  ]));
  if (!previous?.observed) return { observed, unreadKeys: [] };

  const currentCompletedKeys = new Set(
    currentThreads.filter((thread) => thread.status === "completed").map((thread) => thread.completionKey),
  );
  const unreadKeys = new Set(
    (previous.unreadKeys || []).filter((key) => currentCompletedKeys.has(key)),
  );
  const transitioned = currentThreads.filter((thread) => {
    const prior = previous.observed[thread.id];
    return thread.status === "completed" && activeStatuses.has(prior?.status);
  });
  const foregroundCompletion = codexForeground
    ? transitioned.reduce((latest, thread) => (
      !latest || Date.parse(thread.updatedAt) >= Date.parse(latest.updatedAt) ? thread : latest
    ), null)
    : null;
  for (const thread of transitioned) {
    if (thread.completionKey !== foregroundCompletion?.completionKey) unreadKeys.add(thread.completionKey);
  }
  return { observed, unreadKeys: [...unreadKeys] };
}

export function dismissUnreadCompletion(tracking, thread) {
  return {
    ...tracking,
    unreadKeys: (tracking?.unreadKeys || []).filter((key) => key !== thread.completionKey),
  };
}

export function unreadCompletedThreads(completedThreads, unreadKeys) {
  const unread = new Set(unreadKeys || []);
  return (completedThreads || []).filter((thread) => unread.has(thread.completionKey));
}
