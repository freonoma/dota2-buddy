import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend listens on 3001 by default. We proxy /api and /ws to it
// so the frontend code can use relative URLs.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
