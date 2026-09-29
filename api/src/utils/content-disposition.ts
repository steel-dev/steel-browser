/**
 * Builds an attachment Content-Disposition header value for a file name.
 *
 * The quoted `filename` parameter is an ASCII fallback. The `filename*` parameter carries the exact
 * name, percent-encoded as UTF-8 (RFC 6266 and RFC 5987), so clients that support it save the file
 * under its real name.
 */
export function attachmentContentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
