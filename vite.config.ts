import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Demo de Rodeo: SPA estática sin backend. `base: "./"` permite publicarla en
// cualquier subcarpeta (GitHub Pages, Netlify, Vercel) sin configurar nada.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@rodeo/shared": path.resolve(import.meta.dirname, "src/shared/index.ts"),
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  server: { port: 5180 },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 1200 },
});
