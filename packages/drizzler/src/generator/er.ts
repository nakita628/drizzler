import { autoLayout } from "../diagram/layout.js";
import { svgToPng } from "../diagram/png.js";
import { renderDiagramSvg } from "../diagram/svg.js";
import { withRasterFonts } from "../diagram/text.js";
import { diagramSchema } from "../helper/index.js";
import type { DiagramTheme } from "../types/index.js";

type Schema = ReturnType<typeof diagramSchema>;

/**
 * Draws a parsed schema, laid out automatically, as an SVG document.
 *
 * @param schema - the tables, relations and enums to draw
 * @param theme - the colour scheme, light by default
 * @returns the SVG document
 */
export function schemaSvg(schema: Schema, theme: DiagramTheme = "light") {
  return renderDiagramSvg({ ...schema, positions: autoLayout(schema), theme });
}

/** The ER diagram of a Drizzle schema, laid out automatically, as an SVG document. */
export function erSvg(code: readonly string[], theme: DiagramTheme = "light") {
  return schemaSvg(diagramSchema(code), theme);
}

/**
 * The part of a schema around one table: the table, the tables a relation joins it to, the
 * relations that touch it, and the enums those tables hold. What its own ER diagram draws.
 *
 * @param schema - the whole parsed schema
 * @param table - the table's export name
 * @returns the same shape as the schema, cut down to the table's neighbourhood
 */
export function neighborhood(schema: Schema, table: string): Schema {
  const relations = schema.relations.filter((r) => r.from.model === table || r.to.model === table);
  const names = new Set([table, ...relations.flatMap((r) => [r.from.model, r.to.model])]);
  const models = schema.models.filter((m) => names.has(m.name));
  const held = new Set(
    models.flatMap((m) => m.fields.filter((f) => f.kind === "enum").map((f) => f.type)),
  );
  return { models, relations, enums: schema.enums.filter((e) => held.has(e.name)) };
}

/**
 * The same drawing rasterised to PNG at 2x. The font stacks put CJK first:
 * resvg draws nothing for a family that lacks a glyph, where a browser falls
 * back one glyph at a time.
 */
export function erPng(code: readonly string[], theme: DiagramTheme = "light") {
  return svgToPng(withRasterFonts(erSvg(code, theme)));
}
