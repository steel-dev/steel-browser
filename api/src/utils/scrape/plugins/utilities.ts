// Adapted from https://github.com/laurent22/joplin/blob/dev/packages/turndown-plugin-gfm/src/tables.js

import css, { CssDeclarationAST, CssFontFaceAST } from "@adobe/css-tools";

export function isCodeBlockSpecialCase1(node: Node) {
  const parent = node.parentNode;
  if (!parent) return false;
  return (
    (parent as HTMLElement).classList &&
    (parent as HTMLElement).classList.contains("code") &&
    (parent as HTMLElement).nodeName === "TD" &&
    (node as HTMLElement).nodeName === "PRE"
  );
}

export function isCodeBlockSpecialCase2(node: Node) {
  if (node.nodeName !== "PRE") return false;

  const style = (node as HTMLElement).getAttribute("style");
  if (!style) return false;
  const o = css.parse("pre {" + style + "}");
  if (!o.stylesheet.rules.length) return;
  const fontFamily = (o.stylesheet.rules[0] as CssFontFaceAST).declarations.find(
    (d) => (d as CssDeclarationAST).property.toLowerCase() === "font-family",
  );
  if (!fontFamily || !(fontFamily as CssDeclarationAST).value) return false;
  const isMonospace =
    (fontFamily as CssDeclarationAST).value
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .indexOf("monospace") >= 0;
  return isMonospace;
}

export function isCodeBlock(node: Node) {
  if (isCodeBlockSpecialCase1(node) || isCodeBlockSpecialCase2(node)) return true;

  return (
    (node as HTMLElement).nodeName === "PRE" &&
    (node as HTMLElement).firstChild &&
    (node as HTMLElement).firstChild?.nodeName === "CODE"
  );
}
