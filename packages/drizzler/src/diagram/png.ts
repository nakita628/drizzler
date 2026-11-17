import { Resvg } from "@resvg/resvg-js";

/**
 * The most pixels a PNG is rendered with: 40 million, about 160 MB of RGBA before it is encoded.
 * A schema of fifty tables draws a diagram of some 5000 × 20000, which at twice its size would
 * need 1.6 GB and get the process killed on a small machine.
 */
export const MAX_PNG_PIXELS = 40_000_000;

const FONT = {
  loadSystemFonts: true,
  monospaceFamily: "DejaVu Sans Mono",
  sansSerifFamily: "DejaVu Sans",
} as const;

/**
 * The scale a diagram of `width` × `height` is rendered at: the one asked for, or less, so the
 * image stays within `maxPixels`.
 */
export function pngScale(
  width: number,
  height: number,
  scale: number,
  maxPixels = MAX_PNG_PIXELS,
): number {
  // The renderer rounds each side up to a whole pixel.
  const pixels = Math.ceil(width * scale) * Math.ceil(height * scale);
  if (pixels <= maxPixels) return scale;
  const fits = Math.sqrt(maxPixels / (width * height));
  return pngScale(width, height, Math.min(fits, scale * 0.999), maxPixels);
}

/**
 * Rasterises an SVG document at the given scale (2 = a crisp image on high-density displays), or
 * smaller when that would make an image of more than `MAX_PNG_PIXELS`.
 */
export function svgToPng(svg: string, scale = 2): Uint8Array {
  const { width, height } = new Resvg(svg, { font: { loadSystemFonts: false } });
  const resvg = new Resvg(svg, {
    fitTo: { mode: "zoom", value: pngScale(width, height, scale) },
    font: FONT,
  });
  return resvg.render().asPng();
}
