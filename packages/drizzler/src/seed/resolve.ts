import { existsSync, statSync } from "node:fs";
import nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import { seedImportBase, seedImportCandidates } from "../schema/module-url.js";

function isFile(candidate: string) {
  return existsSync(candidate) && statSync(candidate).isFile();
}

/**
 * Resolves a relative or `file:` import the way a bundler does: `./db/schema` and `./data/users`
 * find `.ts` (or `.mts`, `.js`, `.mjs`, or an `index.ts`) files, and `./x.js` finds `x.ts` when
 * there is no `x.js`. Node.js alone wants the exact file name; the config and the schema it
 * imports are TypeScript that `drizzler seed` runs as such.
 */
function resolveTypeScript(
  specifier: string,
  context: { readonly parentURL?: string | undefined },
  next: (specifier: string) => { readonly url: string; readonly shortCircuit?: boolean },
) {
  const base = seedImportBase(specifier, context.parentURL);
  if (base === null || isFile(base)) return next(specifier);
  const found = seedImportCandidates(base).find(isFile);
  // The file is answered directly: a `require` in the project gets the same hook, and Node's own
  // CommonJS resolver does not take a `file:` URL as a specifier.
  return found === undefined
    ? next(specifier)
    : { url: pathToFileURL(found).href, shortCircuit: true };
}

/**
 * Runs the effect with the TypeScript resolution above registered as a module hook, and takes the
 * hook down again afterwards, whatever happened. A Node.js without `module.registerHooks`
 * (before 22.15) runs the effect as it is, and imports need their extensions.
 */
export function withTypeScriptImports<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() =>
      typeof nodeModule.registerHooks === "function"
        ? nodeModule.registerHooks({
            resolve: (specifier, context, nextResolve) =>
              resolveTypeScript(specifier, context, (resolved) => nextResolve(resolved, context)),
          })
        : null,
    ),
    () => effect,
    (hooks) =>
      Effect.sync(() => {
        hooks?.deregister();
      }),
  );
}
