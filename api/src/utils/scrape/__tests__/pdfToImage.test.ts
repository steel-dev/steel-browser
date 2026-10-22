import * as mupdf from "mupdf";
import { describe, expect, it } from "vitest";
import {
  PDF_RENDER_MAX_PIXELS,
  PDF_RENDER_MAX_SIDE,
  pdfRenderScale,
  renderPdfFirstPageAsJpeg,
} from "../pdfToImage.js";

function pdfWithPages(sizes: [number, number][]): Buffer {
  const doc = new mupdf.PDFDocument();
  try {
    for (const [width, height] of sizes) {
      const page = doc.addPage([0, 0, width, height], 0, {}, "0 0 1 rg 10 10 50 50 re f");
      doc.insertPage(-1, page);
    }
    return Buffer.from(doc.saveToBuffer().asUint8Array());
  } finally {
    doc.destroy();
  }
}

function imageSize(jpeg: Buffer): [number, number] {
  const image = new mupdf.Image(jpeg);
  try {
    return [image.getWidth(), image.getHeight()];
  } finally {
    image.destroy();
  }
}

describe("renderPdfFirstPageAsJpeg", () => {
  it("renders the first page as a jpeg at twice its size", () => {
    const jpeg = renderPdfFirstPageAsJpeg(pdfWithPages([[612, 792]]));

    expect([...jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(imageSize(jpeg)).toEqual([1224, 1584]);
  });

  it("ignores pages after the first", () => {
    const jpeg = renderPdfFirstPageAsJpeg(
      pdfWithPages([
        [300, 200],
        [612, 792],
      ]),
    );

    expect(imageSize(jpeg)).toEqual([600, 400]);
  });

  it("keeps a page that declares a huge size within the pixel budget", () => {
    const pdf = pdfWithPages([[14400, 14400]]);

    const [width, height] = imageSize(renderPdfFirstPageAsJpeg(pdf));

    expect(pdf.length).toBeLessThan(1024);
    expect(width * height).toBeLessThanOrEqual(PDF_RENDER_MAX_PIXELS * 1.01);
    expect(width).toBeLessThan(28800);
  });
});

describe("pdfRenderScale", () => {
  it("renders ordinary pages at twice their size", () => {
    expect(pdfRenderScale(612, 792)).toBe(2);
  });

  it("shrinks the scale so a large page stays within the pixel budget", () => {
    const scale = pdfRenderScale(14400, 14400);

    expect(scale).toBeLessThan(2);
    expect(14400 * scale * 14400 * scale).toBeCloseTo(PDF_RENDER_MAX_PIXELS, -3);
  });

  it("keeps a long thin page under the side limit", () => {
    const scale = pdfRenderScale(10, 1_000_000);

    expect(1_000_000 * scale).toBeLessThanOrEqual(PDF_RENDER_MAX_SIDE);
  });

  it("refuses a page with no area", () => {
    expect(() => pdfRenderScale(0, 792)).toThrow("PDF page has no printable area");
    expect(() => pdfRenderScale(612, Number.NaN)).toThrow("PDF page has no printable area");
  });
});
