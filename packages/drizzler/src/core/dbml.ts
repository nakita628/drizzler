import { emitRaw } from "../emit/index.js";
import { dbml } from "../generator/index.js";

/**
 * Writes the DBML of a Drizzle schema to `output`.
 *
 * @param code - the schema's source lines, without their imports
 * @param output - the `.dbml` file to write
 * @returns an Effect that writes the file
 */
export function drizzlerDbml(code: string[], output: string) {
  return emitRaw(dbml(code), output);
}
