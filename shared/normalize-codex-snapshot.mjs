export const requestIds = {
  threads: 2,
  account: 3,
  rateLimits: 4,
  usage: 5,
};

function normalizeThreadStatus(status) {
  if (status?.type === "active") {
    return status.activeFlags?.length ? "attention" : "running";
  }
  if (status?.type === "systemError") return "error";
  if (status?.type === "idle") return "completed";
  return "unavailable";
}

export function normalizeSnapshot(raw, processInfo, now = new Date()) {
  const accountResponse = raw[requestIds.account];
  const rateLimitResponse = raw[requestIds.rateLimits];
  const usageResponse = raw[requestIds.usage];
  const threadResponse = raw[requestIds.threads];
  const account = accountResponse?.account;
  const rateLimit = rateLimitResponse?.rateLimitsByLimitId?.codex || rateLimitResponse?.rateLimits;
  const primaryWindow = rateLimit?.primary;
  const dailyUsage = usageResponse?.dailyUsageBuckets || [];
  const localDate = now.toLocaleDateString("en-CA");
  const localMonth = localDate.slice(0, 7);
  const todayTokens = dailyUsage.find((bucket) => bucket.startDate === localDate)?.tokens || 0;
  const monthTokens = dailyUsage
    .filter((bucket) => bucket.startDate.startsWith(localMonth))
    .reduce((total, bucket) => total + Number(bucket.tokens), 0);
  const usedPercent = Math.min(100, Math.max(0, Number(primaryWindow?.usedPercent) || 0));
  const threads = (threadResponse?.data || []).map((thread) => ({
    id: thread.id,
    title: thread.name || thread.preview?.split(/\r?\n/, 1)[0] || "Untitled task",
    status: normalizeThreadStatus(thread.status),
    updatedAt: new Date(thread.updatedAt * 1_000).toISOString(),
    cwd: thread.cwd,
  }));

  return {
    source: "codex-app-server",
    fetchedAt: now.toISOString(),
    process: processInfo,
    account: account ? {
      id: "current",
      email: account.email || null,
      plan: rateLimit?.planType || account.planType || "unknown",
      quotaRemainingPercent: 100 - usedPercent,
      quotaUsedPercent: usedPercent,
      resetAt: primaryWindow?.resetsAt
        ? new Date(primaryWindow.resetsAt * 1_000).toISOString()
        : null,
      todayTokens: Number(todayTokens),
      monthTokens,
      lifetimeTokens: Number(usageResponse?.summary?.lifetimeTokens || 0),
      dailyUsage: dailyUsage.map((bucket) => ({
        date: bucket.startDate,
        tokens: Number(bucket.tokens),
      })),
    } : null,
    threads,
    capabilities: {
      accountSummary: Boolean(account),
      quota: Boolean(primaryWindow),
      tokenHistory: Boolean(usageResponse),
      cacheBreakdown: false,
      modelBreakdown: false,
      multiAccount: false,
      liveDesktopThreadStatus: threads.some((thread) => thread.status !== "unavailable"),
    },
  };
}

