import type { FastifyBaseLogger } from "fastify";
import type { CookieData, SessionData } from "../../context/types.js";
import type { PageStorage, PageStorageOutcome } from "../../../utils/context.js";

// Session end has 60s in total (managed-browser's endSession timeout) and still has
// to shut the browser down afterwards. Each source gets this long, all in parallel.
export const SESSION_DATA_TIMEOUT_MS = 20_000;

export type StepOutcome<T> =
  | { status: "ok"; value: T; ms: number }
  | { status: "failed"; error: string; ms: number }
  | { status: "timed_out"; ms: number };

export async function settleWithin<T>(
  work: () => Promise<T>,
  timeoutMs: number,
): Promise<StepOutcome<T>> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  let timer: NodeJS.Timeout | undefined;

  const attempt = (async () => work())().then(
    (value): StepOutcome<T> => ({ status: "ok", value, ms: elapsed() }),
    (err: unknown): StepOutcome<T> => ({
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      ms: elapsed(),
    }),
  );
  const deadline = new Promise<StepOutcome<T>>((resolve) => {
    timer = setTimeout(() => resolve({ status: "timed_out", ms: elapsed() }), timeoutMs);
  });

  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export type PageCounts = Record<PageStorageOutcome | "crashed", number>;

export interface PagesStorage {
  data: SessionData;
  pages: PageCounts;
}

export function emptyPageCounts(): PageCounts {
  return { ok: 0, gone: 0, failed: 0, timed_out: 0, crashed: 0 };
}

export function mergePageStorage(results: PageStorage[], crashed = 0): PagesStorage {
  const data: SessionData = { localStorage: {}, sessionStorage: {}, indexedDB: {} };
  const pages = { ...emptyPageCounts(), crashed };

  for (const { data: item, outcome } of results) {
    pages[outcome]++;

    for (const domain in item.localStorage) {
      data.localStorage![domain] = item.localStorage[domain];
    }
    for (const domain in item.sessionStorage) {
      data.sessionStorage![domain] = {
        ...(data.sessionStorage![domain] || {}),
        ...item.sessionStorage[domain],
      };
    }
    for (const domain in item.indexedDB) {
      data.indexedDB![domain] = [...(data.indexedDB![domain] || []), ...item.indexedDB[domain]];
    }
  }

  return { data, pages };
}

export interface SessionDataSources {
  cookies: () => Promise<CookieData[]>;
  disk: () => Promise<SessionData>;
  pages: () => Promise<PagesStorage>;
}

function summarize(name: string, outcome: StepOutcome<unknown>): string {
  if (outcome.status === "failed") return `${name}=failed(${outcome.ms}ms: ${outcome.error})`;
  return `${name}=${outcome.status}(${outcome.ms}ms)`;
}

function summarizePages(outcome: StepOutcome<PagesStorage>): string {
  if (outcome.status !== "ok") return summarize("pages", outcome);
  const counts = Object.entries(outcome.value.pages)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${key}=${count}`)
    .join(" ");
  return `pages=ok(${outcome.ms}ms${counts ? `; ${counts}` : ""})`;
}

function pagesComplete(outcome: StepOutcome<PagesStorage>): boolean {
  if (outcome.status !== "ok") return false;
  const { gone, failed, timed_out, crashed } = outcome.value.pages;
  return gone + failed + timed_out + crashed === 0;
}

// Live page storage wins over disk because Chrome writes localStorage to disk lazily.
export async function collectSessionData(
  sources: SessionDataSources,
  logger: FastifyBaseLogger,
  timeoutMs: number = SESSION_DATA_TIMEOUT_MS,
): Promise<SessionData> {
  const [cookies, disk, pages] = await Promise.all([
    settleWithin(sources.cookies, timeoutMs),
    settleWithin(sources.disk, timeoutMs),
    settleWithin(sources.pages, timeoutMs),
  ]);

  const fromDisk = disk.status === "ok" ? disk.value : {};
  const fromPages = pages.status === "ok" ? pages.value.data : {};

  const result: SessionData = {
    localStorage: { ...(fromDisk.localStorage || {}), ...(fromPages.localStorage || {}) },
    sessionStorage: { ...(fromDisk.sessionStorage || {}), ...(fromPages.sessionStorage || {}) },
    indexedDB: { ...(fromDisk.indexedDB || {}), ...(fromPages.indexedDB || {}) },
  };
  const liveOrigins = Object.keys(fromPages.localStorage ?? {});
  if (liveOrigins.length > 0) result.liveLocalStorageOrigins = liveOrigins;
  if (cookies.status === "ok") result.cookies = cookies.value;

  const steps = [
    summarize("cookies", cookies),
    summarize("disk", disk),
    summarizePages(pages),
  ].join(" ");

  if (cookies.status === "ok" && disk.status === "ok" && pagesComplete(pages)) {
    logger.info(`[CDPService] Session data dumped successfully: ${steps}`);
  } else {
    logger.warn(`[CDPService] Session data dumped partially: ${steps}`);
  }

  return result;
}
