// What the \`drizzler\` command prints and decides from its arguments: pure, so cli/index.ts only
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
