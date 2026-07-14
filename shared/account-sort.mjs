export function sortAccounts(accounts, activeId, sortMode, language) {
  const originalOrder = new Map((accounts || []).map((account, index) => [account.id, index]));
  return [...(accounts || [])].sort((left, right) => {
    if (left.id === activeId) return -1;
    if (right.id === activeId) return 1;
    if (sortMode === "quota") {
      const difference = (Number.isFinite(right.quota) ? right.quota : -1)
        - (Number.isFinite(left.quota) ? left.quota : -1);
      if (difference) return difference;
    }
    if (sortMode === "reset") {
      const difference = (Number.isFinite(left.resetTime) ? left.resetTime : Number.POSITIVE_INFINITY)
        - (Number.isFinite(right.resetTime) ? right.resetTime : Number.POSITIVE_INFINITY);
      if (difference) return difference;
    }
    return (originalOrder.get(left.id) || 0) - (originalOrder.get(right.id) || 0);
  });
}
