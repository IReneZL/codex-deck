import { useEffect, useMemo, useRef, useState } from "react";
import packageInfo from "../package.json";

import calendarIcon from "./assets/icons/calendar.svg";
import checkmarkCircleIcon from "./assets/icons/checkmark-circle.svg";
import chevronDownIcon from "./assets/icons/chevron-down.svg";
import chevronUpIcon from "./assets/icons/chevron-up.svg";
import clockIcon from "./assets/icons/clock.svg";
import codexDeckMark from "./assets/icons/codex-deck-mark.png";
import darkThemeIcon from "./assets/icons/dark-theme.svg";
import dismissIcon from "./assets/icons/dismiss.svg";
import globeIcon from "./assets/icons/globe.svg";
import maximizeIcon from "./assets/icons/maximize.svg";
import minimizeIcon from "./assets/icons/minimize.svg";
import personAddIcon from "./assets/icons/person-add.svg";
import playIcon from "./assets/icons/play-circle.svg";
import refreshIcon from "./assets/icons/refresh.svg";
import stopIcon from "./assets/icons/stop-circle.svg";
import swapIcon from "./assets/icons/swap.svg";
import warningIcon from "./assets/icons/warning.svg";
import windowConsoleIcon from "./assets/icons/window-console.svg";
import {
  apiBlendedRate,
  calendarMonthKey,
  estimateApiCost,
  resolveMonthlyPricingBasis,
} from "../shared/api-cost.mjs";
import {
  forceCloseNativeCodex,
  isNativeDesktop,
  loginNativeCodexAccount,
  minimizeNativeWindow,
  openNativeCodex,
  openNativeCodexThread,
  quitNativeDeck,
  readCodexSnapshot,
  readCodexThreadSnapshot,
  resizeNativeMainWindow,
  resizeNativePopover,
  restoreNativeWindow,
  setNativeTrayLanguage,
  startNativeWindowDrag,
  switchNativeCodexAccount,
} from "./desktop.js";
import { dailyUsageTotals, reportedTodayTokens, reportingDate } from "../shared/usage-metrics.mjs";
import { sortAccounts } from "../shared/account-sort.mjs";

const initialAccounts = [];

const accountSortStorageKey = "codex-deck-account-sort-v1";
const languageStorageKey = "codex-deck-language-v1";
const monthlyPricingBasisStorageKey = "codex-deck-monthly-pricing-basis-v1";
const themeStorageKey = "codex-deck-theme-v1";
const windowCloseStorageKey = "codex-deck-window-close-action-v2";

