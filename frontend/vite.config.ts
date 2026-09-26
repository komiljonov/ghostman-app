/// <reference types="vitest/config" />
import { writeFileSync } from "node:fs";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [
    solid(),
    {
      // Vite empties dist/ on build; re-add the tracked placeholder so
      // `//go:embed all:frontend/dist` compiles in a fresh clone and git stays clean.
      name: "keep-dist-placeholder",
      closeBundle() {
        writeFileSync("dist/gitkeep", "");
      },
    },
  ],
  build: {
    target: "es2022",
  },
  // Unit tests cover pure logic (e.g. src/tree.ts); no DOM needed.
  test: {
    environment: "node",
  },
});
