import { autoLayout } from "../diagram/layout.js";
import { svgToPng } from "../diagram/png.js";
import { renderDiagramSvg } from "../diagram/svg.js";
import { withRasterFonts } from "../diagram/text.js";
import { diagramSchema } from "../helper/index.js";
import type { DiagramTheme } from "../types/index.js";

/** The ER diagram of a Drizzle schema, laid out automatically, as an SVG document. */
export function erSvg(code: readonly string[], theme: DiagramTheme = "light") {
  const schema = diagramSchema(code);
  return renderDiagramSvg({ ...schema, positions: autoLayout(schema), theme });
}

/**
 * The same drawing rasterised to PNG at 2x. The font stacks put CJK first:
 * resvg draws nothing for a family that lacks a glyph, where a browser falls
 * back one glyph at a time.
 */
export function erPng(code: readonly string[], theme: DiagramTheme = "light") {
  return svgToPng(withRasterFonts(erSvg(code, theme)));
}
