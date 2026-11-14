import { defineConfig } from "vite-plus";

// Lint settings, built on the vite-plus-config of hakadate-developer-conference. `vp check` uses
// this block from every package; once format, lint and the type check (tsgolint) pass, the static
// checks are done. The settings are written inline in defineConfig, since a module-level const
// would itself fall under custom/require-as-const.
//
// Each rule's comment reads:
//   Why: what the rule prevents
//   NG:  code it reports
//   OK:  code it accepts

export default defineConfig({
  // Formatting keeps oxfmt's defaults; this block only names what is not formatted. The TanStack
  // Router plugin writes routeTree.gen.ts again on every build and dev start, in its own layout,
  // so a check after a build would otherwise find it changed.
  fmt: {
    ignorePatterns: ["packages/drizzler/src/studio/client/routeTree.gen.ts"],
  },
  // `vp test` runs the unit tests; the end-to-end tests in test/ drive the built package and run
  // on their own (`pnpm test:e2e`, after `pnpm build`).
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "test/**"],
  },
  lint: {
    // Only the plugins listed here are on (the default eslint..oxc have to be listed too).
    plugins: [
      "eslint",
      "typescript",
      "unicorn",
      "oxc",
      "import",
      "node",
      "promise",
      "react",
      "jsx-a11y",
      "vitest",
      "jsdoc",
    ],
    jsPlugins: ["./lint/custom.js"],
    // Three categories are on as a whole. style and restriction hold rules that contradict one
    // another, so only the ones wanted are turned on below.
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
    },
    ignorePatterns: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.gen.ts",
      // Generated from main.tsp by hono-takibi.
      "packages/drizzler/src/studio/server/routes/index.ts",
      "packages/drizzler/src/studio/client/api/index.ts",
      "packages/drizzler/src/studio/client/hooks/index.ts",
      // The lint rules themselves: plain JS that walks the AST imperatively.
      "lint/**",
    ],
    rules: {
      // =========================================================================
      // Rules turned off (they do not fit how this codebase is written)
      // =========================================================================

      // Why: demands a React import for the old JSX transform; the current transform needs none.
      // OK:   import { useState } from "react"
      "react/react-in-jsx-scope": "off",

      // Why off: Effect callbacks name the narrower value of an outer one the same (`error`).
      // OK:   Effect.mapError((error) => userError(error.message))
      "no-shadow": "off",

      // Why off: Effect's tagged errors are told apart by `_tag`.
      // OK:   if (error._tag === "ServerListenError") { ... }
      "no-underscore-dangle": "off",

      // Why off: a mapped copy with one more field is how values are extended here.
      // OK:   relations.map((r) => ({ ...r, isUnique }))
      "oxc/no-map-spread": "off",

      // Why off: seed inserts and tests that share a database run their steps in order.
      // OK:   for (const table of plan) { await insert(table) }
      "no-await-in-loop": "off",

      // Why off: CSS and Monaco's features are loaded by side-effect imports.
      // OK:   import "monaco-editor/features/clipboard/register.js"
      "import/no-unassigned-import": "off",

      // Why off: reports libraries whose default and named exports share a name.
      "import/no-named-as-default": "off",
      "import/no-named-as-default-member": "off",

      // Why off: a Vite `?worker` import has its default export only once bundled; TypeScript checks
      // default imports already.
      // OK:   import EditorWorker from "monaco-editor/editor/editor.worker.js?worker"
      "import/default": "off",

      // Why off: a React effect returns its cleanup on one path and nothing on another.
      // OK:   if (!editor) return
      //       return () => editor.dispose()
      "typescript/consistent-return": "off",

      // Why off: react-hooks/exhaustive-deps checks every hook's dependencies. These React
      //          Compiler-style rules repeat it, and would re-run the editor's mount-once effects.
      "react/exhaustive-effect-dependencies": "off",
      "react/set-state-in-effect": "off",
      "react/memo-dependencies": "off",

      // =========================================================================
      // Rules turned on: prevent bugs
      // =========================================================================

      // Why: `var` is function-scoped and hoisted.
      // NG:   var count = 0
      // OK:   const count = 0
      "no-var": "error",

      // Why: a variable never reassigned is a const, which says it does not change.
      // NG:   let name = "taro"  // never reassigned
      // OK:   const name = "taro"
      "prefer-const": "error",

      // Why: `==` converts types implicitly and compares the wrong things.
      // NG:   if (count == "0")
      // OK:   if (count === 0)
      eqeqeq: "error",

      // Why: no stray debug logging; the CLI prints through Effect's Console.
      // NG:   console.log(result)
      // OK:   yield* Console.log(`💧 Generated ${what} at: ${output}`)
      "no-console": "error",

      // Why: without a radix, parseInt may read "08" in another base.
      // NG:   parseInt(port)
      // OK:   parseInt(port, 10)
      radix: "error",

      // Why: a map / filter callback that forgets to return.
      // NG:   tables.map((table) => { table.name })
      // OK:   tables.map((table) => table.name)
      "array-callback-return": "error",

      // Why: throw only Errors, which keep a stack trace.
      // NG:   throw "not found"
      // OK:   throw new SchemaInputError(`${input} does not exist`)
      "no-throw-literal": "error",

      // Why: a catch that only rethrows does nothing.
      // NG:   try { run() } catch (error) { throw error }
      // OK:   run()
      "no-useless-catch": "error",

      // Why: no unused variables or parameters (a `_` name is discarded on purpose).
      // NG:   const unused = read()
      // OK:   const [_first, second] = pair
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],

      // Why: `any` turns the type check off; narrow with a type guard instead.
      // NG:   const row: any = result.rows[0]
      // OK:   if (isRecord(row)) { ... }
      "typescript/no-explicit-any": "error",

      // Why: `!` hides a possible null that then fails at runtime.
      // NG:   const name = table!.name
      // OK:   if (table === undefined) return []
      "typescript/no-non-null-assertion": "error",

      // Why: a ts-ignore style comment silences a type error instead of fixing it.
      // NG:   a ts-ignore / ts-expect-error comment above the failing line
      // OK:   fix the type error itself
      "typescript/ban-ts-comment": "error",

      // Why: ESM only; no require.
      // NG:   const fs = require("node:fs")
      // OK:   import fs from "node:fs"
      "typescript/no-require-imports": "error",

      // Why: replace @deprecated APIs before they go away.
      // NG:   fs.rmdirSync(dir, { recursive: true })
      // OK:   fs.rmSync(dir, { recursive: true, force: true })
      "typescript/no-deprecated": "error",

      // Why: a promise dropped unawaited swallows its failure.
      // NG:   server.close()  // returns a Promise
      // OK:   void server.close()  /  await server.close()
      "typescript/no-floating-promises": "error",

      // Why: a promise-returning function passed where nothing awaits it.
      // NG:   <form onSubmit={async () => { await save() }}>
      // OK:   <form onSubmit={() => { void save() }}>
      "typescript/no-misused-promises": "error",

      // Why: awaiting something that is not a promise.
      // NG:   await parseSource(code)
      // OK:   parseSource(code)
      "typescript/await-thenable": "error",

      // Why: an assertion that changes nothing.
      // NG:   const name = table.name as string  // already a string
      // OK:   const name = table.name
      "typescript/no-unnecessary-type-assertion": "error",

      // Why: a switch over a union that misses a case; one with a default counts as exhaustive.
      // NG:   switch (kind) { case "dbml": ...; case "mermaid": ... }  // no "diagram"
      // OK:   switch (kind) { case "dbml": ...; case "mermaid": ...; case "diagram": ... }
      "typescript/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],

      // Why: an import used only as a type is `import type`, so it is not loaded at runtime.
      // NG:   import { Program } from "oxc-parser"  // used only as a type
      // OK:   import type { Program } from "oxc-parser"
      "typescript/consistent-type-imports": "error",
      "typescript/no-import-type-side-effects": "error",

      // Why: `||` treats 0 as "no value". Strings and booleans may keep `||` (an empty string
      //      falls back to a default; booleans are or-ed).
      // NG:   const port = args.port || 4983  // a port of 0 becomes 4983
      // OK:   const port = args.port ?? 4983
      "typescript/prefer-nullish-coalescing": [
        "error",
        { ignorePrimitives: { string: true, boolean: true } },
      ],

      // Why: `+` joining a string and a number by mistake.
      // NG:   "rows: " + count
      // OK:   `rows: ${count}`
      "typescript/restrict-plus-operands": [
        "error",
        { allowNumberAndString: false, allowBoolean: false, allowNullish: false },
      ],

      // Why: a disable comment without rule names turns every rule off.
      // NG:   an oxlint-disable comment that names no rule
      // OK:   oxlint-disable-next-line no-console -- why
      "unicorn/no-abusive-eslint-disable": "error",

      // Why: the global isNaN / parseFloat convert implicitly; use Number's.
      // NG:   isNaN(value)
      // OK:   Number.isNaN(value)
      "unicorn/prefer-number-properties": "error",

      // Why: Node's built-in modules are imported with `node:`.
      // NG:   import fs from "fs"
      // OK:   import fs from "node:fs"
      "unicorn/prefer-node-protocol": "error",

      // Why: an import cycle can read a binding before it is set (undefined).
      // NG:   a.ts imports b.ts, and b.ts imports a.ts
      // OK:   move what they share to c.ts, imported by both
      "import/no-cycle": "error",
      "import/no-duplicates": "error",
      "import/no-self-import": "error",

      // Why: React hooks called inside a condition or a loop.
      // NG:   if (open) { const [value, setValue] = useState("") }
      // OK:   const [value, setValue] = useState("")  // at the top of the component
      "react/rules-of-hooks": "error",

      // Why: a button without a type submits its form.
      // NG:   <button onClick={close}>Close</button>
      // OK:   <button type="button" onClick={close}>Close</button>
      "react/button-has-type": "error",

      // Why: a page opened in a new tab can drive the opener.
      // NG:   <a href={url} target="_blank">
      // OK:   <a href={url} target="_blank" rel="noopener noreferrer">
      "react/jsx-no-target-blank": "error",

      // =========================================================================
      // Rules turned on: do not modify values (return new ones)
      // =========================================================================

      // Why: modifying a parameter changes the caller's value behind its back.
      // NG:   function normalize(table) { table.name = table.name.trim(); return table }
      // OK:   function normalize(table) { return { ...table, name: table.name.trim() } }
      "no-param-reassign": ["error", { props: true }],

      // Why: a function made in a loop that reads an outer variable the loop keeps changing.
      // NG:   for (const item of items) { total += item.size; logs.push(() => total) }
      // OK:   const logs = items.map((item) => () => item.size)
      "no-loop-func": "error",

      // Why: Object.assign modifies its first argument; spread builds a new object.
      // NG:   Object.assign({}, row, { id })
      // OK:   { ...row, id }
      "prefer-object-spread": "error",

      // Why: pass arguments with spread, not .apply().
      // NG:   Math.max.apply(null, widths)
      // OK:   Math.max(...widths)
      "prefer-spread": "error",

      // Why: convert to an array with spread.
      // NG:   Array.from(set)
      // OK:   [...set]
      "unicorn/prefer-spread": "error",

      // Why: building an object by growing it in a reduce.
      // NG:   pairs.reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {})
      // OK:   Object.fromEntries(pairs)
      "unicorn/prefer-object-from-entries": "error",

      // Why: reverse / sort modify the array; toReversed / toSorted return a new one.
      // NG:   comments.reverse()
      // OK:   comments.toReversed()
      "unicorn/no-array-reverse": "error",
      "unicorn/no-array-sort": "error",

      // Why: a private field never reassigned is readonly, which says it does not change.
      // NG:   private cache: Map<string, string>
      // OK:   private readonly cache: Map<string, string>
      "typescript/prefer-readonly": "error",

      // =========================================================================
      // Rules turned on: one way to write a thing
      // =========================================================================

      // Why: a named function is a declaration (hoisted, so a module reads top-down; named in
      //      stack traces).
      // NG:   const outputKind = (output: string) => { ... }
      // OK:   function outputKind(output: string) { ... }
      // A const whose type comes from an annotation may stay an arrow: the annotation types its
      // parameters and return, as Hono's handlers are written.
      // OK:   export const getDocsRouteHandler: RouteHandler<typeof getDocsRoute> = (c) => { ... }
      "func-style": ["error", "declaration", { allowTypeAnnotation: true }],

      // Why: a function in an object is written as a method.
      // NG:   { configureServer: (server) => { ... } }
      // OK:   { configureServer(server) { ... } }
      "object-shorthand": ["error", "always", { avoidExplicitReturnArrows: true }],

      // Why: nested ternaries; give each branch a named const or function.
      // NG:   kind === "dbml" ? a : kind === "mermaid" ? b : c
      // OK:   const what = describe(kind)
      "no-nested-ternary": "error",

      // =========================================================================
      // drizzler's own rules (./lint/custom.js, ported from hakadate-developer-conference)
      // =========================================================================

      // Why: a `utils` module becomes a drawer for anything; name a module for what it does.
      // NG:   src/utils/index.ts
      // OK:   src/schema/strip-imports.ts
      "custom/no-utils-module": "error",

      // Why: a reassigned variable makes the reader track what it holds at each line.
      // NG:   let total = 0; for (const t of tables) total += t.fields.length
      // OK:   const total = tables.reduce((sum, t) => sum + t.fields.length, 0)
      "custom/no-let": "error",

      // Why: anyone holding the same array sees an in-place change.
      // NG:   files.push(file) / files.sort()
      // OK:   [...files, file] / files.toSorted()
      "custom/no-array-mutation": "error",

      // Why: `const` does not stop an object's contents changing (React's ref.current is exempt).
      // NG:   row.id = id / delete row.id
      // OK:   const next = { ...row, id }
      "custom/no-property-assignment": "error",

      // Why: a module-level table of constants is readonly in its type too.
      // NG:   const MODULE_EXTENSIONS = [".ts", ".mts"]
      // OK:   const MODULE_EXTENSIONS = [".ts", ".mts"] as const
      "custom/require-as-const": "error",

      // Why: an assertion (as / <T>) checks nothing at runtime; `as const` is fine.
      // NG:   const config = value as Config
      // OK:   if (isConfig(value)) { ... }
      "custom/no-type-assertion": "error",

      // Why: a Match.orElse catch-all swallows failures added later; end with Match.exhaustive.
      // NG:   Match.value(error).pipe(Match.tag("A", ...), Match.orElse(() => ...))
      // OK:   Match.value(error).pipe(Match.tag("A", ...), Match.tag("B", ...), Match.exhaustive)
      "custom/match-exhaustive": "error",

      // Why: a recovered failure must be logged or turned into another failure, never dropped.
      // NG:   read.pipe(Effect.catch(() => Effect.void))
      // OK:   read.pipe(Effect.catch((error) => Effect.logError("read failed", error)))
      "custom/catch-must-log": "error",

      // =========================================================================
      // Rules turned on: keep loops linear (./lint/perf.js and built-in rules)
      // =========================================================================

      // Why: a search of another collection on every turn of a loop is O(n × m).
      // NG:   models.map((m) => relations.find((r) => r.to === m.name))
      // OK:   const byTarget = new Map(relations.map((r) => [r.to, r])); models.map((m) => byTarget.get(m.name))
      "custom/no-lookup-in-loop": "error",

      // Why: a reduce that copies its accumulator, or a part of it, each step is O(n²).
      // NG:   xs.reduce((s, x) => ({ next: s.next + 1, rows: [...s.rows, x] }), init)
      // OK:   xs.map((x, index) => ({ index, x }))
      "custom/no-accumulator-copy": "error",

      // Why: a RegExp / Set / Map built in a loop from values the loop does not change.
      // NG:   rows.filter((row) => new Set(ids).has(row.id))
      // OK:   const wanted = new Set(ids); rows.filter((row) => wanted.has(row.id))
      "custom/no-invariant-construction": "error",

      // Why: an array only ever asked `.includes()` is a Set, whose `.has()` does not scan.
      // NG:   const KEYWORDS = ["select", "from"] as const; KEYWORDS.includes(word)
      // OK:   const KEYWORDS = new Set(["select", "from"]); KEYWORDS.has(word)
      "unicorn/prefer-set-has": "error",

      // =========================================================================
      // Rules turned on: document the code (./lint/docs.js and the jsdoc plugin)
      // =========================================================================

      // Why: an exported function or class is read by people who did not write it; a TSDoc
      //      comment says what it is for before anyone reads the body. In the studio's layers
      //      it also documents every parameter and the return value (domain: an example too).
      // NG:   export function outputKind(output: string) { ... }
      // OK:   /** What an output path asks for, by its extension. */
      //       export function outputKind(output: string) { ... }
      "custom/require-tsdoc": "error",

      // Why: TSDoc tags are a fixed vocabulary; a misspelt tag (`@return`, `@params`) is lost.
      // NG:   /** @return the rows */
      // OK:   /** @returns the rows */
      "jsdoc/check-tag-names": [
        "error",
        { typed: true, definedTags: ["remarks", "typeParam", "defaultValue", "privateRemarks"] },
      ],

      // Why: a `@param` / `@returns` that names nothing, or says nothing, documents nothing.
      // NG:   /** @param - the table */  /  /** @param table */
      // OK:   /** @param table - the table's export name */
      "jsdoc/require-param-name": "error",
      "jsdoc/require-param-description": "error",
      "jsdoc/require-returns-description": "error",
      "jsdoc/check-property-names": "error",

      // Why: tags that take no value (`@deprecated` aside) must not carry one; an empty block is noise.
      // NG:   /** @internal because it is */  /  /** */
      // OK:   /** @internal */
      "jsdoc/empty-tags": "error",
      "jsdoc/no-blank-blocks": "error",

      // =========================================================================
      // Rules turned on: naming (./lint/layers.js)
      // =========================================================================

      // Why: one naming style for logic: camelCase functions and variables, UPPER_SNAKE constants.
      // NG:   const max_rows = 100
      // OK:   const MAX_ROWS = 100
      "custom/logic-camel-case": "error",

      // Why: a layer namespace reads as the layer itself.
      // NG:   import * as parseService from "../services/parse.js"
      // OK:   import * as ParseService from "../services/parse.js"
      "custom/layer-suffix-pascal-case": "error",
    },
    options: {
      // Rules that use type information.
      typeAware: true,
      // The type check (what tsc does) in the same pass.
      typeCheck: true,
      // A warning fails the check too.
      denyWarnings: true,
      // A disable comment that no longer disables anything is an error.
      reportUnusedDisableDirectives: "error",
    },
    // When overrides set the same rule, the later one wins.
    overrides: [
      // ---------------------------------------------------------------------
      // Pure by default: every module of the library takes values and returns values. The modules
      // that touch the outside world are named in the next block; a new module is pure unless it
      // is added there, so I/O cannot slip into one unnoticed. See ./lint/layers.js.
      // ---------------------------------------------------------------------
      {
        files: ["packages/drizzler/src/**"],
        rules: {
          "custom/domain-no-nondeterminism": "error",
          "custom/domain-no-side-effects": "error",
          "custom/pure-no-throw": "error",
          // Why: a pure module that imports I/O can start doing it unnoticed.
          // NG:   import fs from "node:fs"  /  import { Effect } from "effect"
          // OK:   import path from "node:path"  /  import { parseSync } from "oxc-parser"
          "no-restricted-imports": [
            "error",
            {
              paths: [
                { name: "effect", message: "Pure modules return values; Effects belong in core/." },
              ],
              patterns: [
                {
                  group: [
                    "node:fs",
                    "node:fs/*",
                    "node:child_process",
                    "node:os",
                    "node:http",
                    "node:https",
                    "node:net",
                    "node:crypto",
                    "@effect/*",
                    "../file/*",
                    "../core/*",
                    "../emit/*",
                    "../schema/sources.js",
                  ],
                  message:
                    "Pure modules do not touch the outside world; read it in core/ or schema/sources.ts and pass the value in.",
                },
              ],
            },
          ],
        },
      },
      {
        // The modules that do I/O, read the clock or the environment, or run Effects: the CLI, the
        // file and module loading, the studio's server edge, layers and client, and the seeder's
        // loading and writing. Effect failures are tagged error classes, kept with them. Tests set
        // up fixtures on disk and run Effects, so they are here too.
        files: [
          "packages/drizzler/src/**/*.test.ts",
          "packages/drizzler/src/**/*.test.tsx",
          "packages/drizzler/src/index.ts",
          "packages/drizzler/src/cli/**",
          "packages/drizzler/src/core/**",
          "packages/drizzler/src/emit/**",
          "packages/drizzler/src/file/**",
          "packages/drizzler/src/format/**",
          "packages/drizzler/src/schema/sources.ts",
          "packages/drizzler/src/seed/errors.ts",
          "packages/drizzler/src/seed/load-config.ts",
          "packages/drizzler/src/seed/resolve.ts",
          "packages/drizzler/src/seed/run.ts",
          "packages/drizzler/src/seed/write.ts",
          "packages/drizzler/src/studio/index.ts",
          "packages/drizzler/src/studio/client/**",
          "packages/drizzler/src/studio/server/index.ts",
          "packages/drizzler/src/studio/server/errors/**",
          "packages/drizzler/src/studio/server/handlers/**",
          "packages/drizzler/src/studio/server/services/**",
          "packages/drizzler/src/studio/server/usecases/**",
        ],
        rules: {
          "custom/domain-no-nondeterminism": "off",
          "custom/domain-no-side-effects": "off",
          "custom/pure-no-throw": "off",
          "no-restricted-imports": "off",
        },
      },
      {
        // A service that only wraps a library over values (oxc-parser) is held to the pure rules.
        files: ["packages/drizzler/src/studio/server/services/parse.ts"],
        rules: {
          "custom/domain-no-nondeterminism": "error",
          "custom/domain-no-side-effects": "error",
          "custom/pure-no-throw": "error",
        },
      },
      {
        // The seeder's generation computes over the schema and the seeded faker it is handed, and
        // uses Effect only as its error channel (`yield* new SeedGenerationError(...)`): Effect is
        // allowed, its I/O is not.
        files: [
          "packages/drizzler/src/seed/generate/**",
          "packages/drizzler/src/seed/plan.ts",
          "packages/drizzler/src/seed/schema.ts",
          "packages/drizzler/src/seed/validate.ts",
        ],
        rules: {
          "custom/effect-compute-only": "error",
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: [
                    "node:fs",
                    "node:fs/*",
                    "node:child_process",
                    "node:os",
                    "node:http",
                    "node:https",
                    "node:net",
                    "node:crypto",
                    "@effect/*",
                    "../file/*",
                    "../core/*",
                    "../emit/*",
                    "../schema/sources.js",
                  ],
                  message:
                    "Pure modules do not touch the outside world; read it in core/ or schema/sources.ts and pass the value in.",
                },
              ],
            },
          ],
        },
      },
      {
        // Why off: the SQL parser is recursive descent; a statement that does not parse unwinds by
        // `throw new ParseFailure`, caught in readStatement, which returns it as an `invalid`
        // statement. Nothing escapes the module: parseStatements returns values.
        files: ["packages/drizzler/src/sql/parse.ts"],
        rules: { "custom/pure-no-throw": "off" },
      },
      // ---------------------------------------------------------------------
      // The studio's API: handlers -> usecases -> services (and usecases -> domain).
      // See ./lint/layers.js for each rule's Why / NG / OK.
      // ---------------------------------------------------------------------
      {
        // Failures are Effect failures with a name, never exceptions; data is plain objects.
        files: ["packages/drizzler/src/studio/server/**"],
        rules: {
          "custom/no-throw": "error",
          "custom/no-try-catch": "error",
          "custom/no-class": "error",
          "custom/effect-run-at-edge": "error",
          "custom/promise-catch-must-log": "error",
          "custom/domain-only-from-usecases": "error",
        },
      },
      {
        // A handler maps HTTP to one usecase: validated input in, a parsed body or a problem out.
        files: ["packages/drizzler/src/studio/server/handlers/**"],
        rules: {
          "custom/handler-one-usecase": "error",
          "custom/handler-request-valid": "error",
          "custom/handler-response-shape": "error",
          "custom/require-sequence-diagram": "error",
          // Why: a handler reaches services and domain only through its usecase.
          // NG:   import { getStudio } from "../services/studio.js"
          // OK:   import * as SchemaUseCase from "../usecases/schema.js"
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["../services/*", "../domain/*"],
                  message:
                    "Handlers depend on usecases only; services and domain sit behind a usecase.",
                },
              ],
            },
          ],
        },
      },
      {
        // A usecase owns one request: it composes services and domain, never another usecase.
        files: ["packages/drizzler/src/studio/server/usecases/**"],
        rules: {
          "custom/no-usecase-to-usecase": "error",
          "custom/require-sequence-diagram": "error",
          "custom/layer-function-shape": "error",
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                { group: ["../handlers/*"], message: "Usecases do not know about HTTP handlers." },
              ],
            },
          ],
        },
      },
      {
        // A service touches one piece of I/O and draws it.
        files: ["packages/drizzler/src/studio/server/services/**"],
        rules: {
          "custom/no-service-to-service": "error",
          "custom/require-diagram": "error",
          "custom/layer-function-shape": "error",
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["../handlers/*", "../usecases/*"],
                  message: "Services sit below usecases; they do not call back up.",
                },
              ],
            },
          ],
        },
      },
      {
        // Domain is pure: values in, values out.
        files: ["packages/drizzler/src/studio/server/domain/**"],
        rules: {
          "custom/domain-import-allowlist": "error",
          "custom/domain-no-nondeterminism": "error",
          "custom/domain-no-side-effects": "error",
          "custom/layer-function-shape": "error",
        },
      },
      {
        // Tests build fixtures, so they may log, assert types and use `!`.
        files: ["**/*.test.ts", "**/*.test.tsx"],
        rules: {
          "no-console": "off",
          "typescript/no-non-null-assertion": "off",
          "typescript/no-explicit-any": "off",
          "typescript/no-floating-promises": "off",
          "custom/no-type-assertion": "off",
          "typescript/no-unsafe-type-assertion": "off",
          "custom/require-as-const": "off",
        },
      },
      {
        // Example and fixture scripts write to the terminal.
        files: ["examples/**", "fixtures/**", "**/*.mjs"],
        rules: { "no-console": "off", "custom/require-tsdoc": "off" },
      },
    ],
  },
});
