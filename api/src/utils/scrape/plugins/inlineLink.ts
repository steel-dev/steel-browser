// Adapted from https://github.com/laurent22/joplin/blob/dev/packages/turndown-plugin-gfm/src/tables.js

import TurndownService from "@joplin/turndown";

export default function inlineLink(turndownService: TurndownService) {
  turndownService.addRule("inlineLink", {
    filter: function (node, options) {
      return (
        options.linkStyle === "inlined" && node.nodeName === "A" && !!node.getAttribute("href")
      );
    },
    replacement: function (content, node) {
      const href = (node as HTMLElement).getAttribute("href")?.trim();
      const title = (node as HTMLElement).title ? ' "' + (node as HTMLElement).title + '"' : "";
      return "[" + content.trim() + "](" + href + title + ")\n";
    },
  });
}
