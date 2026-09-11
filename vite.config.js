import { defineConfig } from "vite";

export default defineConfig({
  // Discord serves the activity from the root of your mapped URL, and its
  // proxy rewrites asset paths. Relative base keeps asset URLs portable.
  base: "",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    // Handy when tunnelling localhost (e.g. cloudflared) into Discord.
    allowedHosts: true,
  },
});
