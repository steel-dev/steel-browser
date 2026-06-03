import { Defuddle } from "defuddle/node";
import type { DefuddleResponse } from "defuddle";

const MIN_EXTRACTED_WORDS = 50;

const BASE_OPTIONS = {
  debug: false,
  separateMarkdown: true,
  useAsync: false,
};

const isThin = (result: DefuddleResponse): boolean =>
  !(result.contentMarkdown ?? "").trim() ||
  (!result.extractorType && result.wordCount < MIN_EXTRACTED_WORDS);

const stripNonContentTags = (html: string): string =>
  html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, " ");

export const getDefuddleContent = async (
  htmlString: string,
  url?: string,
): Promise<DefuddleResponse> => {
  const primary = await Defuddle(htmlString, url, BASE_OPTIONS);
  if (!isThin(primary)) {
    return primary;
  }

  const fallback = await Defuddle(stripNonContentTags(htmlString), url, {
    ...BASE_OPTIONS,
    contentSelector: "body",
    removeExactSelectors: false,
    removePartialSelectors: false,
    removeLowScoring: false,
    removeContentPatterns: false,
  });
  if (fallback.wordCount <= primary.wordCount) {
    return primary;
  }

  return {
    ...primary,
    content: fallback.content,
    contentMarkdown: fallback.contentMarkdown,
    wordCount: fallback.wordCount,
  };
};
