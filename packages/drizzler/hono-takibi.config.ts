import { defineConfig } from "hono-takibi";

export default defineConfig({
  input: "main.tsp",
  output: "src/studio/server/routes/index.ts",
  basePath: "/api",
  readonly: true,
  format: {
    printWidth: 100,
    singleQuote: false,
    semi: true,
  },
  // The typed `hc` client of the app; the hooks and the pages import it from here.
  client: {
    output: "src/studio/client/api/index.ts",
  },
  "tanstack-query": {
    output: "src/studio/client/hooks/index.ts",
  },
  template: {
    routeHandler: true,
    split: true,
  },
  exportSchemas: true,
  docs: {
    output: "docs/studio-api.md",
    curl: true,
    baseUrl: "http://127.0.0.1:4983",
  },
});
