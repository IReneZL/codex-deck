function localDateKey(now) {
  const date = now instanceof Date ? now : new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function updateLocalTodayObserver(previous, rolloutCounters, activeAccountId, now = new Date()) {
  const date = localDateKey(now);
  const counters = Object.fromEntries((Array.isArray(rolloutCounters) ? rolloutCounters : [])
    .map((counter) => [String(counter?.id || ""), Number(counter?.totalTokens)])
    .filter(([id, total]) => id && Number.isFinite(total) && total >= 0)
    .map(([id, total]) => [id, Math.round(total)]));
  const compatiblePrevious = previous?.date === date
    && previous.counters
    && typeof previous.counters === "object";
  const previousCounters = compatiblePrevious ? previous.counters : {};
  const accounts = compatiblePrevious ? { ...(previous.accounts || {}) } : {};

  const delta = Object.entries(counters).reduce((sum, [id, total]) => {
    if (!Object.hasOwn(previousCounters, id)) return sum;
    return sum + Math.max(0, total - (Number(previousCounters[id]) || 0));
  }, 0);
  if (delta > 0 && activeAccountId) {
    accounts[activeAccountId] = Math.max(0, Number(accounts[activeAccountId]) || 0) + delta;
  }

  return { date, counters, accounts };
}
