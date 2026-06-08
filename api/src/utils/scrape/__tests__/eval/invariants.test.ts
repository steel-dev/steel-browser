import { describe, expect, it } from "vitest";
import { INVARIANTS, runInvariants, type InvariantContext } from "./invariants";

const ctx = (markdown: string, html = "<html><body></body></html>"): InvariantContext => ({
  url: "https://example.com/page",
  html,
  markdown,
});

const fails = (markdown: string, name: string, html?: string): boolean =>
  runInvariants(ctx(markdown, html)).some((r) => r.name === name && !r.pass);

// A clean, realistic markdown blob that should satisfy every invariant.
const CLEAN = [
  "# Title",
  "",
  "Some body text that is clearly long enough to count as real content, with",
  "more than a handful of words so the contentful check is satisfied here.",
  "",
  "See the [docs](https://example.com/docs) and the [api](https://example.com/api).",
  "",
  "![hero](https://example.com/hero.png)",
  "",
  "```python",
  "print('hi')",
  "```",
].join("\n");

const CONTENTFUL_HTML = `<html><body><article>${"word ".repeat(200)}</article></body></html>`;

describe("invariants: clean markdown passes everything", () => {
  it("produces zero failures on a well-formed document", () => {
    const failures = runInvariants(ctx(CLEAN, CONTENTFUL_HTML)).filter((r) => !r.pass);
    expect(failures.map((f) => `${f.name}: ${f.detail}`)).toEqual([]);
  });
});

describe("invariants: each one catches its failure mode", () => {
  it("no-script-style-leak", () => {
    expect(fails("text <script>alert(1)</script> more", "no-script-style-leak")).toBe(true);
    expect(fails("text <style>.a{}</style>", "no-script-style-leak")).toBe(true);
  });

  it("no-relative-links", () => {
    expect(fails("[home](/home)", "no-relative-links")).toBe(true);
    expect(fails("[up](../sibling)", "no-relative-links")).toBe(true);
    expect(fails("[here](./local)", "no-relative-links")).toBe(true);
    // protocol-relative and absolute must NOT trip it
    expect(fails("[cdn](//cdn.example.com/x)", "no-relative-links")).toBe(false);
    expect(fails("[abs](https://example.com/x)", "no-relative-links")).toBe(false);
  });

  it("no-mangled-links", () => {
    expect(fails('[x](https://e.com/a"title)', "no-mangled-links")).toBe(true);
  });

  it("non-empty-when-contentful", () => {
    expect(fails("", "non-empty-when-contentful", CONTENTFUL_HTML)).toBe(true);
    // an empty page must NOT trip it (nothing to extract)
    expect(fails("", "non-empty-when-contentful", "<html><body></body></html>")).toBe(false);
  });

  it("no-secret-leak", () => {
    expect(fails(`token sk-${"a1B2c3D4e5".repeat(3)} here`, "no-secret-leak")).toBe(true);
    expect(fails("AKIAIOSFODNN7EXAMPLE is a key", "no-secret-leak")).toBe(true);
    expect(fails("-----BEGIN PRIVATE KEY-----", "no-secret-leak")).toBe(true);
    expect(fails("the word sketch is fine", "no-secret-leak")).toBe(false);
  });

  it("no-leaked-chrome-tags (warn)", () => {
    expect(fails("<nav>menu</nav>", "no-leaked-chrome-tags")).toBe(true);
    expect(fails("<iframe src=x></iframe>", "no-leaked-chrome-tags")).toBe(true);
  });

  it("no-empty-image-src (warn)", () => {
    expect(fails("![lost]()", "no-empty-image-src")).toBe(true);
    expect(fails("![ok](https://e.com/i.png)", "no-empty-image-src")).toBe(false);
  });

  it("no-empty-or-fragment-links (warn)", () => {
    expect(fails("see [toc](#section)", "no-empty-or-fragment-links")).toBe(true);
    expect(fails("a [x]() b", "no-empty-or-fragment-links")).toBe(true);
  });

  it("balanced-code-fences (warn)", () => {
    expect(fails("```python\nprint(1)", "balanced-code-fences")).toBe(true);
    expect(fails("```python\nprint(1)\n```", "balanced-code-fences")).toBe(false);
  });

  it("no-html-comments (warn)", () => {
    expect(fails("text <!-- tracking --> text", "no-html-comments")).toBe(true);
  });

  it("size-ratio-sane (warn)", () => {
    const tinyHtml = `<html><body>${"w ".repeat(60)}</body></html>`;
    const bloated = "dup ".repeat(300);
    expect(fails(bloated, "size-ratio-sane", tinyHtml)).toBe(true);
  });
});

describe("invariants: severity split is wired", () => {
  it("error subset is a strict subset of all invariants", () => {
    const errors = runInvariants(ctx(CLEAN, CONTENTFUL_HTML), "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.length).toBeLessThan(INVARIANTS.length);
    expect(errors.every((r) => r.severity === "error")).toBe(true);
  });
});
