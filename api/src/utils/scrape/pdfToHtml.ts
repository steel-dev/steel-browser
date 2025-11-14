import { load as loadHtml } from "cheerio";

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

export function extractLinksFromConvertedHtml(html: string): { url: string; text: string }[] {
  const $ = loadHtml(html);
  return $("a[href]")
    .map((_, a) => {
      const url = $(a).attr("href") || "";
      const text = $(a).text()?.trim() || "";
      return { url, text };
    })
    .get();
}

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
