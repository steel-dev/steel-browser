import { Writable } from "node:stream";

interface Options {
  getLogSinkUrl: () => string | undefined;
  baseLogger: { error: (objOrMsg: any, msg?: string) => void };
}

export function createBrowserLogTransport(opts: Options): Writable {
  const { getLogSinkUrl, baseLogger } = opts;

  return new Writable({
    objectMode: true,
    async write(chunk, _enc, cb) {
      try {
        const record = typeof chunk === "string" ? JSON.parse(chunk) : chunk;

        const url = getLogSinkUrl();
        if (!url) return cb();

        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(record),
        });

        if (!res.ok) {
          baseLogger.error(
            `browser log failed: ${record?.type ?? "unknown"} ${res.statusText} (${url})`,
          );
        }
      } catch (err) {
        baseLogger.error({ err }, "browser log transport error");
      } finally {
        cb();
      }
    },
  });
}
