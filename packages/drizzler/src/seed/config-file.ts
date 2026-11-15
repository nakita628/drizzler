// What `drizzler seed` decides about its config file: where it is, whether it can be read, and
// what its problems say. Pure: seed/load-config.ts checks the file system, imports the module and
// decodes it.
import path from "node:path";

/** The config `drizzler seed` looks for in the working directory. */
export const CONFIG_FILE = "drizzler.config.ts";

/** Whether a config path is a TypeScript file: the config is typed against the schema module, so it is TypeScript only. */
export function isConfigTypeScript(file: string) {
  return /\.[cm]?ts$/u.test(file);
}

/** What `drizzler seed` says when it cannot use the config. */
export const configMessages = {
  notTypeScript: (file: string) =>
    `Config must be a TypeScript file: ${file}\n   Write it as drizzler.config.ts, typed against the schema module.`,
  notFound: (file: string) => `Config not found: ${file}\n   Check the path passed to --config.`,
  noneIn: (cwd: string) =>
    `No ${CONFIG_FILE} in ${cwd}.\n   Write one with \`export default defineConfig(schema, { ... })\`, or pass --config <path>.`,
  cannotLoad: (file: string, reason: string) => `Cannot load ${file}: ${reason}`,
  noDefaultExport: (file: string) =>
    `${file} has no default export.\n   Write \`export default defineConfig(schema, { ... })\`.`,
} as const;

/** The default export of an imported module, when it has one. */
export function defaultExportOf(namespace: unknown) {
  return typeof namespace === "object" && namespace !== null && "default" in namespace
    ? namespace.default
    : undefined;
}

/** Whether an import failed because this Node.js cannot read TypeScript syntax on its own. */
export function isTypeScriptUnsupported(error: unknown) {
  if (error instanceof SyntaxError) return true;
  const code = error instanceof Error && "code" in error ? error.code : null;
  return (
    code === "ERR_UNKNOWN_FILE_EXTENSION" ||
    code === "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING" ||
    code === "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX"
  );
}

/**
 * Where the config is written with its types stripped, beside it so its imports resolve as they
 * would from the config; hidden, and named for the process so two runs do not share it.
 */
export function strippedSiblingPath(file: string, pid: number) {
  return path.join(path.dirname(file), `.${path.basename(file, path.extname(file))}.${pid}.mjs`);
}

/** Every problem of a config as `path: message`, one per line, under the file's name. */
export function configIssuesMessage(
  file: string,
  issues: readonly { readonly path?: readonly unknown[]; readonly message: string }[],
) {
  const lines = issues.map(
    (issue) => `${(issue.path ?? []).map(String).join(".") || "(root)"}: ${issue.message}`,
  );
  return `Invalid config in ${file}:\n   ${lines.join("\n   ")}`;
}
