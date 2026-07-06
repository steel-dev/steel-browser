/**
 * Tier 1 eval report (run on demand, not in the unit-test path):
 *
 *   cd api && npm run eval:report
 *
 * Runs the whole corpus through the real conversion pipeline, times it, applies
 * every invariant, and prints an aggregate the 6 frozen fixtures never give you:
 * per-invariant pass rates, latency distribution, empty-output rate, extractor
 * mix, and the contentful-but-thin / oversized outliers. Writes eval-report.json
 * for trend tracking and exits non-zero if any error-level invariant is violated.
 */

import { writeFileSync } from "node:fs";
import { getDefuddleContent } from "../../readability";
import { CORPUS, loadEntry } from "./corpus";
import { INVARIANTS, runInvariants } from "./invariants";

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;

const pct = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};

const pad = (s: string | number, n: number): string => String(s).padEnd(n);

type Row = {
  key: string;
  category: string;
  ms: number;
  mdWords: number;
  mdChars: number;
  htmlChars: number;
  extractorType: string;
  errors: string[];
  warns: string[];
};

const main = async () => {
  const rows: Row[] = [];

  for (const entry of CORPUS) {
    const html = loadEntry(entry);
    const t0 = performance.now();
    const result = await getDefuddleContent(html, entry.url);
    const ms = performance.now() - t0;
    const markdown = result.contentMarkdown ?? "";

    const invs = runInvariants({ url: entry.url, html, markdown, result });
    rows.push({
      key: entry.key,
      category: entry.category,
      ms: Math.round(ms),
      mdWords: words(markdown),
      mdChars: markdown.length,
      htmlChars: html.length,
      extractorType: result.extractorType ?? "(none)",
      errors: invs
        .filter((r) => r.severity === "error" && !r.pass)
        .map((r) => `${r.name}: ${r.detail}`),
      warns: invs
        .filter((r) => r.severity === "warn" && !r.pass)
        .map((r) => `${r.name}: ${r.detail}`),
    });
  }

  // ---- per-page table ----
  console.log("\nPER-PAGE\n" + "-".repeat(72));
  console.log(pad("key", 12) + pad("category", 22) + pad("ms", 7) + pad("mdWords", 9) + "flags");
  for (const r of rows) {
    const flags =
      (r.errors.length ? `${r.errors.length}E ` : "") +
        (r.warns.length ? `${r.warns.length}W` : "") || "ok";
    console.log(pad(r.key, 12) + pad(r.category, 22) + pad(r.ms, 7) + pad(r.mdWords, 9) + flags);
  }

  // ---- invariant pass rates ----
  console.log("\nINVARIANTS (pages passing / total)\n" + "-".repeat(72));
  for (const inv of INVARIANTS) {
    const failed = rows.filter((r) =>
      [...r.errors, ...r.warns].some((x) => x.startsWith(inv.name + ":")),
    );
    const passed = rows.length - failed.length;
    const mark = failed.length === 0 ? "✓" : inv.severity === "error" ? "✗" : "!";
    console.log(
      `${mark} ${pad(inv.name, 28)} ${pad(`${passed}/${rows.length}`, 8)} [${inv.severity}]`,
    );
  }

  // ---- aggregates ----
  const lat = rows.map((r) => r.ms);
  const emptyRate = rows.filter((r) => r.mdWords === 0).length / rows.length;
  const extractorMix = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.extractorType] = (acc[r.extractorType] ?? 0) + 1;
    return acc;
  }, {});
  const totalErrors = rows.reduce((n, r) => n + r.errors.length, 0);
  const totalWarns = rows.reduce((n, r) => n + r.warns.length, 0);

  console.log("\nAGGREGATE\n" + "-".repeat(72));
  console.log(`pages              ${rows.length}`);
  console.log(`latency ms         p50=${pct(lat, 50)} p95=${pct(lat, 95)} max=${Math.max(...lat)}`);
  console.log(`empty-output rate  ${(emptyRate * 100).toFixed(1)}%`);
  console.log(
    `extractor mix      ${Object.entries(extractorMix)
      .map(([k, v]) => `${k}:${v}`)
      .join("  ")}`,
  );
  console.log(`error violations   ${totalErrors}`);
  console.log(`warn violations    ${totalWarns}`);

  const report = {
    generatedFrom: rows.length + " corpus pages",
    aggregate: {
      pages: rows.length,
      latencyMs: { p50: pct(lat, 50), p95: pct(lat, 95), max: Math.max(...lat) },
      emptyOutputRate: emptyRate,
      extractorMix,
      errorViolations: totalErrors,
      warnViolations: totalWarns,
    },
    pages: rows,
  };
  writeFileSync("eval-report.json", JSON.stringify(report, null, 2));
  console.log("\nwrote eval-report.json");

  if (totalErrors > 0) {
    console.error(`\nFAIL: ${totalErrors} error-level invariant violation(s).`);
    process.exit(1);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
