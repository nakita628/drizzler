import { emitRaw } from "../emit/index.js";
import { erPng, erSvg } from "../generator/index.js";

/**
 * Writes the ER diagram of a Drizzle schema to `output`: a PNG for `.png`, an SVG otherwise.
 *
 * @param code - the schema's source lines, without their imports
 * @param output - the `.svg` or `.png` file to write
 * @param theme - the colour scheme, light by default
 * @returns an Effect that writes the file
 */
export function drizzlerER(code: string[], output: string, theme?: "light" | "dark") {
  return emitRaw(output.endsWith(".png") ? erPng(code, theme) : erSvg(code, theme), output);
}
