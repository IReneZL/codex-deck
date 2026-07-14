function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dailyUsageTotals(dailyUsage, now = new Date()) {
  const today = localDateKey(now);
  const month = today.slice(0, 7);
  return (dailyUsage || []).reduce((totals, bucket) => {
    const tokens = Number(bucket.tokens) || 0;
    if (bucket.date === today) {
      totals.today += tokens;
      totals.hasToday = true;
    }
    if (bucket.date?.startsWith(month)) totals.month += tokens;
    if (bucket.date && (!totals.latestDate || bucket.date > totals.latestDate)) totals.latestDate = bucket.date;
    return totals;
  }, { today: 0, month: 0, hasToday: false, latestDate: null });
}

export function reportedTodayTokens(dailyUsage, now = new Date()) {
  const totals = dailyUsageTotals(dailyUsage, now);
  return totals.hasToday ? totals.today : null;
}

export function reportingDate(value, fallback = new Date()) {
  const date = typeof value === "string" ? value.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00`) : fallback;
}
