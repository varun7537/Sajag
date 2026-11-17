/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { resolve } from "node:path";

const root = import.meta.dirname;

export default defineConfig({
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        eval: resolve(root, "eval.html"),
      },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
