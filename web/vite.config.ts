import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
  // In dev (`npm run web:dev`), API calls go to the harness server on 4321.
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:4321" } },
});
