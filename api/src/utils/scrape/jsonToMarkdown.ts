export const isJsonContentType = (contentType: string): boolean => /[+/]json\b/i.test(contentType);

export const jsonToMarkdown = (raw: string): string => {
  let body = raw;
  try {
    body = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {}
  return "```json\n" + body + "\n```";
};
