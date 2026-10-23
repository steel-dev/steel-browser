import { CommandError } from "./errors.js";

const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

export function checkUrl(raw: string): string {
  const input = raw.trim();
  let url: URL;
  try {
    url = new URL(SCHEME.test(input) ? input : `https://${input}`);
  } catch {
    throw new CommandError("forbidden_url", `"${raw}" is not a valid URL.`, "invalid");
  }
  if (url.href === "about:blank") {
    return url.href;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CommandError(
      "forbidden_url",
      `Navigation to ${url.protocol} URLs is not allowed. Use an http or https URL.`,
      "protocol",
    );
  }
  return url.href;
}
