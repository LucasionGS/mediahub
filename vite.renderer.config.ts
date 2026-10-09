import type { ConfigEnv, UserConfig } from "vite";
import { defineConfig } from "vite";
import Path from "node:path";
import react from "@vitejs/plugin-react-swc";
import { pluginExposeRenderer } from "./vite.base.config";

// https://vitejs.dev/config
export default defineConfig((env) => {
  const forgeEnv = env as ConfigEnv<"renderer">;
  const { root, mode, forgeConfigSelf } = forgeEnv;
  const name = forgeConfigSelf.name ?? "";

  return {
    root,
    mode,
    base: "./",
    build: {
      // Electron 43 renderer runs Chromium 150. The companion page is served to phones,
      // so it gets a broader target through its own input below.
      target: "es2022",
      outDir: `.vite/renderer/${name}`,
      rollupOptions: {
        // Two pages: the hub (also used for the quick-menu overlay) and the phone companion.
        input: {
          index: Path.resolve(root, "index.html"),
          companion: Path.resolve(root, "companion.html"),
        },
      },
    },
    plugins: [
      react(),
      pluginExposeRenderer(name),
    ],
    clearScreen: false,
  } as UserConfig;
});
