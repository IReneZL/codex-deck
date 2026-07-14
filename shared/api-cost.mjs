const standardApiPrices = {
  "gpt-5.6-sol": { input: 5, cached: 0.5, output: 30 },
  "gpt-5.6-terra": { input: 2.5, cached: 0.25, output: 15 },
  "gpt-5.6-luna": { input: 1, cached: 0.1, output: 6 },
  "gpt-5.4": { input: 2.5, cached: 0.25, output: 15 },
};

function apiPriceForModel(name) {
  if (standardApiPrices[name]) return standardApiPrices[name];
  if (/^gpt-5\.4-\d/.test(name)) return standardApiPrices["gpt-5.4"];
  return null;
}

export function apiBlendedRate(localUsage) {
  if (!localUsage?.totalTokens) return null;
  const pricedModels = (localUsage.models || [])
    .map((model) => ({ ...model, price: apiPriceForModel(model.name) }))
    .filter((model) => model.price && Number(model.tokens) > 0);
  const pricedTokens = pricedModels.reduce((sum, model) => sum + Number(model.tokens), 0);
  if (!pricedTokens) return null;
  const weighted = pricedModels.reduce((rates, model) => {
    const weight = Number(model.tokens) / pricedTokens;
    rates.input += model.price.input * weight;
    rates.cached += model.price.cached * weight;
    rates.output += model.price.output * weight;
    return rates;
  }, { input: 0, cached: 0, output: 0 });
  const total = Number(localUsage.totalTokens) || 0;
  const cached = Number(localUsage.cachedInputTokens) || 0;
  const input = Math.max(0, (Number(localUsage.inputTokens) || 0) - cached);
  const output = Number(localUsage.outputTokens) || 0;
  const rate = (input / total) * weighted.input
    + (cached / total) * weighted.cached
    + (output / total) * weighted.output;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function estimateApiCost(tokens, blendedRate) {
  if (!Number.isFinite(tokens) || tokens <= 0 || !Number.isFinite(blendedRate) || blendedRate <= 0) return null;
  const cost = (tokens / 1_000_000) * blendedRate;
  return cost < 0.01 ? "<$0.01" : `$${cost.toFixed(2)}`;
}

export function resolveMonthlyPricingBasis(bases, accountId, monthKey, liveRate) {
  const current = bases && typeof bases === "object" ? bases : {};
  const key = `${accountId}:${monthKey}`;
  const savedRate = Number(current[key]);
  if (Number.isFinite(savedRate) && savedRate > 0) return { bases: current, rate: savedRate };
  if (!Number.isFinite(liveRate) || liveRate <= 0) return { bases: current, rate: null };
  return { bases: { ...current, [key]: liveRate }, rate: liveRate };
}

export function calendarMonthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
