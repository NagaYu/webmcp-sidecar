import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    background: "extension/background.ts",
    content: "extension/content.ts",
    "content-main-world": "extension/content-main-world.ts",
    "sidepanel/main": "extension/sidepanel/main.ts",
  },
  format: ["iife"],
  splitting: false,
  sourcemap: true,
  clean: true,
  target: "chrome121",
  outDir: "dist/extension",
  platform: "browser",
  noExternal: [/.*/],
});
