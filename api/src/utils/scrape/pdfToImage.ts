import * as mupdf from "mupdf";

const PDF_RENDER_SCALE = 2;

export function renderPdfFirstPageAsJpeg(pdfBuffer: Buffer, quality = 100): Buffer {
  const doc = mupdf.Document.openDocument(new Uint8Array(pdfBuffer), "application/pdf");
  try {
    const page = doc.loadPage(0);
    try {
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(PDF_RENDER_SCALE, PDF_RENDER_SCALE),
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
