import { renderDiagramSvg } from "../../../../diagram/svg.js";
import type { DiagramInput } from "../../../../types/index.js";
import { downloadFile } from "../../lib/layout.js";

const EXPORT_SCALE = 2;

function loadImage(svg: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    image.addEventListener("load", () => {
      URL.revokeObjectURL(url);
      resolve(image);
    });
    image.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("The diagram could not be rasterised."));
    });
    image.setAttribute("src", url);
  });
}

/** Draws the diagram to a PNG through a canvas; the SVG is the same one `exportSvg` writes. */
async function renderDiagramPng(input: DiagramInput) {
  const svg = renderDiagramSvg(input);
  const image = await loadImage(svg);
  const canvas = document.createElement("canvas");
  canvas.setAttribute("width", String(image.width * EXPORT_SCALE));
  canvas.setAttribute("height", String(image.height * EXPORT_SCALE));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available in this browser.");
  context.scale(EXPORT_SCALE, EXPORT_SCALE);
  context.drawImage(image, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The diagram could not be encoded as PNG."));
    }, "image/png");
  });
}

/** Downloads the diagram as a PNG. */
export async function exportPng(fileName: string, input: DiagramInput) {
  downloadFile(fileName, await renderDiagramPng(input));
}

/** Downloads the diagram as an SVG. */
export function exportSvg(fileName: string, input: DiagramInput) {
  downloadFile(
    fileName,
    new Blob([renderDiagramSvg(input)], { type: "image/svg+xml;charset=utf-8" }),
  );
}
