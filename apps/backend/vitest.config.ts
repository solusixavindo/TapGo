import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Uji lama (sebelum Stage D2) berasumsi semua pesanan tampil untuk semua driver.
    // Uji D2 menyalakan proximity secara eksplisit lewat objek env.
    env: { RIDE_OFFER_PROXIMITY_ENABLED: "false" },
    globals: false,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup/disconnectPrismaAfterFile.ts"],
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