const copy = {
  zh: {
    accounts: "账号",
    active: "使用中",
    quota: "7 天额度",
    remaining: "剩余",
    reset: "重置时间",
    accountCount: (count) => `共 ${count} 个账号`,
    sortLabel: "排序",
    sortAddition: "添加顺序",
    sortQuota: "额度从高到低",
    sortReset: "最早重置",
    loadingAccount: "正在加载账号",
    noAccount: "还没有账号",
    noAccountBody: "选择“添加账号”，通过 ChatGPT 官方登录保存账号。",
    unmanagedAccount: "此账号尚未保存",
    unmanagedAccountBody: "当前 Codex 登录的账号还未添加到 Codex Deck。请选择“添加账号”完成保存。",
    accountReadFailed: "账号信息暂时无法加载",
    accountReadFailedBody: "请确认 Codex 可以正常打开，然后重试。",
    compactNoAccount: "未登录",
    closeCodex: "关闭 Codex",
    openCodex: "打开 Codex",
    refresh: "刷新",
    switchAccount: "切换到此账号",
    preview: (name) => `正在预览，当前仍使用 ${name}`,
    today: "官方今日费用",
    month: "本月",
    estimate: "按公开 API 价格估算，非实际账单",
    priceUpdated: "标准 API 价格 · 2026-07-14",
    todayToken: "官方今日 Token",
    monthToken: "本月 Token",
    cacheReuse: "本机缓存复用率",
    cachedInput: "本机缓存输入",
    uncachedInput: "本机未缓存输入",
    statsAsOf: (date) => `待更新 · 数据截至 ${date || "上一统计日"}`,
    officialToday: () => "官方统计 · 可能延迟",
    tokenTrend: "Token 使用趋势（30 天）",
    totalTokens: "总 Token",
    average: "7 日平均",
    modelUsage: "本机模型使用占比",
    localModelUsage: "所有账号的本机使用记录 · 最近 30 天",
    running: "Codex 运行中",
    stopped: "Codex 已关闭",
    modalCloseTitle: "强制关闭正在运行的 Codex 进程？",
    modalSwitchTitle: "关闭 Codex 并切换账号？",
    modalCloseBody: "这将强制关闭当前 1 个 Codex 进程。",
    modalSwitchBody: "当前有 1 个 Codex 进程阻止账号切换。确认后将关闭进程并切换账号。",
    unsaved: "未保存的 Codex 工作可能会丢失。",
    cancel: "取消",
    confirmClose: "强制关闭 Codex",
    confirmSwitch: "强制关闭并切换账号",
    refreshed: "额度与用量数据已刷新",
    opened: "Codex 已打开",
    closed: "Codex 已关闭",
    switched: "账号已切换",
    language: "切换到英文",
    theme: "切换明暗主题",
    minimize: "收起为置顶状态栏",
    maximize: "切换窗口大小",
    closeWindow: "关闭 Codex Deck",
    windowCloseTitle: "关闭 Codex Deck？",
    windowCloseBody: "这不会关闭正在运行的 Codex 进程。请选择点击关闭按钮时的行为。",
    minimizeDeck: "最小化为置顶栏",
    minimizeDeckHint: "保留置顶栏，继续查看状态",
    quitDeck: "关闭 Codex Deck",
    quitDeckHint: "退出管理器，Codex 进程继续运行",
    rememberCloseChoice: "记住我的选择",
    confirmWindowClose: "确认",
    expand: "展开 Codex Deck",
    addAccount: "添加账号",
    addTitle: "添加 ChatGPT 账号",
    addDescription: "通过官方登录识别账号，不需要粘贴 Token 或导入认证文件。",
    officialLogin: "打开官方登录",
    loginPrototype: "将在安全窗口中打开 ChatGPT 官方登录，登录信息仅保存在本机。",
    loginDetected: "已识别 ChatGPT 账号",
    accountAlias: "账号别名（可选）",
    aliasHelp: "留空时使用 ChatGPT 用户名；重名会自动追加序号。",
    detectedPlan: "检测到 Plus 套餐",
    saveAccount: "保存账号",
    accountAdded: "账号已添加。切换前可先查看额度和用量。",
    threadRunning: "正在运行的任务",
    threadAttention: "需要你处理的任务",
    threadUnavailable: "暂时无法获取任务状态",
    noThreads: "暂无任务",
    openThread: "打开对应 Codex 对话",
    currentAccountQuota: "当前账号 7 天额度",
    openedThread: "已打开对应的 Codex 对话",
    codexProcessRunning: "Codex 进程正在运行",
    codexProcessStopped: "Codex 进程已关闭",
    bridgeUnavailable: "暂时无法连接 Codex",
    metricUnavailable: "暂无可用数据",
    processControlPending: "请在桌面版 Codex Deck 中使用此功能",
    accountManagementPending: "请在桌面版 Codex Deck 中添加账号",
  },
  en: {
    accounts: "Accounts",
    active: "Active",
    quota: "7-day quota",
    remaining: "remaining",
    reset: "Resets",
    accountCount: (count) => `${count} ${count === 1 ? "account" : "accounts"}`,
    sortLabel: "Sort",
    sortAddition: "Addition order",
    sortQuota: "Most quota remaining",
    sortReset: "Resetting soonest",
    loadingAccount: "Loading accounts",
    noAccount: "No accounts yet",
    noAccountBody: "Choose Add account and sign in with ChatGPT to save an account.",
    unmanagedAccount: "This account is not saved",
    unmanagedAccountBody: "The account currently signed in to Codex has not been added to Codex Deck. Choose Add account to save it.",
    accountReadFailed: "Account information is temporarily unavailable",
    accountReadFailedBody: "Make sure Codex opens normally, then try again.",
    compactNoAccount: "Signed out",
    closeCodex: "Close Codex",
    openCodex: "Open Codex",
    refresh: "Refresh",
    switchAccount: "Switch to this account",
    preview: (name) => `Previewing only; ${name} is still active`,
    today: "Official today cost",
    month: "This month",
    estimate: "API-equivalent estimate, not an actual bill",
    priceUpdated: "Standard API pricing · Jul 14, 2026",
    todayToken: "Official today tokens",
    monthToken: "This month",
    cacheReuse: "Local cache reuse",
    cachedInput: "Local cached input",
    uncachedInput: "Local uncached input",
    statsAsOf: (date) => `Pending · data through ${date || "the previous reporting day"}`,
    officialToday: () => "Official · may lag",
    tokenTrend: "Token usage · 30 days",
    totalTokens: "Total tokens",
    average: "7-day average",
    modelUsage: "Local model usage",
    localModelUsage: "Local usage from all accounts · last 30 days",
    running: "Codex running",
    stopped: "Codex stopped",
    modalCloseTitle: "Force close running Codex processes?",
    modalSwitchTitle: "Close Codex and switch account?",
    modalCloseBody: "This will force close 1 Codex process that is currently running.",
    modalSwitchBody: "1 Codex process currently blocks account switching. It will be closed before the account changes.",
    unsaved: "Unsaved Codex work may be lost.",
    cancel: "Cancel",
    confirmClose: "Force close Codex",
    confirmSwitch: "Force close and switch account",
    refreshed: "Quota and usage data refreshed",
    opened: "Codex opened",
    closed: "Codex closed",
    switched: "Account switched",
    language: "切换到中文",
    theme: "Toggle light or dark theme",
    minimize: "Collapse to always-on-top status bar",
    maximize: "Toggle window size",
    closeWindow: "Close Codex Deck",
    windowCloseTitle: "Close Codex Deck?",
    windowCloseBody: "Running Codex processes will stay open. Choose what the close button should do.",
    minimizeDeck: "Minimize to status bar",
    minimizeDeckHint: "Keep the status bar for threads and quota",
    quitDeck: "Close Codex Deck",
    quitDeckHint: "Exit the manager and keep Codex running",
    rememberCloseChoice: "Remember my choice",
    confirmWindowClose: "Confirm",
    expand: "Expand Codex Deck",
    addAccount: "Add account",
    addTitle: "Add ChatGPT account",
    addDescription: "Use official sign-in to identify the account—no pasted tokens or imported auth files.",
    officialLogin: "Open official sign-in",
    loginPrototype: "Opens the official ChatGPT sign-in in a secure window. Sign-in data stays on this device.",
    loginDetected: "ChatGPT account detected",
    accountAlias: "Account alias (optional)",
    aliasHelp: "Leave blank to use the ChatGPT name; duplicate names receive a number.",
    detectedPlan: "Plus plan detected",
    saveAccount: "Save account",
    accountAdded: "Account added. Review its quota and usage before switching.",
    threadRunning: "Running threads",
    threadAttention: "Threads needing attention",
    threadUnavailable: "Task status is temporarily unavailable",
    noThreads: "No tasks here",
    openThread: "Open the matching Codex task",
    currentAccountQuota: "Current account 7-day quota",
    openedThread: "Opened the matching Codex task",
    codexProcessRunning: "Codex process running",
    codexProcessStopped: "Codex process stopped",
    bridgeUnavailable: "Could not connect to Codex",
    metricUnavailable: "No data available",
    processControlPending: "Use the Codex Deck desktop app for this action",
    accountManagementPending: "Use the Codex Deck desktop app to add accounts",
  },
};

function formatTokens(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function chartSeries(dailyUsage, now = new Date()) {
  const byDate = new Map((dailyUsage || []).map((bucket) => [bucket.date, bucket.tokens]));
  const values = [];
  const dates = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const key = date.toLocaleDateString("en-CA");
    values.push(Number(byDate.get(key)) || 0);
    dates.push(`${date.getMonth() + 1}/${date.getDate()}`);
  }
  return { values, dates };
}

function resetLabels(resetAt) {
  if (!resetAt) return { zh: "—", en: "—" };
  const date = new Date(typeof resetAt === "number" && resetAt < 1_000_000_000_000 ? resetAt * 1_000 : resetAt);
  return {
    zh: date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
    en: date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  };
}

function resetTimestamp(resetAt) {
  if (!resetAt) return null;
  const value = typeof resetAt === "number" && resetAt < 1_000_000_000_000 ? resetAt * 1_000 : resetAt;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function relativeTimeLabels(updatedAt) {
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - new Date(updatedAt).getTime()) / 60_000));
  if (elapsedMinutes < 1) return { zh: "刚刚", en: "Just now" };
  if (elapsedMinutes < 60) return { zh: `${elapsedMinutes} 分钟前`, en: `${elapsedMinutes} min ago` };
  const hours = Math.round(elapsedMinutes / 60);
  if (hours < 24) return { zh: `${hours} 小时前`, en: `${hours} hr ago` };
  const days = Math.round(hours / 24);
  return { zh: `${days} 天前`, en: `${days} days ago` };
}

function modelUsageFromLocal(localUsage) {
  const models = (localUsage?.models || [])
    .filter((model) => model.name && model.name.toLowerCase() !== "unknown" && Number(model.tokens) > 0)
    .slice(0, 3);
  const total = models.reduce((sum, model) => sum + Number(model.tokens), 0);
  let assigned = 0;
  return models.map((model, index) => {
    const percent = index === models.length - 1
      ? Math.max(0, 100 - assigned)
      : Math.round((Number(model.tokens) / total) * 100);
    assigned += percent;
    return { name: model.name, percent };
  });
}

