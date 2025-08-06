// Adapted from https://github.com/laurent22/joplin/blob/dev/packages/turndown-plugin-gfm/src/tables.js

import TurndownService from "@joplin/turndown";

const highlightRegExp = /highlight-(?:text|source)-([a-z0-9]+)/;

export default function highlightedCodeBlock(turndownService: TurndownService) {
  turndownService.addRule("highlightedCodeBlock", {
    filter: function (node) {
      const firstChild = node.firstChild as HTMLElement;
      return (
        node.nodeName === "DIV" &&
        highlightRegExp.test(node.className) &&
        firstChild &&
        firstChild.nodeName === "PRE"
      );
    },
    replacement: function (content, node, options) {
      const className = (node as HTMLElement).className || "";
      const language = (className.match(highlightRegExp) || [null, ""])[1];

      return (
        "\n\n" +
        options.fence +
        language +
        "\n" +
        (node.firstChild as HTMLElement).textContent +
        "\n" +
        options.fence +
        "\n\n"
      );
    },
  });
}
