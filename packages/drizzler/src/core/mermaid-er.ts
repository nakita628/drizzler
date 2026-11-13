import { emitRaw } from "../emit/index.js";
import { mermaidER } from "../generator/index.js";

/**
 * Writes the Mermaid ER diagram of a Drizzle schema to `output`.
 *
 * @param code - the schema's source lines, without their imports
 * @param output - the Markdown file to write
 * @returns an Effect that writes the file
 */
export function drizzlerMermaidER(code: string[], output: string) {
  return emitRaw(mermaidER(code), output);
}