function formatUsageUpdatedAt(value, lang) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function accountFromSnapshot(account, pricingRate = null, lang = "en") {
  const usageTotals = dailyUsageTotals(account.dailyUsage);
  const statsAsOf = usageTotals.latestDate || account.statsAsOf;
  const series = chartSeries(account.dailyUsage, reportingDate(statsAsOf));
  const label = account.name || account.email?.split("@", 1)[0] || "ChatGPT";
  const plan = account.plan ? account.plan.charAt(0).toUpperCase() + account.plan.slice(1) : "—";
  const quota = Number.isFinite(account.quotaRemainingPercent) ? account.quotaRemainingPercent : 0;
  const localUsage = account.localUsage;
  const localInput = Number(localUsage?.inputTokens) || 0;
  const localCached = Number(localUsage?.cachedInputTokens) || 0;
  const cacheReuse = localInput > 0 ? Math.round((localCached / localInput) * 100) : null;
  const todayTokens = reportedTodayTokens(account.dailyUsage);
  const monthTokens = account.dailyUsage?.length ? usageTotals.month : Number(account.monthTokens);
  return {
    id: account.id,
    name: { zh: label, en: label },
    plan,
    quota: Math.round(quota),
    reset: resetLabels(account.resetAt),
    resetTime: resetTimestamp(account.resetAt),
    todayCost: estimateApiCost(todayTokens, pricingRate),
    monthCost: estimateApiCost(monthTokens, pricingRate),
    todayTokens: formatTokens(todayTokens),
    monthTokens: formatTokens(monthTokens),
    todayPending: todayTokens == null,
    usageUpdatedAt: formatUsageUpdatedAt(account.statsGeneratedAt, lang),
    statsAsOf,
    cacheReuse,
    cachedInput: localUsage ? formatTokens(localCached) : null,
    uncachedInput: localUsage ? formatTokens(Math.max(0, localInput - localCached)) : null,
    modelUsage: modelUsageFromLocal(localUsage),
    chartValues: series.values,
    chartDates: series.dates,
  };
}

function accountFromStored(account, localUsage, pricingRate = null, lang = "en") {
  const label = account.name || account.email?.split("@", 1)[0] || "ChatGPT";
  const plan = account.plan ? account.plan.charAt(0).toUpperCase() + account.plan.slice(1) : "—";
  const usageTotals = dailyUsageTotals(account.dailyUsage);
  const statsAsOf = usageTotals.latestDate || account.statsAsOf;
  const series = chartSeries(account.dailyUsage, reportingDate(statsAsOf));
  const localInput = Number(localUsage?.inputTokens) || 0;
  const localCached = Number(localUsage?.cachedInputTokens) || 0;
  const cacheReuse = localInput > 0 ? Math.round((localCached / localInput) * 100) : null;
  const todayTokens = reportedTodayTokens(account.dailyUsage);
  return {
    id: account.id,
    name: { zh: label, en: label },
    plan,
    quota: Number.isFinite(account.quotaRemainingPercent) ? Math.round(account.quotaRemainingPercent) : null,
    reset: resetLabels(account.resetAt),
    resetTime: resetTimestamp(account.resetAt),
    todayCost: estimateApiCost(todayTokens, pricingRate),
    monthCost: estimateApiCost(usageTotals.month, pricingRate),
    todayTokens: formatTokens(todayTokens),
    monthTokens: account.dailyUsage?.length ? formatTokens(usageTotals.month) : "—",
    todayPending: todayTokens == null,
    usageUpdatedAt: formatUsageUpdatedAt(account.statsGeneratedAt, lang),
    statsAsOf,
    cacheReuse,
    cachedInput: localUsage ? formatTokens(localCached) : null,
    uncachedInput: localUsage ? formatTokens(Math.max(0, localInput - localCached)) : null,
    modelUsage: modelUsageFromLocal(localUsage),
    chartValues: series.values,
    chartDates: series.dates,
  };
}

function threadFromSnapshot(thread, accountId) {
  return {
    ...thread,
    completionKey: `${thread.id}:${thread.updatedAt}`,
    title: { zh: thread.title, en: thread.title },
    accountId,
    time: relativeTimeLabels(thread.updatedAt),
  };
}

function Icon({ src, alt = "", size = 20 }) {
  return <img className="icon" src={src} alt={alt} width={size} height={size} draggable="false" />;
}

function QuotaBar({ value }) {
  const available = Number.isFinite(value);
  const percent = available ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <div className={`quota-track ${available ? "" : "unavailable"}`} aria-label={available ? `${percent}%` : "—"}>
      <span className={percent <= 10 ? "danger" : percent <= 40 ? "warning" : "healthy"} style={{ width: `${percent}%` }} />
    </div>
  );
}

