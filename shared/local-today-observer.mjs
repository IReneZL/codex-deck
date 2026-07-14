function localDateKey(now) {
  const date = now instanceof Date ? now : new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function updateLocalTodayObserver(previous, totalTokens, activeAccountId, now = new Date()) {
  const date = localDateKey(now);
  const total = Number(totalTokens);
  const validTotal = Number.isFinite(total) && total >= 0 ? Math.round(total) : null;
  const current = previous?.date === date
    ? previous
    : { date, lastTotal: null, accounts: {} };
  const accounts = { ...(current.accounts || {}) };

  if (validTotal == null) return { ...current, date, accounts };
  if (current.lastTotal == null) return { date, lastTotal: validTotal, accounts };

  const delta = Math.max(0, validTotal - Number(current.lastTotal || 0));
  if (delta > 0 && activeAccountId) {
    accounts[activeAccountId] = Math.max(0, Number(accounts[activeAccountId]) || 0) + delta;
  }

  return { date, lastTotal: validTotal, accounts };
}
