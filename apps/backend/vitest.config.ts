import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "coverage",
      include: ["src/modules/referrals/**/*.ts", "src/modules/wallets/**/*.ts", "src/modules/memberships/**/*.ts"],
      exclude: ["**/*.routes.ts", "**/*.controller.ts"]
    }
  }
});
