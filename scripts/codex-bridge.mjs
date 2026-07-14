import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { normalizeSnapshot, requestIds } from "../shared/normalize-codex-snapshot.mjs";

const execFileAsync = promisify(execFile);

function send(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function queryAppServer({ timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", "codex app-server --stdio"],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    const responses = new Map();
    let stdoutBuffer = "";
    let stderr = "";
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      if (error) reject(error);
      else resolve(Object.fromEntries(responses));
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Codex app-server did not respond in time."));
    }, timeoutMs);

    child.on("error", (error) => finish(error));
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 8_000) stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }

        if (message.id === 1) {
          send(child, { method: "initialized" });
          send(child, {
            method: "thread/list",
            id: requestIds.threads,
            params: {
              limit: 20,
              sortKey: "updated_at",
              sortDirection: "desc",
              archived: false,
              useStateDbOnly: true,
            },
          });
          send(child, {
            method: "account/read",
            id: requestIds.account,
            params: { refreshToken: false },
          });
          send(child, { method: "account/rateLimits/read", id: requestIds.rateLimits });
          send(child, { method: "account/usage/read", id: requestIds.usage });
          continue;
        }

        if (Object.values(requestIds).includes(message.id)) {
          if (message.error) {
            finish(new Error(message.error.message || `Codex request ${message.id} failed.`));
            return;
          }
          responses.set(message.id, message.result);
          if (responses.size === Object.keys(requestIds).length) finish();
        }
      }
    });
    child.on("exit", (code) => {
      if (!settled) {
        const detail = stderr.trim() ? ` ${stderr.trim()}` : "";
        finish(new Error(`Codex app-server exited with code ${code}.${detail}`));
      }
    });

    send(child, {
      method: "initialize",
      id: 1,
      params: {
        clientInfo: { name: "codex-deck", title: "Codex Deck", version: "0.1.0" },
        capabilities: null,
      },
    });
  });
}

async function readCodexDesktopProcess() {
  if (process.platform !== "win32") return { running: false, count: 0 };

  const command = [
    "$items = Get-CimInstance Win32_Process | Where-Object {",
    "  $_.Name -eq 'ChatGPT.exe' -and",
    "  $_.ExecutablePath -like '*OpenAI.Codex*' -and",
    "  $_.CommandLine -notmatch '--type='",
    "};",
    "@($items).Count",
  ].join(" ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    { windowsHide: true, timeout: 5_000 },
  );
  const count = Number.parseInt(stdout.trim(), 10) || 0;
  return { running: count > 0, count };
}

export async function queryCodexSnapshot(options) {
  const processInfo = await readCodexDesktopProcess().catch(() => ({ running: false, count: 0 }));
  const raw = await queryAppServer(options);
  return normalizeSnapshot(raw, processInfo);
}

export { normalizeSnapshot };
