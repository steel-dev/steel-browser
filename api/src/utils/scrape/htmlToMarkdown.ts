import { applyFixes } from "markdownlint";
import { lint } from "markdownlint/promise";
import Turndown from "turndown";
import highlightedCodeBlock from "./plugins/highlightedCodeBlock.js";
import inlineLink from "./plugins/inlineLink.js";
import strikethrough from "./plugins/strikethrough.js";
import tables from "./plugins/table.js";
import taskListItems from "./plugins/taskListItems.js";

const turndownService = new Turndown({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
  preformattedCode: false,
}).use([highlightedCodeBlock, strikethrough, taskListItems, inlineLink, tables]);

export const htmlToMarkdown = async (html: string): Promise<string> => {
  let markdown: string;

  markdown = turndownService.turndown(html).trim();
  markdown = newlinesToSpacesInLinks(markdown);
  markdown = await lintMarkdown(markdown);

  return markdown;
};

const lintMarkdown = async (md: string) => {
  const lintResult = await lint({
    strings: { md },
    config: {
      "no-trailing-punctuation": false,
    },
    resultVersion: 3,
  });
  const fixes = lintResult["md"].filter((error) => error.fixInfo);

  if (fixes.length > 0) {
    return applyFixes(md, fixes).trim();
  }

  return md.trim();
};

const newlinesToSpacesInLinks = (markdownContent: string) => {
  const linkRegex = /\[([\s\S]*?)\]\(([\s\S]*?)\)/g;

  return markdownContent.replace(linkRegex, (_match, linkText, linkUrl) => {
    const cleanedText = linkText.trim().replace(/\s+/g, " ");
    const cleanedUrl = linkUrl.trim().replace(/\s+/g, "");

    return `[${cleanedText}](${cleanedUrl})`;
  });
};
