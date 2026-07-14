import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createCodexBridgePlugin } from "./scripts/codex-bridge-plugin.mjs";

export default defineConfig({
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react(), createCodexBridgePlugin()],
});
