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
