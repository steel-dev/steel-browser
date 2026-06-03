# scrape markdown regression suite

Deterministic, offline regression tests for the HTML → markdown pipeline
(`getDefuddleContent`, `stripBase64Images`, `jsonToMarkdown`). They run the real
conversion code against **frozen** HTML fixtures and assert on properties, so a
silent quality regression — most importantly a bad `defuddle` version bump — fails CI.

This is the fast per-PR gate. It is intentionally separate from the competitive,
LLM-judge benchmark (Steel vs Firecrawl/Jina), which is slow, costs money, needs a
live deploy, and is run occasionally by hand.

## Run

```bash
npm run test -w api            # fast suite (skips the 10 MB SEC fixture)
npm run test:heavy -w api      # also runs the heavy SEC fixture (~11s); use in CI
```

## Fixtures

`fixtures/` holds frozen inputs so the suite never touches the network:

| file | shape it exercises |
| --- | --- |
| `article.html.gz` | long-form article (body extraction, footnotes, no chrome) |
| `wikipedia.html.gz` | tables, many links, site-specific extractor |
| `arxiv.html.gz` | math → LaTeX, modal/nav/TOC noise removal |
| `sec.html.gz` | 10 MB filing — robustness / no crash (heavy lane) |
| `synthetic.html` | hand-built: relative urls, srcset, base64 image, fenced code, table, nav/footer |
| `api.json` | JSON-response fencing |

The `.html.gz` files are gzipped raw HTML originally captured by the benchmark.
They are frozen on purpose: the suite tests the converter, not the live web.

## What it guards

- main content survives (per-fixture canary phrases) and word count stays within a band
- boilerplate is gone (per-fixture noise phrases absent)
- no broken links (`](url"title)` glueing) and no unresolved relative links
- `removeBase64Images` strips inline data URIs but keeps alt text
- JSON responses become a valid ```json fence
- defuddle still returns author / wordCount used for metadata enrichment
- defuddle makes no network requests of its own (`useAsync: false`), so extraction
  never bypasses the session proxy or leaks the server IP

## Updating the baseline

When a change intentionally shifts output size, re-measure and update the word-count
bands in `baseline.json`. Treat large, unexplained swings as a regression to investigate,
not a baseline to rubber-stamp.
