// Adapted from https://github.com/laurent22/joplin/blob/dev/packages/turndown-plugin-gfm/src/tables.js

import TurndownService from "@joplin/turndown";

export default function strikethrough(turndownService: TurndownService) {
  turndownService.addRule("strikethrough", {
    filter: ["del", "s", "strike"] as unknown as (keyof HTMLElementTagNameMap)[],
    replacement: function (content) {
      return "~~" + content + "~~";
    },
  });
}
