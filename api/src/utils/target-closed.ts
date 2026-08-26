/**
 * Puppeteer rejects in-flight CDP calls with TargetCloseError when a page or
 * context is torn down. Those rejections are expected during ephemeral-context
 * cleanup (proxied scrape / screenshot / pdf) and must not escape as
 * unhandledRejection.
 */
export function isTargetClosedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return typeof error === "string" && /target closed/i.test(error);
  }

  const name = "name" in error && typeof error.name === "string" ? error.name : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";

  return (
    name === "TargetCloseError" || /target closed/i.test(message) || /session closed/i.test(message)
  );
}
