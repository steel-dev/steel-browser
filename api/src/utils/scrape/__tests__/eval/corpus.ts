/**
 * Tier 1 eval corpus.
 *
 * The value of the invariant harness scales with how diverse this list is. It is
 * seeded with the existing regression fixtures (tagged by category) and is meant
 * to grow toward a few hundred pages spanning the categories Steel actually sees.
 *
 * To add an entry: capture the page's HTML (use the browser/scrape endpoint for
 * JS-rendered pages), gzip it into ./fixtures (`gzip -9 page.html`), and append a
 * row below. Keep large/slow pages `heavy: true` so they only run under
 * `SCRAPE_EVAL_HEAVY=1` (npm run test:heavy).
 */

import { loadGzHtml, loadRaw } from "../helpers";

export type CorpusEntry = {
  key: string;
  /** filename under ./fixtures; *.gz is gunzipped, anything else read as-is. */
  file: string;
  url: string;
  category: string;
  /** large/slow page — skipped unless SCRAPE_EVAL_HEAVY=1. */
  heavy?: boolean;
};

export const CORPUS: CorpusEntry[] = [
  {
    key: "article",
    file: "article.html.gz",
    url: "https://www.lesswrong.com/posts/WewsByywWNhX9rtwi/current-ais-seem-pretty-misaligned-to-me",
    category: "longform-article",
  },
  {
    key: "wikipedia",
    file: "wikipedia.html.gz",
    url: "https://en.wikipedia.org/wiki/Steel",
    category: "reference",
  },
  {
    key: "arxiv",
    file: "arxiv.html.gz",
    url: "https://arxiv.org/html/1706.03762v7",
    category: "academic-html",
  },
  {
    key: "sec",
    file: "sec.html.gz",
    url: "https://www.sec.gov/",
    category: "gov-listing",
    heavy: true,
  },
  {
    key: "synthetic",
    file: "synthetic.html",
    url: "https://synthetic.test/page",
    category: "synthetic-kitchensink",
  },
  {
    key: "fallback",
    file: "fallback.html",
    url: "https://fallback.test/changelog",
    category: "spa-modal-fallback",
  },
];

export const loadEntry = (entry: CorpusEntry): string =>
  entry.file.endsWith(".gz") ? loadGzHtml(entry.file) : loadRaw(entry.file);
