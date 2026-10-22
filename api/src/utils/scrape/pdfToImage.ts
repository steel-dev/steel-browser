import * as mupdf from "mupdf";

const PDF_RENDER_SCALE = 2;
export const PDF_RENDER_MAX_PIXELS = 4096 * 4096;
export const PDF_RENDER_MAX_SIDE = 16_384;

export function pdfRenderScale(width: number, height: number): number {
  if (!(width > 0 && height > 0)) {
    throw new Error("PDF page has no printable area");
  }
  return Math.min(
    PDF_RENDER_SCALE,
    Math.sqrt(PDF_RENDER_MAX_PIXELS / (width * height)),
    PDF_RENDER_MAX_SIDE / Math.max(width, height),
  );
}

export function renderPdfFirstPageAsJpeg(pdfBuffer: Buffer, quality = 100): Buffer {
  const doc = mupdf.Document.openDocument(new Uint8Array(pdfBuffer), "application/pdf");
  try {
    const page = doc.loadPage(0);
    try {
      const [x0, y0, x1, y1] = page.getBounds();
      const scale = pdfRenderScale(x1 - x0, y1 - y0);
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
        false,
        true,
      );
      try {
        return Buffer.from(pixmap.asJPEG(quality));
      } finally {
        pixmap.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}