function AccountSortMenu({ value, onChange, t }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const options = [
    { value: "addition", label: t.sortAddition },
    { value: "quota", label: t.sortQuota },
    { value: "reset", label: t.sortReset },
  ];
  const selected = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    const frame = window.requestAnimationFrame(() => {
      rootRef.current?.querySelector('[aria-selected="true"]')?.focus();
    });
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.cancelAnimationFrame(frame);
    };
  }, [open]);

  const choose = (nextValue) => {
    onChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveOptionFocus = (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...rootRef.current.querySelectorAll(".account-sort-option")];
    const current = items.indexOf(document.activeElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    items[(current + direction + items.length) % items.length]?.focus();
  };

  return (
    <div className="account-sort" ref={rootRef}>
      <span>{t.sortLabel}</span>
      <div className="account-sort-control">
        <button
          type="button"
          className={`account-sort-trigger ${open ? "open" : ""}`}
          ref={triggerRef}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span>{selected.label}</span>
          <span className={`account-sort-chevron ${open ? "open" : ""}`}><Icon src={chevronDownIcon} size={16} /></span>
        </button>
        {open && (
          <div className="account-sort-menu" role="listbox" aria-label={t.sortLabel} onKeyDown={moveOptionFocus}>
            {options.map((option) => (
              <button
                type="button"
                className="account-sort-option"
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                onClick={() => choose(option.value)}
              >
                <span>{option.label}</span>
                {option.value === value && <Icon src={checkmarkCircleIcon} size={16} />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TokenChart({ theme, values, dates }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    let frame = 0;
    const draw = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width <= 0 || height <= 0) return;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d");
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const inkMuted = theme === "dark" ? "#aeb7c4" : "#667085";
      const grid = theme === "dark" ? "rgba(142,154,170,.18)" : "rgba(90,100,120,.16)";
      const chartTop = 12;
      const chartBottom = height - 34;
      const chartLeft = 56;
      const chartRight = width - 8;
      const chartHeight = chartBottom - chartTop;
      const chartWidth = chartRight - chartLeft;
      const chartValues = values?.length ? values : Array.from({ length: 30 }, () => 0);
      const maxValue = Math.max(...chartValues, 1);
      const labels = [1, 0.75, 0.5, 0.25, 0].map((labelRatio) => formatTokens(Math.round(maxValue * labelRatio)));

      ctx.font = "12px 'Segoe UI Variable', 'Microsoft YaHei UI', sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      labels.forEach((label, index) => {
        const y = chartTop + (chartHeight * index) / 4;
        ctx.fillStyle = inkMuted;
        ctx.fillText(label, chartLeft - 12, y);
        ctx.strokeStyle = grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(chartLeft, y);
        ctx.lineTo(chartRight, y);
        ctx.stroke();
      });

      const gap = Math.max(2, Math.min(6, chartWidth / 100));
      const barWidth = Math.max(2, (chartWidth - gap * (chartValues.length - 1)) / chartValues.length);
      chartValues.forEach((value, index) => {
        const barHeight = (value / maxValue) * chartHeight;
        const x = chartLeft + index * (barWidth + gap);
        const y = chartBottom - barHeight;
        ctx.fillStyle = "#3b82f6";
        ctx.fillRect(x, y, barWidth, barHeight);
      });

      const averages = chartValues.map((_, index) => {
        const slice = chartValues.slice(Math.max(0, index - 6), index + 1);
        return slice.reduce((sum, value) => sum + value, 0) / slice.length;
      });
      ctx.strokeStyle = "#2b83ff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      averages.forEach((value, index) => {
        const x = chartLeft + index * (barWidth + gap) + barWidth / 2;
        const y = chartBottom - (value / maxValue) * chartHeight;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      const dateIndexes = [0, 5, 10, 15, 20, 25, chartValues.length - 1];
      ctx.fillStyle = inkMuted;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      dateIndexes.forEach((index) => {
        const x = chartLeft + index * (barWidth + gap) + barWidth / 2;
        ctx.fillText(dates?.[index] || "", x, chartBottom + 10);
      });
    };
    const scheduleDraw = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(scheduleDraw);
    observer.observe(host);
    draw();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [dates, theme, values]);

  return <canvas ref={canvasRef} role="img" aria-label="30 day token usage chart" />;
}

export function App() {
  const [accountItems, setAccountItems] = useState(initialAccounts);
  const [accountSort, setAccountSort] = useState(() => {
    try {
      const saved = window.localStorage.getItem(accountSortStorageKey);
      return saved === "quota" || saved === "reset" ? saved : "addition";
    } catch {
      return "addition";
    }
  });
  const [theme, setTheme] = useState(() => {
    try {
      return window.localStorage.getItem(themeStorageKey) === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const [lang, setLang] = useState(() => {
    try {
      return window.localStorage.getItem(languageStorageKey) === "en" ? "en" : "zh";
    } catch {
      return "zh";
    }
  });
  const [activeId, setActiveId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [codexRunning, setCodexRunning] = useState(false);
  const [codexProcessCount, setCodexProcessCount] = useState(0);
  const [threads, setThreads] = useState([]);
  const [bridgeState, setBridgeState] = useState("loading");
  const [bridgeCapabilities, setBridgeCapabilities] = useState(null);
  const [unmanagedCurrent, setUnmanagedCurrent] = useState(false);
  const [modal, setModal] = useState(null);
  const [minimized, setMinimized] = useState(false);
  const [deckClosed, setDeckClosed] = useState(false);
  const [compact, setCompact] = useState(false);
  const [toast, setToast] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [statusPopover, setStatusPopover] = useState(null);
  const [addFlow, setAddFlow] = useState(null);
  const [addAlias, setAddAlias] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [windowCloseChoice, setWindowCloseChoice] = useState("minimize");
  const [rememberWindowCloseChoice, setRememberWindowCloseChoice] = useState(false);
  const [savedWindowCloseAction, setSavedWindowCloseAction] = useState(() => {
    try {
      const saved = window.localStorage.getItem(windowCloseStorageKey);
      return saved === "minimize" || saved === "close" ? saved : null;
    } catch {
      return null;
    }
  });
  const [barPosition, setBarPosition] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const monthlyPricingBasisRef = useRef((() => {
    try {
      return JSON.parse(window.localStorage.getItem(monthlyPricingBasisStorageKey) || "{}");
    } catch {
      return {};
    }
  })());
  const snapshotSignatureRef = useRef("");
  const threadPollInFlightRef = useRef(false);
  const threadSnapshotAtRef = useRef(0);
  const t = copy[lang];

  const activeAccount = accountItems.find((account) => account.id === activeId) || null;
  const selectedAccount = accountItems.find((account) => account.id === selectedId) || activeAccount;
  const orderedAccounts = useMemo(
    () => sortAccounts(accountItems, activeId, accountSort, lang),
    [accountItems, accountSort, activeId, lang],
  );
  const accountStateLabel = bridgeState === "loading"
    ? t.loadingAccount
    : bridgeState === "error"
      ? t.accountReadFailed
      : unmanagedCurrent ? t.unmanagedAccount : t.noAccount;
  const accountStateBody = bridgeState === "error"
    ? t.accountReadFailedBody
    : unmanagedCurrent ? t.unmanagedAccountBody : t.noAccountBody;
  const threadGroups = useMemo(() => ({
    running: threads.filter((thread) => thread.status === "running"),
    attention: threads.filter((thread) => thread.status === "attention" || thread.status === "error"),
  }), [threads]);
  const threadCounts = useMemo(() => ({
    running: threadGroups.running.length,
    attention: threadGroups.attention.length,
  }), [threadGroups]);
  const hasThreadError = threads.some((thread) => thread.status === "error");
  const threadStatusUnavailable = bridgeState === "live" && !bridgeCapabilities?.liveDesktopThreadStatus;
  const filteredThreads = statusPopover ? threadGroups[statusPopover] : [];

  const loadSnapshot = async (announce = false) => {
    const requestedAt = Date.now();
    if (announce) setRefreshing(true);
    try {
      const snapshot = await readCodexSnapshot();
      const snapshotSignature = JSON.stringify({
        account: snapshot.account,
        accounts: snapshot.accounts,
        activeAccountId: snapshot.activeAccountId,
        capabilities: snapshot.capabilities,
        localUsage: snapshot.localUsage,
        process: snapshot.process,
        rolloutTokenCounters: snapshot.rolloutTokenCounters,
        threads: snapshot.threads,
      });
      if (snapshotSignature === snapshotSignatureRef.current) {
        setBridgeState("live");
        if (announce) setToast(t.refreshed);
        return;
      }
      snapshotSignatureRef.current = snapshotSignature;
      const storedAccounts = snapshot.accounts || [];
      const activeStored = storedAccounts.find((account) => account.id === snapshot.activeAccountId);
      const livePricingRate = apiBlendedRate(snapshot.localUsage);
      const monthKey = calendarMonthKey();
      let nextPricingBases = monthlyPricingBasisRef.current;
      const pricingRateFor = (accountId) => {
        const resolved = resolveMonthlyPricingBasis(nextPricingBases, accountId, monthKey, livePricingRate);
        nextPricingBases = resolved.bases;
        return resolved.rate;
      };
      const storedItems = storedAccounts.map((account) => {
        const pricingRate = pricingRateFor(account.id);
        if (!activeStored || account.id !== activeStored.id || !snapshot.account) {
          return accountFromStored(account, snapshot.localUsage, pricingRate, lang);
        }
        const liveAccount = accountFromSnapshot({
          ...snapshot.account,
          id: account.id,
          dailyUsage: account.dailyUsage?.length ? account.dailyUsage : snapshot.account.dailyUsage,
          statsAsOf: account.statsAsOf,
          statsGeneratedAt: account.statsGeneratedAt,
          localUsage: snapshot.localUsage,
        }, pricingRate, lang);
        liveAccount.name = { zh: account.name, en: account.name };
        return liveAccount;
      });
      if (nextPricingBases !== monthlyPricingBasisRef.current) {
        monthlyPricingBasisRef.current = nextPricingBases;
        window.localStorage.setItem(monthlyPricingBasisStorageKey, JSON.stringify(nextPricingBases));
      }
      const orderedItems = activeStored
        ? [
          ...storedItems.filter((account) => account.id === activeStored.id),
          ...storedItems.filter((account) => account.id !== activeStored.id),
        ]
        : storedItems;
      setAccountItems(orderedItems);
      setActiveId(activeStored?.id || null);
      setSelectedId((current) => orderedItems.some((account) => account.id === current)
        ? current
        : activeStored?.id || orderedItems[0]?.id || null);
      setUnmanagedCurrent(Boolean(snapshot.account && !activeStored));
      const nextThreads = (snapshot.threads || []).map((thread) => threadFromSnapshot(thread, activeStored?.id || null));
      if (requestedAt >= threadSnapshotAtRef.current) {
        threadSnapshotAtRef.current = requestedAt;
        setThreads(nextThreads);
      }
      setCodexRunning(snapshot.process.running);
      setCodexProcessCount(snapshot.process.count);
      setBridgeCapabilities(snapshot.capabilities);
      setBridgeState("live");
      if (announce) setToast(t.refreshed);
    } catch {
      setBridgeState("error");
      if (announce) setToast(t.bridgeUnavailable);
    } finally {
      if (announce) setRefreshing(false);
    }
  };

  const loadThreadSnapshot = async () => {
    if (threadPollInFlightRef.current || !isNativeDesktop()) return;
    threadPollInFlightRef.current = true;
    const requestedAt = Date.now();
    try {
      const snapshot = await readCodexThreadSnapshot();
      if (!snapshot || requestedAt < threadSnapshotAtRef.current) return;
      threadSnapshotAtRef.current = requestedAt;
      setThreads((snapshot.threads || []).map((thread) => threadFromSnapshot(thread, activeId)));
      setCodexRunning(snapshot.process.running);
      setCodexProcessCount(snapshot.process.count);
    } catch {
      // The full snapshot owns connection error state; a missed fast poll is non-fatal.
    } finally {
      threadPollInFlightRef.current = false;
    }
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    window.localStorage.setItem(themeStorageKey, theme);
    window.localStorage.setItem(languageStorageKey, lang);
  }, [theme, lang]);

  useEffect(() => {
    setNativeTrayLanguage(lang);
  }, [lang]);

  useEffect(() => {
    window.localStorage.setItem(accountSortStorageKey, accountSort);
  }, [accountSort]);

  useEffect(() => {
    document.documentElement.dataset.compactBar = minimized ? "true" : "false";
  }, [minimized]);

  useEffect(() => {
    const restoreFromTray = () => {
      setStatusPopover(null);
      setMinimized(false);
    };
    window.addEventListener("codex-deck:restore", restoreFromTray);
    return () => window.removeEventListener("codex-deck:restore", restoreFromTray);
  }, []);

  useEffect(() => {
    loadSnapshot();
    const timer = window.setInterval(() => loadSnapshot(), minimized ? 60_000 : 30_000);
    return () => window.clearInterval(timer);
  }, [minimized]);

  useEffect(() => {
    loadThreadSnapshot();
    const timer = window.setInterval(() => loadThreadSnapshot(), minimized ? 5_000 : 10_000);
    return () => window.clearInterval(timer);
  }, [minimized, activeId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const closeStatusPopover = () => {
      if (!statusPopover) return;
      resizeNativePopover(false);
      setStatusPopover(null);
    };
    const closeTransientUi = (event) => {
      if (event.key !== "Escape") return;
      closeStatusPopover();
      setModal(null);
      setAddFlow(null);
    };
    window.addEventListener("keydown", closeTransientUi);
    window.addEventListener("blur", closeStatusPopover);
    return () => {
      window.removeEventListener("keydown", closeTransientUi);
      window.removeEventListener("blur", closeStatusPopover);
    };
  }, [statusPopover]);

  const performAccountSwitch = async () => {
    if (!isNativeDesktop()) {
      setToast(t.accountManagementPending);
      return;
    }
    try {
      await switchNativeCodexAccount(selectedId);
      setActiveId(selectedId);
      setToast(t.switched);
      await loadSnapshot();
    } catch (error) {
      setToast(typeof error === "string" && error ? error : t.bridgeUnavailable);
    }
  };

  const requestSwitch = () => {
    if (selectedId === activeId) return;
    if (codexRunning) setModal("switch");
    else performAccountSwitch();
  };

  const requestCodexToggle = async () => {
    if (!isNativeDesktop()) {
      setToast(t.processControlPending);
      return;
    }
    if (codexRunning) {
      setModal("close");
      return;
    }
    try {
      await openNativeCodex();
      setToast(t.opened);
      window.setTimeout(() => loadSnapshot(), 1500);
    } catch {
      setToast(t.bridgeUnavailable);
    }
  };

  const confirmDangerousAction = async () => {
    if (isNativeDesktop()) {
      try {
        await forceCloseNativeCodex();
      } catch {
        setToast(t.bridgeUnavailable);
        setModal(null);
        return;
      }
    }
    setCodexRunning(false);
    if (modal === "switch") {
      await performAccountSwitch();
    } else {
      setToast(t.closed);
    }
    setModal(null);
  };

  const requestAddAccount = () => {
    if (!isNativeDesktop()) {
      setToast(t.accountManagementPending);
      return;
    }
    setAddFlow("login");
  };

  const minimizeDeck = async () => {
    setStatusPopover(null);
    setToast("");
    setMinimized(true);
    await minimizeNativeWindow();
    loadSnapshot();
  };

  const restoreDeck = async () => {
    setStatusPopover(null);
    setMinimized(false);
    await restoreNativeWindow();
  };

  const toggleMainWindowSize = async () => {
    const nextCompact = !compact;
    setCompact(nextCompact);
    await resizeNativeMainWindow(nextCompact);
  };

  const executeWindowClose = async (action) => {
    setModal(null);
    if (action === "minimize") {
      await minimizeDeck();
      return;
    }
    if (await quitNativeDeck()) return;
    setDeckClosed(true);
  };

  const requestWindowClose = () => {
    if (savedWindowCloseAction) {
      executeWindowClose(savedWindowCloseAction);
      return;
    }
    setWindowCloseChoice("minimize");
    setRememberWindowCloseChoice(false);
    setModal("window-close");
  };

  const confirmWindowClose = () => {
    if (rememberWindowCloseChoice) {
      window.localStorage.setItem(windowCloseStorageKey, windowCloseChoice);
      setSavedWindowCloseAction(windowCloseChoice);
    }
    executeWindowClose(windowCloseChoice);
  };

  const startOfficialLogin = async () => {
    if (signingIn) return;
    setSigningIn(true);
    try {
      await loginNativeCodexAccount(addAlias);
      setAddFlow(null);
      setAddAlias("");
      await loadSnapshot(true);
    } catch (error) {
      setToast(typeof error === "string" && error ? error : t.bridgeUnavailable);
    } finally {
      setSigningIn(false);
    }
  };

  const toggleThreadPopover = (status) => {
    if (statusPopover === status) {
      closeThreadPopover();
      return;
    }
    const nextThreads = threadGroups[status];
    if (!nextThreads.length) {
      closeThreadPopover();
      return;
    }
    setStatusPopover(status);
    resizeNativePopover(true, nextThreads.length);
  };

  const openThread = async (thread) => {
    try {
      await openNativeCodexThread(thread.id);
      closeThreadPopover();
      setToast(t.openedThread);
    } catch (error) {
      setToast(typeof error === "string" && error ? error : t.bridgeUnavailable);
    }
  };

  const refresh = () => {
    if (refreshing) return;
    loadSnapshot(true);
  };

  const startDrag = (event) => {
    if (event.button !== 0 || event.target.closest?.("button, input, select, label, a")) return;
    event.preventDefault();
    if (isNativeDesktop()) {
      startNativeWindowDrag();
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: barPosition.x,
      originY: barPosition.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    setBarPosition({
      x: dragRef.current.originX + event.clientX - dragRef.current.startX,
      y: Math.max(8, dragRef.current.originY + event.clientY - dragRef.current.startY),
    });
  };

  const endDrag = (event) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const closeThreadPopover = () => {
    if (!statusPopover) return;
    setStatusPopover(null);
    resizeNativePopover(false);
  };

  if (deckClosed) return <div className={`app-root ${theme}`} aria-label={t.quitDeck} />;

  if (minimized) {
    return (
      <div
        className={`app-root minimized-root ${theme}`}
        onClick={(event) => {
          if (event.target.closest?.(".thread-state-button, .thread-popover")) return;
          closeThreadPopover();
        }}
      >
        <div
          className="top-status-wrap"
          style={isNativeDesktop() ? undefined : { transform: `translate(${barPosition.x}px, ${barPosition.y}px)` }}
        >
          <section
            className="top-status-bar"
            onPointerDown={startDrag}
            onPointerMove={isNativeDesktop() ? undefined : moveDrag}
            onPointerUp={isNativeDesktop() ? undefined : endDrag}
            onPointerCancel={isNativeDesktop() ? undefined : endDrag}
            aria-label="Codex Deck status bar"
          >
            <span
              className={`compact-brand ${codexRunning ? "online" : "offline"}`}
              title={`Codex Deck · ${codexRunning ? `${t.codexProcessRunning} · ${codexProcessCount}` : t.codexProcessStopped}`}
              aria-label={`Codex Deck · ${codexRunning ? t.codexProcessRunning : t.codexProcessStopped}`}
            >
              <Icon src={codexDeckMark} size={23} />
              <i className="runtime-dot" />
            </span>
            <span className="compact-account" title={activeAccount?.name[lang] || accountStateLabel}>
              {activeAccount?.name[lang] || t.compactNoAccount}
            </span>
            <span className="bar-divider" />
            <div className="thread-state-group" aria-label="Thread status">
              <button
                className={`thread-state-button running ${threadCounts.running === 0 ? "zero" : ""} ${statusPopover === "running" ? "selected" : ""}`}
                title={t.threadRunning}
                aria-label={`${t.threadRunning}: ${threadCounts.running}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => toggleThreadPopover("running")}
              >
                <Icon src={playIcon} size={18} /><span>{threadCounts.running}</span>
              </button>
              <button
                className={`thread-state-button attention ${hasThreadError ? "error" : ""} ${threadCounts.attention === 0 ? "zero" : ""} ${statusPopover === "attention" ? "selected" : ""}`}
                title={t.threadAttention}
                aria-label={`${t.threadAttention}: ${threadCounts.attention}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => toggleThreadPopover("attention")}
              >
                <Icon src={warningIcon} size={18} /><span>{threadCounts.attention}</span>
              </button>
            </div>
            <span className="bar-divider" />
            <div
              className="compact-quota"
              title={activeAccount ? `${t.currentAccountQuota} · ${Number.isFinite(activeAccount.quota) ? `${activeAccount.quota}%` : "—"} · ${t.reset} ${activeAccount.reset[lang]}` : accountStateLabel}
            >
              <span>{activeAccount && Number.isFinite(activeAccount.quota) ? `${activeAccount.quota}%` : "—"}</span>
              <QuotaBar value={activeAccount?.quota ?? 0} />
            </div>
            <button
              className="icon-button compact-control"
              title={t.expand}
              aria-label={t.expand}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={restoreDeck}
            >
              <Icon src={chevronDownIcon} size={19} />
            </button>
          </section>

          {statusPopover && (
            <section className="thread-popover" aria-label={statusPopover === "running" ? t.threadRunning : t.threadAttention}>
              <header>
                <h2>{statusPopover === "running" ? t.threadRunning : t.threadAttention}</h2>
                <span>{filteredThreads.length}</span>
              </header>
              <div className="thread-list">
                {filteredThreads.length === 0 && <div className="thread-empty">{threadStatusUnavailable ? t.threadUnavailable : t.noThreads}</div>}
                {filteredThreads.map((thread) => {
                  const threadAccount = accountItems.find((account) => account.id === thread.accountId);
                  const threadIcon = thread.status === "running" ? playIcon : warningIcon;
                  return (
                    <button className={`thread-row ${thread.status}`} key={thread.id} title={t.openThread} onClick={() => openThread(thread)}>
                      <Icon src={threadIcon} size={18} />
                      <span className="thread-row-copy">
                        <strong>{thread.title[lang]}</strong>
                        {thread.accountId !== activeId && <small>{threadAccount?.name[lang]}</small>}
                      </span>
                      <time>{thread.time[lang]}</time>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`app-root ${theme}`}>
      <section className="window-shell">
        <header className="titlebar" onPointerDown={startDrag}>
          <div className="brand">
            <Icon src={codexDeckMark} size={24} />
            <span>Codex Deck</span>
            <small className="app-version">v{packageInfo.version}</small>
          </div>
          <div className="titlebar-actions" onPointerDown={(event) => event.stopPropagation()}>
            <div className="display-switches">
              <button className="icon-button" title={t.theme} aria-label={t.theme} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                <Icon src={darkThemeIcon} size={18} />
              </button>
              <span className="switch-separator" />
              <button className="language-button" title={t.language} onClick={() => setLang(lang === "zh" ? "en" : "zh")}>
                <Icon src={globeIcon} size={17} />
                <span>{lang === "zh" ? "中" : "EN"}</span>
              </button>
            </div>
            <button className="window-button" title={t.minimize} aria-label={t.minimize} onClick={minimizeDeck}>
              <Icon src={minimizeIcon} size={17} />
            </button>
            <button className="window-button" title={t.maximize} aria-label={t.maximize} onClick={toggleMainWindowSize}>
              <Icon src={maximizeIcon} size={16} />
            </button>
            <button className="window-button close-window" title={t.closeWindow} aria-label={t.closeWindow} onClick={requestWindowClose}>
              <Icon src={dismissIcon} size={18} />
            </button>
          </div>
        </header>

        <div className="workspace">
          <aside className="account-panel">
            <div className="account-panel-header">
              <h2>{t.accounts}</h2>
              <button className="icon-button add-account-button" title={t.addAccount} aria-label={t.addAccount} onClick={requestAddAccount}>
                <Icon src={personAddIcon} size={20} />
              </button>
            </div>
            <div className="account-list">
              {orderedAccounts.length === 0 && (
                <div className="account-empty-state">
                  <strong>{accountStateLabel}</strong>
                  {bridgeState !== "loading" && <span>{accountStateBody}</span>}
                </div>
              )}
              {orderedAccounts.map((account) => {
                const isActive = account.id === activeId;
                const isSelected = account.id === selectedId;
                return (
                  <button
                    type="button"
                    className={`account-row ${isActive ? "active" : ""} ${isSelected ? "selected" : ""}`}
                    key={account.id}
                    onClick={() => setSelectedId(account.id)}
                    aria-pressed={isSelected}
                  >
                    <span className="account-heading">
                      <span className={`account-dot ${isActive ? "active" : ""}`} />
                      <strong>{account.name[lang]}</strong>
                      <span className={`plan-badge ${account.plan.toLowerCase()}`}>{account.plan}</span>
                      {isActive && <span className="active-badge">{t.active}</span>}
                    </span>
                    <span className="account-quota-line">
                      <span>{t.quota} · {Number.isFinite(account.quota) ? `${account.quota}% ${t.remaining}` : "—"}</span>
                      <span>{Number.isFinite(account.quota) ? `${account.quota}%` : "—"}</span>
                    </span>
                    <QuotaBar value={account.quota} />
                    <span className="account-reset">{t.reset} {account.reset[lang]}</span>
                  </button>
                );
              })}
            </div>
            <div className="account-footnote">
              <span>{t.accountCount(accountItems.length)}</span>
              <AccountSortMenu value={accountSort} onChange={setAccountSort} t={t} />
              {bridgeState === "error" && <small>{t.bridgeUnavailable}</small>}
            </div>
          </aside>

          <main className="detail-panel">
            {!selectedAccount ? (
              <section className="detail-empty-state">
                <span className="detail-empty-mark"><Icon src={codexDeckMark} size={30} /></span>
                <h1>{accountStateLabel}</h1>
                {bridgeState !== "loading" && <p>{accountStateBody}</p>}
                <div className="detail-empty-actions">
                  <button className="button open-button" onClick={requestCodexToggle}>
                    <Icon src={playIcon} size={20} />
                    {t.openCodex}
                  </button>
                  <button className="button secondary-button" onClick={refresh} disabled={refreshing}>
                    <span className={refreshing ? "spin" : ""}><Icon src={refreshIcon} size={21} /></span>
                    {t.refresh}
                  </button>
                </div>
              </section>
            ) : (
              <>
            <section className="account-overview">
              <div className="overview-topline">
                <div className="selected-account-title">
                  <h1>{selectedAccount.name[lang]}</h1>
                  <span className={`plan-badge ${selectedAccount.plan.toLowerCase()}`}>{selectedAccount.plan}</span>
                </div>
                <div className="primary-actions">
                  {selectedId !== activeId && (
                    <button className="button switch-button" onClick={requestSwitch}>
                      <Icon src={swapIcon} size={20} />
                      {t.switchAccount}
                    </button>
                  )}
                  <button className={`button ${codexRunning ? "danger-button" : "open-button"}`} onClick={requestCodexToggle}>
                    <Icon src={codexRunning ? stopIcon : playIcon} size={20} />
                    {codexRunning ? t.closeCodex : t.openCodex}
                  </button>
                  <button className="button secondary-button" onClick={refresh} disabled={refreshing}>
                    <span className={refreshing ? "spin" : ""}><Icon src={refreshIcon} size={21} /></span>
                    {t.refresh}
                  </button>
                </div>
              </div>

              {activeAccount && selectedId !== activeId && <div className="preview-banner">{t.preview(activeAccount.name[lang])}</div>}

              <div className="quota-summary">
                <div className="quota-label"><Icon src={clockIcon} size={21} /><strong>{t.quota} · {Number.isFinite(selectedAccount.quota) ? `${selectedAccount.quota}% ${t.remaining}` : "—"}</strong></div>
                <div className="reset-label"><Icon src={calendarIcon} size={21} />{t.reset} {selectedAccount.reset[lang]}</div>
              </div>
              <QuotaBar value={selectedAccount.quota} />
            </section>

            <section className="usage-summary">
              <div className="usage-stat">
                <span>{t.today}</span>
                <strong title={selectedAccount.todayCost == null ? t.metricUnavailable : undefined}>{selectedAccount.todayCost ?? "—"}</strong>
                <small>{selectedAccount.todayPending ? t.statsAsOf(selectedAccount.statsAsOf) : t.officialToday(selectedAccount.usageUpdatedAt)}</small>
              </div>
              <div className="usage-stat">
                <span>{t.month}</span>
                <strong title={selectedAccount.monthCost == null ? t.metricUnavailable : undefined}>{selectedAccount.monthCost ?? "—"}</strong>
              </div>
              <div className="usage-stat">
                <span>{t.todayToken}</span>
                <strong>{selectedAccount.todayTokens}</strong>
                <small>{selectedAccount.todayPending ? t.statsAsOf(selectedAccount.statsAsOf) : t.officialToday(selectedAccount.usageUpdatedAt)}</small>
              </div>
              <div className="usage-stat">
                <span>{t.monthToken}</span>
                <strong>{selectedAccount.monthTokens}</strong>
                <small>tokens</small>
              </div>
              <div className="estimate-note">
                <strong>{t.estimate}</strong>
                <span>{selectedAccount.todayCost != null || selectedAccount.monthCost != null ? t.priceUpdated : t.metricUnavailable}</span>
              </div>
            </section>

            <section className="trend-section">
              <div className="section-heading">
                <h3>{t.tokenTrend}</h3>
                <div className="chart-legend">
                  <span><i className="legend-square" />{t.totalTokens}</span>
                  <span><i className="legend-dash" />{t.average}</span>
                </div>
              </div>
              <div className="chart-wrap"><TokenChart theme={theme} values={selectedAccount.chartValues} dates={selectedAccount.chartDates} /></div>
            </section>

            <section className="local-diagnostics">
              <div className="diagnostic-stat"><span>{t.cacheReuse}</span><strong title={selectedAccount.cacheReuse == null ? t.metricUnavailable : undefined}>{selectedAccount.cacheReuse == null ? "—" : `${selectedAccount.cacheReuse}%`}</strong></div>
              <div className="diagnostic-stat"><span>{t.cachedInput}</span><strong title={selectedAccount.cachedInput == null ? t.metricUnavailable : undefined}>{selectedAccount.cachedInput ?? "—"}</strong></div>
              <div className="diagnostic-stat"><span>{t.uncachedInput}</span><strong title={selectedAccount.uncachedInput == null ? t.metricUnavailable : undefined}>{selectedAccount.uncachedInput ?? "—"}</strong></div>
              <div className={`cache-progress ${selectedAccount.cacheReuse == null ? "unavailable" : ""}`} title={selectedAccount.cacheReuse == null ? t.metricUnavailable : undefined}>
                {selectedAccount.cacheReuse == null ? (
                  <span>{t.metricUnavailable}</span>
                ) : (
                  <>
                    <span>{t.cacheReuse} {selectedAccount.cacheReuse}%</span>
                    <span>{t.uncachedInput} {100 - selectedAccount.cacheReuse}%</span>
                  </>
                )}
                <div className="cache-track"><span style={{ width: `${selectedAccount.cacheReuse ?? 0}%` }} /></div>
              </div>
            </section>

            <section className="model-section">
              <h3>{t.modelUsage}</h3>
              {selectedAccount.modelUsage.length ? (
                <>
                  <div className="model-track">
                    {selectedAccount.modelUsage.map((model, index) => (
                      <span className={`model-segment model-${index + 1}`} style={{ width: `${model.percent}%` }} key={model.name} />
                    ))}
                  </div>
                  <div className="model-labels">
                    {selectedAccount.modelUsage.map((model, index) => (
                      <span key={model.name}><i className={`model-dot model-${index + 1}`} />{model.name} {model.percent}%</span>
                    ))}
                  </div>
                  <small className="local-usage-note">{t.localModelUsage}</small>
                </>
              ) : (
                <>
                  <div className="model-track unavailable" />
                  <div className="model-labels"><span>{t.metricUnavailable}</span></div>
                </>
              )}
            </section>
              </>
            )}
          </main>
        </div>
      </section>

      {modal && modal !== "window-close" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setModal(null)}>
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className="modal-copy">
              <h2 id="modal-title">{modal === "switch" ? t.modalSwitchTitle : t.modalCloseTitle}</h2>
              <p>{modal === "switch" ? t.modalSwitchBody : t.modalCloseBody}</p>
              <p className="warning-copy">{t.unsaved}</p>
            </div>
            <div className="modal-actions">
              <button className="button secondary-button" autoFocus onClick={() => setModal(null)}>{t.cancel}</button>
              <button className="button danger-button" onClick={confirmDangerousAction}>
                {modal === "switch" ? t.confirmSwitch : t.confirmClose}
              </button>
            </div>
          </section>
        </div>
      )}

      {modal === "window-close" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setModal(null)}>
          <section className="confirm-modal window-close-modal" role="dialog" aria-modal="true" aria-labelledby="window-close-title">
            <div className="modal-copy">
              <h2 id="window-close-title">{t.windowCloseTitle}</h2>
              <p>{t.windowCloseBody}</p>
              <div className="window-close-options" role="radiogroup" aria-label={t.windowCloseBody}>
                <label className={windowCloseChoice === "minimize" ? "selected" : ""}>
                  <input type="radio" name="window-close-action" value="minimize" checked={windowCloseChoice === "minimize"} onChange={() => setWindowCloseChoice("minimize")} />
                  <span className="window-close-option-icon"><Icon src={minimizeIcon} size={20} /></span>
                  <span><strong>{t.minimizeDeck}</strong><small>{t.minimizeDeckHint}</small></span>
                </label>
                <label className={windowCloseChoice === "close" ? "selected" : ""}>
                  <input type="radio" name="window-close-action" value="close" checked={windowCloseChoice === "close"} onChange={() => setWindowCloseChoice("close")} />
                  <span className="window-close-option-icon"><Icon src={dismissIcon} size={20} /></span>
                  <span><strong>{t.quitDeck}</strong><small>{t.quitDeckHint}</small></span>
                </label>
              </div>
              <label className="remember-close-choice">
                <input type="checkbox" checked={rememberWindowCloseChoice} onChange={(event) => setRememberWindowCloseChoice(event.target.checked)} />
                <span>{t.rememberCloseChoice}</span>
              </label>
            </div>
            <div className="modal-actions">
              <button className="button secondary-button" autoFocus onClick={() => setModal(null)}>{t.cancel}</button>
              <button className="button open-button" onClick={confirmWindowClose}>{t.confirmWindowClose}</button>
            </div>
          </section>
        </div>
      )}

      {addFlow && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAddFlow(null)}>
          <section className="confirm-modal add-account-modal" role="dialog" aria-modal="true" aria-labelledby="add-account-title">
            <div className="modal-copy">
              <div className="add-account-heading">
                <span className="add-account-mark"><Icon src={personAddIcon} size={22} /></span>
                <div>
                  <h2 id="add-account-title">{t.addTitle}</h2>
                  <p>{t.addDescription}</p>
                </div>
              </div>

              <div className="account-detected-card">
                <div className="detected-account-line">
                  <span className="detected-avatar"><Icon src={windowConsoleIcon} size={20} /></span>
                  <div><strong>{t.officialLogin}</strong><span>{t.loginPrototype}</span></div>
                </div>
                <label htmlFor="account-alias">{t.accountAlias}</label>
                <input id="account-alias" value={addAlias} onChange={(event) => setAddAlias(event.target.value)} placeholder={lang === "zh" ? "留空则使用 ChatGPT 用户名" : "Leave blank to use ChatGPT name"} />
                <small>{t.aliasHelp}</small>
              </div>
            </div>
            <div className="modal-actions">
              <button className="button secondary-button" disabled={signingIn} onClick={() => { setAddFlow(null); setSigningIn(false); }}>{t.cancel}</button>
              <button className="button open-button" disabled={signingIn} onClick={startOfficialLogin}>
                <span className={signingIn ? "spin" : ""}><Icon src={windowConsoleIcon} size={20} /></span>
                {t.officialLogin}
              </button>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
