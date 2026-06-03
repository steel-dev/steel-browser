import { load as loadHtml } from "cheerio";
import * as mupdf from "mupdf";

function parsePdfDate(pdfDate?: string | null): string | null {
  if (!pdfDate) return null;
  // PDF date format: D:YYYYMMDDHHmmSSOHH'mm'
  // Example: D:20240102153045-08'00'
  const m = pdfDate.match(
    /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz]|([+\-])(\d{2})'?(\d{2})'?)?$/,
  );
  if (!m) return null;

  const [_, y, mo = "01", d = "01", h = "00", mi = "00", s = "00", z, sign, tzH, tzM] = m;
  const yyyy = y;
  const MM = mo.padStart(2, "0");
  const dd = d.padStart(2, "0");
  const HH = h.padStart(2, "0");
  const MMm = mi.padStart(2, "0");
  const SS = s.padStart(2, "0");

  let offset = "Z";
  if (z && z.toUpperCase() !== "Z" && tzH && tzM) {
    offset = `${sign}${tzH}:${tzM}`;
  }
  // Build ISO string
  const iso = `${yyyy}-${MM}-${dd}T${HH}:${MMm}:${SS}${offset}`;
  const date = new Date(iso);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

type HtmlLikeMetadata = {
  title: string | null;
  language: string | null;
  urlSource: string | null;
  timestamp: string;
  description: string | null;
  keywords: string | null;
  author: string | null;

  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  ogUrl: string | null;
  ogSiteName: string | null;

  articleAuthor: string | null;
  publishedTime: string | null;
  modifiedTime: string | null;

  canonical: string | null;
  favicon: string | null;

  jsonLd: any[];
  statusCode: number;
};

export function buildHtmlLikeMetadataFromPdf(
  pdfMeta: any,
  opts: { urlSource?: string | null; statusCode?: number; htmlForFallback?: string | null },
): HtmlLikeMetadata {
  const { urlSource = null, statusCode = 200, htmlForFallback = null } = opts;

  // Try to get a title from meta, fallback to <title> in converted HTML
  let htmlTitle: string | null = null;
  if (htmlForFallback) {
    const $ = loadHtml(htmlForFallback);
    const t = $("title").first().text()?.trim();
    htmlTitle = t || null;
  }

  const title = pdfMeta?.title || htmlTitle || null;
  const author = pdfMeta?.author || null;
  const description = pdfMeta?.subject || null;

  // Keywords might be array or string depending on library
  let keywords: string | null = null;
  if (Array.isArray(pdfMeta?.keywords)) {
    keywords = pdfMeta.keywords.join(", ");
  } else if (typeof pdfMeta?.keywords === "string") {
    keywords = pdfMeta.keywords;
  }

  // XMP/DC language if exposed; often not present
  const language = pdfMeta?.language || pdfMeta?.["dc:language"] || null;

  const publishedTime =
    parsePdfDate(pdfMeta?.creationDate || pdfMeta?.CreationDate || pdfMeta?.["xmp:CreateDate"]) ||
    null;
  const modifiedTime =
    parsePdfDate(pdfMeta?.modDate || pdfMeta?.ModDate || pdfMeta?.["xmp:ModifyDate"]) || null;

  let origin: string | null = null;
  let host: string | null = null;
  if (urlSource) {
    try {
      const u = new URL(urlSource);
      origin = u.origin;
      host = u.hostname;
    } catch {}
  }

  return {
    title,
    language,
    urlSource,
    timestamp: new Date().toISOString(),

    description,
    keywords,
    author,

    ogTitle: title,
    ogDescription: description,
    ogImage: null,
    ogUrl: urlSource,
    ogSiteName: host,

    articleAuthor: author,
    publishedTime,
    modifiedTime,

    canonical: urlSource,
    favicon: origin ? `${origin}/favicon.ico` : null,

    jsonLd: [],
    statusCode,
  };
}

export type PdfConversion = {
  html: string;
  links: { url: string; text: string }[];
  meta: {
    title: string | null;
    author: string | null;
    subject: string | null;
    keywords: string | null;
    creationDate: string | null;
    modDate: string | null;
  };
};

export function convertPdfWithMupdf(pdfBuffer: Buffer): PdfConversion {
  const doc = mupdf.Document.openDocument(new Uint8Array(pdfBuffer), "application/pdf");
  try {
    const pageCount = doc.countPages();
    const sections: string[] = [];
    const links: { url: string; text: string }[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i);
      try {
        const stext = page.toStructuredText("preserve-whitespace");
        try {
          const body = loadHtml(stext.asHTML(i))("body").html();
          sections.push(`<section data-page="${i + 1}">${body ?? ""}</section>`);

          const external = page.getLinks().filter((link) => link.isExternal());
          if (external.length > 0) {
            const buckets = external.map((link) => ({
              url: link.getURI(),
              rect: link.getBounds(),
              chars: [] as string[],
            }));
            stext.walk({
              onChar(c, _origin, _font, _size, quad) {
                const cx = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
                const cy = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
                for (const b of buckets) {
                  if (cx >= b.rect[0] && cx <= b.rect[2] && cy >= b.rect[1] && cy <= b.rect[3]) {
                    b.chars.push(c);
                    break;
                  }
                }
              },
            });
            for (const b of buckets) {
              if (!b.url || seen.has(b.url)) continue;
              seen.add(b.url);
              links.push({ url: b.url, text: b.chars.join("").replace(/\s+/g, " ").trim() });
            }
          }
        } finally {
          stext.destroy();
        }
      } finally {
        page.destroy();
      }
    }

    const meta = {
      title: doc.getMetaData("info:Title") || null,
      author: doc.getMetaData("info:Author") || null,
      subject: doc.getMetaData("info:Subject") || null,
      keywords: doc.getMetaData("info:Keywords") || null,
      creationDate: doc.getMetaData("info:CreationDate") || null,
      modDate: doc.getMetaData("info:ModDate") || null,
    };

    const titleTag = meta.title ? `<title>${meta.title}</title>` : "";
    const html = `<!DOCTYPE html><html><head>${titleTag}</head><body>${sections.join(
      "",
    )}</body></html>`;

    return { html, links, meta };
  } finally {
    doc.destroy();
  }
}
