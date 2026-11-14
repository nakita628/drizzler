import path from "node:path";
import { fileURLToPath } from "node:url";

// What a module hook asks of a URL: whether it is one of the project's own files, which drizzler
// resolves and loads itself, rather than a package's.

/** A file of the project: a `file:` URL outside `node_modules`. */
export function isProjectFile(url: string) {
  return url.startsWith("file:") && !url.includes("/node_modules/");
}

/** A TypeScript file of the project (`.ts`, `.tsx`, `.mts`, `.cts` ...), which must be transpiled to load. */
export function isProjectTypeScript(url: string) {
  return isProjectFile(url) && /\.(c|m)?tsx?$/u.test(new URL(url).pathname);
}

/**
 * The file a seed config's import names before Node looks, when the seeder resolves it: a relative
 * import from a `file:` module, or a `file:` URL; null for any other (a package, a `node:` module).
 */
export function seedImportBase(specifier: string, parentURL: string | undefined) {
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  if (!(relative || specifier.startsWith("file:"))) return null;
  if (relative && (parentURL === undefined || !parentURL.startsWith("file:"))) return null;
  return fileURLToPath(relative ? new URL(specifier, parentURL) : new URL(specifier));
}

/**
 * The files a seed import may name when its own path is not one, in the order tried: the `.ts`
 * twin of a `.js` import, then `.ts`, `.mts`, `.js`, `.mjs` added, then an index module.
 */
export function seedImportCandidates(base: string) {
  return [
    base.replace(/\.js$/u, ".ts"),
    `${base}.ts`,
    `${base}.mts`,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, "index.ts"),
    path.join(base, "index.js"),
  ];
}

/**
 * The TypeScript files a query's relative import may mean once Node found no file, in the order
 * tried: `.ts` added, an `index.ts` inside it, or the `.ts` twin of a `.js` / `.mjs` / `.cjs`.
 */
export function queryTypeScriptCandidates(specifier: string) {
  return [`${specifier}.ts`, `${specifier}/index.ts`, specifier.replace(/\.(c|m)?js$/u, ".$1ts")];
}

/**
 * The resolved URL with the version its importer carries (`?drizzler=<n>`), so a saved change to
 * any file of the schema loads it again; null when the importer has no version or the file is not
 * the project's TypeScript.
 */
export function carryVersion(parentURL: string, resolvedURL: string) {
  const version = parentURL.startsWith("file:")
    ? new URL(parentURL).searchParams.get("drizzler")
    : null;
  if (version === null || !isProjectTypeScript(resolvedURL)) return null;
  const url = new URL(resolvedURL);
  url.searchParams.set("drizzler", version);
  return url.href;
}
