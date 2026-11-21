// The desktop app's own pages (src/appwin, docs/app.md): built apart from the web app into
// internal/desktop/assets/ui, which the app embeds. npm run build:app.
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(import.meta.dirname, "../internal/desktop/assets/ui"),
    emptyOutDir: true,
    rollupOptions: {
      input: { index: resolve(import.meta.dirname, "app.html") },
    },
  },
});
