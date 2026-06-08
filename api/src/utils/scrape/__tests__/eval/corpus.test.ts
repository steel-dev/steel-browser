import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDefuddleContent } from "../../readability";
import { CORPUS, loadEntry } from "./corpus";
import { runInvariants } from "./invariants";

const includeHeavy = process.env.SCRAPE_EVAL_HEAVY === "1";

// The pipeline must be fully offline (useAsync:false). Hard-fail if anything
// in the corpus run reaches for the network — that would be a proxy-bypass.
beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network disabled in eval");
    }),
  );
});
afterAll(() => vi.unstubAllGlobals());

describe("tier1: error invariants hold across the corpus", () => {
  for (const entry of CORPUS) {
    const run = entry.heavy && !includeHeavy ? it.skip : it;

    run(
      `${entry.key} (${entry.category})`,
      async () => {
        const html = loadEntry(entry);
        const result = await getDefuddleContent(html, entry.url);
        const markdown = result.contentMarkdown ?? "";

        const failures = runInvariants({ url: entry.url, html, markdown, result }, "error").filter(
          (r) => !r.pass,
        );

        expect(
          failures,
          `${entry.key}:\n${failures.map((f) => `  ✗ ${f.name} — ${f.detail}`).join("\n")}`,
        ).toEqual([]);
      },
      entry.heavy ? 60000 : 30000,
    );
  }
});
