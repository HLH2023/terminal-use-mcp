import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/manual/**"],
    testTimeout: 30_000,
  },
})
