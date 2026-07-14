import { queryCodexSnapshot } from "./codex-bridge.mjs";

const cacheTtlMs = 15_000;

export function createCodexBridgePlugin() {
  let cached = null;
  let inFlight = null;

  const getSnapshot = async () => {
    if (cached && Date.now() - cached.savedAt < cacheTtlMs) return cached.value;
    if (!inFlight) {
      inFlight = queryCodexSnapshot()
        .then((value) => {
          cached = { savedAt: Date.now(), value };
          return value;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };

  const installMiddleware = (server) => {
    server.middlewares.use("/api/codex/snapshot", async (request, response) => {
      if (request.method !== "GET") {
        response.statusCode = 405;
        response.end();
        return;
      }

      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      try {
        response.end(JSON.stringify(await getSnapshot()));
      } catch (error) {
        response.statusCode = 503;
        response.end(JSON.stringify({
          error: "codex_bridge_unavailable",
          message: error instanceof Error ? error.message : String(error),
        }));
      }
    });
  };

  return {
    name: "codex-deck-local-bridge",
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}

