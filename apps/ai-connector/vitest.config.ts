import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/.spellbook/**", "**/node_modules/**", "**/dist/**"],
  },
});
