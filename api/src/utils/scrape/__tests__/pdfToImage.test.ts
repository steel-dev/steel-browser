import * as mupdf from "mupdf";
import { describe, expect, it } from "vitest";
import { renderPdfFirstPageAsJpeg } from "../pdfToImage.js";

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
});
