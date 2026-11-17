import { describe, expect, it } from "vite-plus/test";
import { MAX_PNG_PIXELS, pngScale, svgToPng } from "./png.js";

// The width and height a PNG's header chunk gives.
function pngSize(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("pngScale", () => {
  it("keeps the scale asked for while the image stays within the limit", () => {
    expect(pngScale(1000, 2000, 2)).toBe(2);
  });

  it("lowers it for a diagram as large as a fifty-table schema's (#35)", () => {
    const scale = pngScale(4860, 20_180, 2);
    expect(scale).toBeLessThan(1);
    expect(Math.ceil(4860 * scale) * Math.ceil(20_180 * scale)).toBeLessThanOrEqual(MAX_PNG_PIXELS);
  });
});

describe("svgToPng", () => {
  it("renders at twice the size by default", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"></svg>';
    expect(pngSize(svgToPng(svg))).toStrictEqual({ width: 80, height: 60 });
  });

  it("renders a diagram too large for that at a scale within the limit", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="8000"></svg>';
    const { width, height } = pngSize(svgToPng(svg));
    expect(width * height).toBeLessThanOrEqual(MAX_PNG_PIXELS);
    expect(width).toBeGreaterThan(6000);
  });
});
