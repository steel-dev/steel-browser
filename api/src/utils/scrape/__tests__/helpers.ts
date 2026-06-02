import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export const loadGzHtml = (name: string): string =>
  gunzipSync(readFileSync(join(fixturesDir, name))).toString("utf-8");

export const loadRaw = (name: string): string => readFileSync(join(fixturesDir, name), "utf-8");

export const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

export const mangledLinkCount = (markdown: string): number =>
  (markdown.match(/\]\([^\s)]*"[^\s)]/g) || []).length;

export const relativeLinkCount = (markdown: string): number =>
  (markdown.match(/\]\(\/[^/]/g) || []).length;

export const base64ImageCount = (markdown: string): number =>
  (markdown.match(/!\[[^\]]*\]\(data:image\/[^)]*base64,/gi) || []).length;
