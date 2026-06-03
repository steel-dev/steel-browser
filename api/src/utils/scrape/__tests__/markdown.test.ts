import { describe, expect, it, vi } from "vitest";
import { getDefuddleContent } from "../readability";
import { jsonToMarkdown } from "../jsonToMarkdown";
import { stripBase64Images } from "../stripBase64Images";
import baseline from "./baseline.json";
import {
  base64ImageCount,
  loadGzHtml,
  loadRaw,
  mangledLinkCount,
  relativeLinkCount,
  wordCount,
} from "./helpers";

const includeHeavy = process.env.SCRAPE_EVAL_HEAVY === "1";

type PageSpec = {
  key: keyof typeof baseline;
  file: string;
  url: string;
  canary: string[];
  noise: string[];
  expectAuthor?: boolean;
  heavy?: boolean;
};

const PAGES: PageSpec[] = [
  {
    key: "article",
    file: "article.html.gz",
    url: "https://www.lesswrong.com/posts/WewsByywWNhX9rtwi/current-ais-seem-pretty-misaligned-to-me",
    canary: ["Some predictions", "Laziness and overselling"],
    noise: ["LOGIN", "Toggle navigation"],
    expectAuthor: true,
  },
  {
    key: "wikipedia",
    file: "wikipedia.html.gz",
    url: "https://en.wikipedia.org/wiki/Steel",
    canary: ["pig iron", "carbon content"],
    noise: ["Toggle the table of contents", "148 languages"],
    expectAuthor: true,
  },
  {
    key: "arxiv",
    file: "arxiv.html.gz",
    url: "https://arxiv.org/html/1706.03762v7",
    canary: ["Scaled Dot-Product Attention", "Multi-Head Attention"],
    noise: ["Report GitHub Issue", "Why HTML?"],
  },
  {
    key: "sec",
    file: "sec.html.gz",
    url: "https://www.sec.gov/",
    canary: ["Figma"],
    noise: [],
    heavy: true,
  },
];

describe("markdown extraction (real pages)", () => {
  for (const page of PAGES) {
    const runner = page.heavy && !includeHeavy ? it.skip : it;

    runner(
      `${page.key}: extracts main content without chrome or broken links`,
      async () => {
        const result = await getDefuddleContent(loadGzHtml(page.file), page.url);
        const markdown = result.contentMarkdown ?? "";
        const band = baseline[page.key];

        expect(result.content.length).toBeGreaterThan(0);
        expect(wordCount(markdown)).toBeGreaterThanOrEqual(band.minWords);
        expect(wordCount(markdown)).toBeLessThanOrEqual(band.maxWords);

        for (const phrase of page.canary) expect(markdown).toContain(phrase);
        for (const phrase of page.noise) expect(markdown).not.toContain(phrase);

        expect(mangledLinkCount(markdown)).toBe(0);
        expect(relativeLinkCount(markdown)).toBe(0);

        if (page.expectAuthor) {
          expect(result.author.length).toBeGreaterThan(0);
          expect(result.wordCount).toBeGreaterThan(0);
        }
      },
      page.heavy ? 60000 : 30000,
    );
  }
});

describe("synthetic kitchen-sink", () => {
  const convert = () =>
    getDefuddleContent(loadRaw("synthetic.html"), "https://synthetic.test/page");

  it("resolves urls and srcset, preserves code and tables, drops chrome", async () => {
    const markdown = (await convert()).contentMarkdown ?? "";

    expect(markdown).toContain("https://synthetic.test/img/hero-1280.png");
    expect(markdown).toContain("https://synthetic.test/docs/guide");
    expect(relativeLinkCount(markdown)).toBe(0);
    expect(mangledLinkCount(markdown)).toBe(0);

    expect(markdown).toContain("```python");
    expect(markdown).toContain("| alpha |");
    expect(markdown).toContain("beta");

    expect(markdown).not.toContain("About Us");
    expect(markdown).not.toContain("Privacy Policy");
  });

  it("removeBase64Images replaces inline data uris but keeps the alt text", async () => {
    const markdown = (await convert()).contentMarkdown ?? "";
    expect(base64ImageCount(markdown)).toBeGreaterThan(0);

    const stripped = stripBase64Images(markdown);
    expect(base64ImageCount(stripped)).toBe(0);
    expect(stripped).toContain("(<Base64-Image-Removed>)");
  });
});

describe("network isolation", () => {
  it("never fetches, even for urls whose defuddle extractor prefers async network extraction", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("network disabled in tests");
    });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const result = await getDefuddleContent(
        loadRaw("synthetic.html"),
        "https://www.reddit.com/r/test/comments/abc123/example_thread/",
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.contentMarkdown ?? "").toContain("Markdown Conversion Fidelity");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("jsonToMarkdown", () => {
  it("pretty-prints and fences valid json", () => {
    const out = jsonToMarkdown(loadRaw("api.json"));
    expect(out.startsWith("```json\n")).toBe(true);
    expect(out.endsWith("\n```")).toBe(true);

    const inner = out.slice("```json\n".length, -"\n```".length);
    const parsed = JSON.parse(inner);
    expect(parsed.name).toBe("Steel");
    expect(parsed.nested.count).toBe(3);
    expect(inner).toContain("\n  ");
  });

  it("wraps invalid json verbatim inside a json fence", () => {
    expect(jsonToMarkdown("not valid json")).toBe("```json\nnot valid json\n```");
  });
});

describe("stripBase64Images", () => {
  it("removes base64 images while leaving normal images and links untouched", () => {
    const markdown = [
      "![hero](https://example.com/img.png)",
      "![raster](data:image/png;base64,iVBORw0KGgoAAAANS)",
      "![vector](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)",
      "[a link](https://example.com/data:image/not-an-image)",
    ].join("\n");

    const out = stripBase64Images(markdown);

    expect(out).toContain("![hero](https://example.com/img.png)");
    expect(out).toContain("![raster](<Base64-Image-Removed>)");
    expect(out).toContain("![vector](<Base64-Image-Removed>)");
    expect(out).toContain("[a link](https://example.com/data:image/not-an-image)");
    expect(base64ImageCount(out)).toBe(0);
  });
});
