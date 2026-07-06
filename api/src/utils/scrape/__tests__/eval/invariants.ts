/**
 * Tier 1 eval: label-free invariants.
 *
 * Every check here must hold for the markdown of ANY page, with no ground-truth
 * reference. They catch the failure modes that actually bite a scraping API in
 * production — leaked chrome/scripts, unresolved relative links, empty output on
 * a contentful page, secret leakage, broken structure — without anyone having to
 * hand-label "correct" markdown.
 *
 * Severity:
 *   - "error": hard contract. corpus.test.ts fails CI if any page violates one.
 *   - "warn":  quality signal. surfaced in the report, does not gate CI.
 */

export type Severity = "error" | "warn";

export type InvariantContext = {
  url: string;
  /** HTML fed into the converter. */
  html: string;
  /** contentMarkdown produced by the pipeline. */
  markdown: string;
  /** Optional richer signals from the DefuddleResponse. */
  result?: {
    content?: string;
    wordCount?: number;
    extractorType?: string | null;
    title?: string;
  };
};

export type InvariantResult = {
  name: string;
  severity: Severity;
  pass: boolean;
  /** Human-readable reason; empty when pass. */
  detail: string;
};

type Invariant = {
  name: string;
  severity: Severity;
  check: (ctx: InvariantContext) => { pass: boolean; detail?: string };
};

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/** Rough visible-text estimate of the source HTML (drop script/style, strip tags). */
const visibleText = (html: string): string =>
  html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const sample = (matches: RegExpMatchArray | null, n = 3): string =>
  (matches ?? []).slice(0, n).join(" , ");

// Patterns for things that should never survive into clean markdown.
const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "openai/sk", re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: "aws-akid", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "github", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "slack", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { name: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
];

/** Word count below which a page is "not contentful" and we assert nothing. */
const CONTENTFUL_HTML_WORDS = 50;
/** Minimum markdown words expected when the source clearly had content. */
const MIN_MARKDOWN_WORDS = 10;

export const INVARIANTS: Invariant[] = [
  {
    name: "no-script-style-leak",
    severity: "error",
    check: ({ markdown }) => {
      const m = markdown.match(/<\/?(?:script|style|noscript)\b[^>]*>/gi);
      return { pass: !m, detail: m ? `leaked ${m.length} tag(s): ${sample(m)}` : "" };
    },
  },
  {
    name: "no-relative-links",
    severity: "error",
    check: ({ markdown }) => {
      // ](/x  ](./x  ](../x  — but NOT ](//cdn (protocol-relative, resolvable)
      const m = markdown.match(/\]\((?:\/(?!\/)|\.\.?\/)[^)]*\)/g);
      return { pass: !m, detail: m ? `${m.length} relative target(s): ${sample(m)}` : "" };
    },
  },
  {
    name: "no-mangled-links",
    severity: "error",
    check: ({ markdown }) => {
      // a space-less title squashed against the url: ](url"text
      const m = markdown.match(/\]\([^\s)]*"[^\s)]/g);
      return { pass: !m, detail: m ? `${m.length} mangled link(s): ${sample(m)}` : "" };
    },
  },
  {
    name: "non-empty-when-contentful",
    severity: "error",
    check: ({ html, markdown }) => {
      const htmlWords = words(visibleText(html));
      if (htmlWords < CONTENTFUL_HTML_WORDS) return { pass: true };
      const mdWords = words(markdown);
      return {
        pass: mdWords >= MIN_MARKDOWN_WORDS,
        detail: `source ~${htmlWords}w but markdown only ${mdWords}w`,
      };
    },
  },
  {
    name: "no-secret-leak",
    severity: "error",
    check: ({ markdown }) => {
      const hits = SECRET_PATTERNS.filter((p) => p.re.test(markdown)).map((p) => p.name);
      return { pass: hits.length === 0, detail: hits.length ? `matched: ${hits.join(", ")}` : "" };
    },
  },
  {
    name: "no-leaked-chrome-tags",
    severity: "warn",
    check: ({ markdown }) => {
      const m = markdown.match(
        /<\/?(?:nav|header|footer|aside|form|button|input|select|iframe)\b[^>]*>/gi,
      );
      return { pass: !m, detail: m ? `${m.length} chrome tag(s): ${sample(m)}` : "" };
    },
  },
  {
    name: "no-empty-image-src",
    severity: "warn",
    check: ({ markdown }) => {
      // ![alt]()  — usually a srcset-only image that lost its src
      const m = markdown.match(/!\[[^\]]*\]\(\s*\)/g);
      return { pass: !m, detail: m ? `${m.length} image(s) with empty src` : "" };
    },
  },
  {
    name: "no-empty-or-fragment-links",
    severity: "warn",
    check: ({ markdown }) => {
      const empty = markdown.match(/[^!]\]\(\s*\)/g) ?? [];
      const frag = markdown.match(/\]\(#[^)]*\)/g) ?? [];
      const js = markdown.match(/\]\(javascript:/gi) ?? [];
      const total = empty.length + frag.length + js.length;
      return {
        pass: total === 0,
        detail: total
          ? `${empty.length} empty, ${frag.length} fragment, ${js.length} javascript:`
          : "",
      };
    },
  },
  {
    name: "balanced-code-fences",
    severity: "warn",
    check: ({ markdown }) => {
      const fences = (markdown.match(/^```/gm) ?? []).length;
      return { pass: fences % 2 === 0, detail: fences % 2 ? `${fences} fence markers (odd)` : "" };
    },
  },
  {
    name: "no-html-comments",
    severity: "warn",
    check: ({ markdown }) => ({
      pass: !markdown.includes("<!--"),
      detail: markdown.includes("<!--") ? "html comment leaked into markdown" : "",
    }),
  },
  {
    name: "size-ratio-sane",
    severity: "warn",
    check: ({ html, markdown }) => {
      const src = words(visibleText(html));
      if (src < CONTENTFUL_HTML_WORDS) return { pass: true };
      const ratio = words(markdown) / src;
      // Clean extraction is a subset of the page's visible text, so ratio < ~1.
      // ratio > 1.2 means duplication or chrome leaking back in.
      return {
        pass: ratio <= 1.2,
        detail: ratio > 1.2 ? `markdown/source word ratio ${ratio.toFixed(2)}` : "",
      };
    },
  },
];

export const runInvariants = (ctx: InvariantContext, only?: Severity): InvariantResult[] =>
  INVARIANTS.filter((i) => !only || i.severity === only).map((i) => {
    const { pass, detail = "" } = i.check(ctx);
    return { name: i.name, severity: i.severity, pass, detail: pass ? "" : detail };
  });
