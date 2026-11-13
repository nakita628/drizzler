import path from "node:path";
import { getRequestListener } from "@hono/node-server";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { Effect } from "effect";
import { defineConfig } from "vite-plus";
import type { Plugin } from "vite-plus";
import studio from "./src/studio/server/index.js";
import { configureStudio, connectDatabase } from "./src/studio/server/usecases/studio.js";

const CLIENT_ROOT = path.resolve(import.meta.dirname, "src/studio/client");
const OUT_DIR = path.resolve(import.meta.dirname, "dist/studio");

// `vp dev -c vite.studio.config.ts` serves the client with hot reload and the API in the same
// process. DRIZZLER_SCHEMA picks the schema (default: the studio example), DRIZZLER_DATABASE_URL
// connects it to a database.
function studioApi(): Plugin {
  return {
    name: "drizzler-studio-api",
    apply: "serve",
    async configureServer(server) {
      const schemaPath = path.resolve(
        process.env.DRIZZLER_SCHEMA ??
          path.resolve(import.meta.dirname, "../../examples/studio/db/schema.ts"),
      );
      const cwd = process.cwd();
      const database = await Effect.runPromise(
        connectDatabase({ url: process.env.DRIZZLER_DATABASE_URL ?? null, cwd }),
      );
      configureStudio({ schemaPath, cwd, database });
      const listener = getRequestListener((request) => studio.fetch(request));
      // Mounting on '/api' would strip the prefix the Hono app routes on, so the path is checked here.
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/api/")) {
          void listener(req, res);
          return;
        }
        next();
      });
    },
  };
}

// The plugins are typed against the `vite` they were built for, which vite-plus re-exports under
// its own types; comparing the two structurally overflows the checker, so each is checked to be a
// plugin object at runtime instead.
function isPlugin(value: unknown): value is Plugin {
  return typeof value === "object" && value !== null && "name" in value;
}

function plugins(...values: readonly unknown[]): Plugin[] {
  return values.flat().filter(isPlugin);
}

export default defineConfig({
  root: CLIENT_ROOT,
  plugins: [
    // File-based routes under src/studio/client/routes → routeTree.gen.ts.
    ...plugins(
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: path.join(CLIENT_ROOT, "routes"),
        generatedRouteTree: path.join(CLIENT_ROOT, "routeTree.gen.ts"),
        quoteStyle: "double",
        semicolons: true,
      }),
      tailwindcss(),
      react(),
    ),
    studioApi(),
  ],
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    // Monaco's core is one large chunk that only the editor pages load; it cannot be split
    // further, since its services register themselves in module order.
    chunkSizeWarningLimit: 4096,
  },
});
