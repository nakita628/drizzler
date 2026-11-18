// What the `drizzler` command prints and decides from its arguments: pure, so cli/index.ts only
// reads the schema, writes the output and prints these.
import path from "node:path";
import type {
  FileReadError,
  MissingAssetsError,
  ServerListenError,
} from "../studio/server/errors/index.js";

/**
 * What an output path asks for, by its extension: a directory (a trailing `/`, or no extension)
 * is the docs; null for a file drizzler does not write.
 */
export function outputKind(output: string) {
  if (output.endsWith("/") || path.extname(output) === "") return "docs" as const;
  if (output.endsWith(".dbml")) return "dbml" as const;
  if (output.endsWith(".png") || output.endsWith(".svg")) return "diagram" as const;
  if (output.endsWith(".md")) return "mermaid" as const;
  return null;
}

/** The kinds of output drizzler writes. */
export type OutputKind = NonNullable<ReturnType<typeof outputKind>>;

/** The message for an output path drizzler does not write. */
export function unsupportedOutputMessage(output: string) {
  return `Unsupported output format: ${output}. Supported: .dbml, .svg, .png, .md, or a directory for the docs`;
}

/** What the line printed after writing calls the output; for the docs, the files it holds. */
export function describeOutput(kind: OutputKind, output: string, written: readonly string[]) {
  switch (kind) {
    case "dbml":
      return "DBML";
    case "mermaid":
      return "Mermaid ER";
    case "diagram":
      return `${output.endsWith(".png") ? "PNG" : "SVG"} ER diagram`;
    case "docs": {
      const names = written.map((file) => path.relative(output, file));
      const top = names.filter((name) => !name.includes(path.sep));
      const tables = names.length > top.length ? ["tables/*.svg"] : [];
      return `docs (${[...top, ...tables].join(", ")})`;
    }
  }
}

/** The line printed after writing: what was written, and where. */
export function generatedLine(kind: OutputKind, output: string, written: readonly string[]) {
  return `💧 Generated ${describeOutput(kind, output, written)} at: ${output}`;
}

/** What the terminal says when the studio cannot start. */
export function studioFailure(error: FileReadError | MissingAssetsError | ServerListenError) {
  switch (error._tag) {
    case "FileReadError":
      return `Failed to read input: ${error.path} ${error.cause}`;
    case "MissingAssetsError":
      return `drizzler studio assets were not found in ${error.dir}.\nReinstall drizzler, or run "pnpm build" when working from the repository.`;
    case "ServerListenError":
      if (error.code === "EADDRINUSE") {
        return `Port ${error.port} is in use. Pass --port to pick another.`;
      }
      return `Failed to start studio: ${error.message}`;
  }
}

/**
 * Why there is no schema to read when an output is asked for: the drizzle config has no `schema`,
 * or there is no config.
 *
 * @param output - the output asked for, shown in the example command
 * @param config - the drizzle config found, or null
 */
function noSchemaMessage(output: string, config: string | null) {
  const why =
    config === null
      ? "no schema was given and there is no drizzle.config.ts here"
      : `${path.basename(config)} has no \`schema\``;
  return `No schema to read: ${why}. Pass the schema files, e.g. \`drizzler src/schema.ts -o ${output}\``;
}

/**
 * What `drizzler <input...> -o <output>` does with what it was given: show the usage when it was
 * given nothing, say why there is no schema to read for an output, say what is wrong with the
 * output, or write the kind of output the path asks for.
 *
 * @param inputs - the schema inputs, given or from the drizzle config
 * @param output - the `-o` path, or null
 * @param config - the drizzle config found, or null; named in the message when it has no schema
 */
export function planGenerate(
  inputs: readonly string[],
  output: string | null,
  config: string | null = null,
):
  | { readonly action: "help" }
  | { readonly action: "error"; readonly message: string }
  | { readonly action: "write"; readonly output: string; readonly kind: OutputKind } {
  if (inputs.length === 0) {
    // A bare `drizzler` asks for the usage; with an output, a script expects a file or a failure.
    return output === null
      ? { action: "help" }
      : { action: "error", message: noSchemaMessage(output, config) };
  }
  if (output === null) {
    return { action: "error", message: "Missing -o flag. Usage: drizzler <input...> -o <output>" };
  }
  const kind = outputKind(output);
  if (kind === null) return { action: "error", message: unsupportedOutputMessage(output) };
  return { action: "write", output, kind };
}
