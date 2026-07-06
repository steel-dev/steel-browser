export const stripBase64Images = (markdown: string): string =>
  markdown.replace(
    /(!\[[^\]]*\])\(data:image\/[^)]*?base64,[^)]*\)/gi,
    "$1(<Base64-Image-Removed>)",
  );
