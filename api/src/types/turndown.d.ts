declare module "@joplin/turndown" {
  export { default } from "turndown";
  export { Options } from "turndown";
  export { Node } from "turndown";
}

declare module "@joplin/turndown-plugin-gfm" {
  export const gfm: any;
  export const tables: any;
  export const strikethrough: any;
}
