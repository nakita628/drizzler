import { defineConfig } from "vite-plus";

export default defineConfig({
  // `vp pack` (tsdown): `cli` is the `drizzler` command, `index` is what
  // `import { defineConfig } from "drizzler"` loads in a drizzler.config.ts. The studio's client is
  // built after it by `vp build -c vite.studio.config.ts`, into dist/studio.
  pack: {
    entry: {
      cli: "./src/index.ts",
      index: "./src/seed/config.ts",
    },
    format: "esm",
    dts: true,
    // tsdown defaults to `.mjs` / `.d.mts` for node; `bin` and `exports` point at `.js` / `.d.ts`.
    outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  },
});
