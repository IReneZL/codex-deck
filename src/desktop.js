import { invoke } from "@tauri-apps/api/core";

import { normalizeSnapshot } from "../shared/normalize-codex-snapshot.mjs";

export function isNativeDesktop() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function readCodexSnapshot() {
  if (isNativeDesktop()) {
    const raw = await invoke("get_codex_snapshot");
    const snapshot = normalizeSnapshot(raw.responses, raw.process);
    if (snapshot.account && raw.activeAccountName) snapshot.account.name = raw.activeAccountName;
    return {
      ...snapshot,
      accounts: raw.accounts || [],
      activeAccountId: raw.activeAccountId || null,
      localUsage: raw.localUsage || null,
      rolloutTokenCounters: raw.rolloutTokenCounters || [],
      capabilities: {
        ...snapshot.capabilities,
        modelBreakdown: Boolean(raw.localUsage?.models?.length),
        localTokenBreakdown: Boolean(raw.localUsage?.totalTokens),
      },
    };
  }

  const response = await fetch("/api/codex/snapshot", { cache: "no-store" });
  if (!response.ok) throw new Error(`Codex bridge returned ${response.status}`);
  return response.json();
}

export async function readCodexThreadSnapshot() {
  if (!isNativeDesktop()) return null;
  const raw = await invoke("get_codex_thread_snapshot");
  const snapshot = normalizeSnapshot({ 2: raw.response }, raw.process);
  return { process: snapshot.process, threads: snapshot.threads };
}

async function nativeCommand(command, args) {
  if (!isNativeDesktop()) return false;
  await invoke(command, args);
  return true;
}

export const minimizeNativeWindow = () => nativeCommand("set_compact_window");
export const restoreNativeWindow = () => nativeCommand("restore_main_window");
export const startNativeWindowDrag = () => nativeCommand("start_window_drag");
export const resizeNativeMainWindow = (compact) => nativeCommand("set_main_window_size", { compact });
export const resizeNativePopover = (open, itemCount = 0) => nativeCommand("set_compact_popover", { open, itemCount });
export const quitNativeDeck = () => nativeCommand("quit_deck");
export const openNativeCodex = () => nativeCommand("open_codex");
export const openNativeCodexThread = (threadId) => nativeCommand("open_codex_thread", { threadId });
export const setNativeTrayLanguage = (language) => nativeCommand("set_tray_language", { language });
export const loginNativeCodexAccount = (alias) => invoke("login_codex_account", { alias });
export const switchNativeCodexAccount = (accountId) => invoke("switch_codex_account", { accountId });

export async function forceCloseNativeCodex() {
  if (!isNativeDesktop()) return null;
  return invoke("force_close_codex");
}
