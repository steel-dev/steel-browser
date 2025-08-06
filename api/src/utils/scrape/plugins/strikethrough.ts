// Adapted from https://github.com/laurent22/joplin/blob/dev/packages/turndown-plugin-gfm/src/tables.js

import TurndownService from "@joplin/turndown";

export default function taskListItems(turndownService: TurndownService) {
  turndownService.addRule("taskListItems", {
    filter: function (node) {
      const parent = node.parentNode as HTMLElement;
      const grandparent = parent.parentNode as HTMLElement;
      return (
        (node as HTMLInputElement).type === "checkbox" &&
        (parent.nodeName === "LI" ||
          // Handles the case where the label contains the checkbox. For example,
          // <label><input ...> ...label text...</label>
          (parent.nodeName === "LABEL" && grandparent && grandparent.nodeName === "LI"))
      );
    },
    replacement: function (content, node) {
      return ((node as HTMLInputElement).checked ? "[x]" : "[ ]") + " ";
    },
  });
}
