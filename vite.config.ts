import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Frontend never talks to api.mymind.com directly, and never sees the
    // signing secret — it only calls same-origin /api/*, which Vite relays
    // to the local Express proxy (server/index.js) in dev.
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
