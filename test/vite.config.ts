import { defineConfig } from "vite-plus";

export default defineConfig({
  // These tests drive the packaged `drizzler` (dist/cli.js) as a user does: build it first
  // (`pnpm build`). Each spawns real processes, servers and databases, so they get room.
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", ".tmp/**"],
    pool: "forks",
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
