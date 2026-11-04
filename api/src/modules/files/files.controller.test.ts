import { Readable } from "node:stream";
import * as fs from "fs";
import http from "node:http";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FileQuotaExceededError, FileService } from "../../services/file.service.js";
import fileStoragePlugin from "../../plugins/file-storage.js";
import { FilesController } from "./files.controller.js";

// Records every staged temp path and every unlinked path through a
// passthrough mock of "fs" (ESM namespaces are frozen, so vi.spyOn on
// fs.* throws). Real behavior is preserved; only the paths are recorded.
const { stagedPaths, unlinkedPaths } = vi.hoisted(() => ({
  stagedPaths: [] as string[],
  unlinkedPaths: [] as string[],
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    createWriteStream: (...args: unknown[]) => {
      stagedPaths.push(String(args[0]));
      return (actual.createWriteStream as (...a: unknown[]) => unknown)(...args);
    },
    promises: {
      ...actual.promises,
      unlink: (...args: never[]) => {
        unlinkedPaths.push(String(args[0]));
        return (actual.promises.unlink as (...a: never[]) => Promise<void>)(...args);
      },
    },
  };
});

function createReply() {
  const headers = new Map<string, unknown>();
  let statusCode = 200;
  let payload: unknown;
  const reply = {
    header(name: string, value: unknown) {
      headers.set(name, value);
      return reply;
    },
    code: (status: number) => {
      statusCode = status;
      return reply;
    },
    send: (body?: unknown) => {
      payload = body;
      return reply;
    },
  };
  return {
    reply: reply as unknown as FastifyReply,
    headers,
    statusCode: () => statusCode,
    body: () => payload,
  };
}

function createController(saveFileImpl?: FileService["saveFile"]) {
  const fileService = {
    saveFile:
      saveFileImpl ??
      (async () => ({
        path: "stub",
        size: 0,
        lastModified: new Date(0),
      })),
    downloadFile: async () => ({
      stream: Readable.from([]),
      size: 0,
      lastModified: new Date(0),
    }),
    getFile: async () => ({ size: 0, lastModified: new Date(0) }),
  } as unknown as FileService;
  return new FilesController(fileService);
}

const server = {} as FastifyInstance;

function requestFor(filePath: string) {
  return { params: { sessionId: "s", "*": filePath } } as unknown as FastifyRequest<{
    Params: { sessionId: string; "*": string };
  }>;
}

describe("FilesController download headers", () => {
  it("keeps spaces in the file name of a download", async () => {
    const { reply, headers } = createReply();

    await createController().handleFileDownload(server, requestFor("reports/my report.pdf"), reply);

    expect(headers.get("Content-Disposition")).toContain('filename="my report.pdf"');
    expect(headers.get("Content-Disposition")).not.toContain('%20"');
  });

  it("keeps spaces in the file name of a HEAD request", async () => {
    const { reply, headers } = createReply();

    await createController().handleFileHead(server, requestFor("my report.pdf"), reply);

    expect(headers.get("Content-Disposition")).toContain('filename="my report.pdf"');
  });

  it("sends the exact non-ASCII name in filename*", async () => {
    const { reply, headers } = createReply();

    await createController().handleFileDownload(server, requestFor("résumé.pdf"), reply);

    expect(headers.get("Content-Disposition")).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.pdf");
  });

  it("does not let a quote in the name end the quoted parameter", async () => {
    const { reply, headers } = createReply();

    await createController().handleFileDownload(server, requestFor('a"b.txt'), reply);

    expect(headers.get("Content-Disposition")).toContain('filename="a_b.txt"');
  });
});

function uploadRequest(part: Record<string, unknown>) {
  return {
    isMultipart: () => true,
    parts: async function* () {
      yield part;
    },
    params: { sessionId: "s" },
  } as unknown as FastifyRequest<{ Params: { sessionId: string } }>;
}

describe("FilesController quota enforcement", () => {
  beforeEach(() => {
    resetTempTracking();
  });

  it("maps FileQuotaExceededError to 413", async () => {
    const controller = createController(async ({ stream }) => {
      // Swallow the lazy-open error: the controller unlinks the temp file
      // after this stub throws, which can race the read stream's async open.
      stream.on("error", () => {});
      stream.destroy();
      throw new FileQuotaExceededError(80, 40, 100);
    });
    const { reply, statusCode } = createReply();

    await controller.handleFileUpload(
      server,
      uploadRequest({ fieldname: "file", type: "file", file: Readable.from("hello") }),
      reply,
    );
    const { created, unlinked } = trackedTemps();

    expect(statusCode()).toBe(413);
    // Quota 413 must still unlink the staged temp: exactly 1 staged, all
    // unlinked, none left on disk.
    expect(new Set(created).size).toBe(1);
    expect(new Set(unlinked)).toEqual(new Set(created));
    await expectNoTmpLeak(created);
  });

  it("passes the staged upload size to saveFile", async () => {
    let declaredSize: number | undefined;
    const controller = createController(async ({ stream, size }) => {
      stream.on("error", () => {});
      stream.destroy();
      declaredSize = size;
      return { path: "stub", size: 5, lastModified: new Date(0) };
    });
    const { reply, statusCode } = createReply();

    await controller.handleFileUpload(
      server,
      uploadRequest({ fieldname: "file", type: "file", file: Readable.from("hello") }),
      reply,
    );

    expect(declaredSize).toBe(5);
    expect(statusCode()).toBe(200);
  });

  it("passes the remote content-length to saveFile", async () => {
    // No real egress and no 127.0.0.1 server: 93.184.216.34 is a public
    // literal (skips DNS) and http.get is stubbed to answer 200 with
    // Content-Length 4. Mirrors the deleted happy-path assertions.
    const getSpy = vi.spyOn(http, "get").mockImplementation(((
      _url: unknown,
      _opts: unknown,
      cb: unknown,
    ) => {
      const res = Object.assign(Readable.from(["tiny"]), {
        statusCode: 200,
        headers: {
          "content-length": "4",
          "content-type": "application/octet-stream",
        },
      });
      (cb as (r: unknown) => void)(res);
      return { on: () => ({}), destroy: () => {} };
    }) as never);
    try {
      let declaredSize: number | undefined;
      const controller = createController(async ({ stream, size }) => {
        stream.on("error", () => {});
        stream.destroy();
        declaredSize = size;
        return { path: "stub", size: 4, lastModified: new Date(0) };
      });
      const { reply, statusCode } = createReply();

      await controller.handleFileUpload(
        server,
        uploadRequest({
          fieldname: "file",
          type: "field",
          value: "http://93.184.216.34/tiny.bin",
        }),
        reply,
      );

      expect(declaredSize).toBe(4);
      expect(statusCode()).toBe(200);
    } finally {
      getSpy.mockRestore();
    }
  });

  it("rejects loopback URLs instead of fetching them", async () => {
    // 127.0.0.1 is denied pre-connect, so no local server is needed. Port 1
    // is used so the refusal would be instant even without the blocklist.
    let saveCalls = 0;
    const controller = createController(async ({ stream }) => {
      saveCalls += 1;
      stream.on("error", () => {});
      stream.destroy();
      return { path: "stub", size: 0, lastModified: new Date(0) };
    });
    const { reply, statusCode } = createReply();

    await controller.handleFileUpload(
      server,
      uploadRequest({
        fieldname: "file",
        type: "field",
        value: "http://127.0.0.1:1/tiny.bin",
      }),
      reply,
    );

    expect(saveCalls).toBe(0);
    expect(statusCode()).toBe(400);
  });

  it("rejects private-range URLs without connecting", async () => {
    let saveCalls = 0;
    const controller = createController(async ({ stream }) => {
      saveCalls += 1;
      stream.on("error", () => {});
      stream.destroy();
      return { path: "stub", size: 0, lastModified: new Date(0) };
    });
    const { reply, statusCode } = createReply();

    await controller.handleFileUpload(
      server,
      uploadRequest({
        fieldname: "file",
        type: "field",
        value: "http://10.255.255.1/file.bin",
      }),
      reply,
    );

    expect(saveCalls).toBe(0);
    expect(statusCode()).toBe(400);
  });

  it("rejects localhost by name", async () => {
    let saveCalls = 0;
    const controller = createController(async ({ stream }) => {
      saveCalls += 1;
      stream.on("error", () => {});
      stream.destroy();
      return { path: "stub", size: 0, lastModified: new Date(0) };
    });
    const { reply, statusCode } = createReply();

    await controller.handleFileUpload(
      server,
      uploadRequest({
        fieldname: "file",
        type: "field",
        value: "http://localhost:8080/file.bin",
      }),
      reply,
    );

    expect(saveCalls).toBe(0);
    expect(statusCode()).toBe(400);
  });

  it("rejects non-http(s) schemes", async () => {
    let saveCalls = 0;
    const controller = createController(async ({ stream }) => {
      saveCalls += 1;
      stream.on("error", () => {});
      stream.destroy();
      return { path: "stub", size: 0, lastModified: new Date(0) };
    });
    const { reply, statusCode } = createReply();

    await controller.handleFileUpload(
      server,
      uploadRequest({
        fieldname: "file",
        type: "field",
        value: "file:///etc/passwd",
      }),
      reply,
    );

    expect(saveCalls).toBe(0);
    expect(statusCode()).toBe(400);
  });

  it("rejects IPv6 loopback without connecting", async () => {
    // ::1 is denied pre-connect by the blocklist, so this is instant and
    // deterministic with no server. Must stay 400, never 500.
    let saveCalls = 0;
    const controller = createController(async ({ stream }) => {
      saveCalls += 1;
      stream.on("error", () => {});
      stream.destroy();
      return { path: "stub", size: 0, lastModified: new Date(0) };
    });
    const { reply, statusCode, body } = createReply();

    await controller.handleFileUpload(
      server,
      uploadRequest({
        fieldname: "file",
        type: "field",
        value: "http://[::1]:1/nope.bin",
      }),
      reply,
    );

    expect(saveCalls).toBe(0);
    expect(statusCode()).toBe(400);
    expect(body()).toMatchObject({ success: false });
  });
});

function uploadRequestMulti(parts: Record<string, unknown>[]) {
  return {
    isMultipart: () => true,
    parts: async function* () {
      for (const p of parts) yield p;
    },
    params: { sessionId: "s" },
  } as unknown as FastifyRequest<{ Params: { sessionId: string } }>;
}

function filePart(data: string) {
  return { fieldname: "file", type: "file", file: Readable.from(data) };
}

function fieldPart(fieldname: string, value: string) {
  return { fieldname, type: "field", value };
}

function cappedServer(maxTotalBytes: number) {
  return {
    steelBrowserConfig: { fileStorage: { maxTotalBytes } },
  } as unknown as FastifyInstance;
}

// Runs an upload with fresh temp-path recording. Real fs behavior is
// preserved (passthrough mock above), so afterwards every recorded staged
// path must be gone from disk when cleanup worked.
function resetTempTracking() {
  stagedPaths.length = 0;
  unlinkedPaths.length = 0;
}

function trackedTemps() {
  return { created: [...stagedPaths], unlinked: [...unlinkedPaths] };
}

async function expectNoTmpLeak(paths: string[]) {
  expect(paths.length).toBeGreaterThan(0);
  for (const p of paths) {
    await expect(fs.promises.stat(p)).rejects.toMatchObject({ code: "ENOENT" });
  }
}

describe("FilesController multipart temp hardening", () => {
  beforeEach(() => {
    resetTempTracking();
  });

  it("unlinks every staged temp on multi-file success (last part wins)", async () => {
    let saveCalls = 0;
    let declaredSize: number | undefined;
    const controller = createController(async ({ stream, size }) => {
      saveCalls += 1;
      stream.on("error", () => {});
      stream.destroy();
      declaredSize = size;
      return { path: "stub", size: size ?? 0, lastModified: new Date(0) };
    });
    const { reply, statusCode } = createReply();

    await controller.handleFileUpload(
      server,
      uploadRequestMulti([filePart("a"), filePart("bb"), filePart("ccc")]),
      reply,
    );
    const { created, unlinked } = trackedTemps();

    expect(statusCode()).toBe(200);
    expect(saveCalls).toBe(1);
    expect(declaredSize).toBe(3);
    // All three staged temps tracked, all unlinked, none left on disk.
    expect(new Set(created).size).toBe(3);
    expect(new Set(unlinked)).toEqual(new Set(created));
    await expectNoTmpLeak(created);
  });

  it("rejects file parts beyond the per-request cap with 413 and cleans up", async () => {
    let saveCalls = 0;
    const controller = createController(async ({ stream }) => {
      saveCalls += 1;
      stream.on("error", () => {});
      stream.destroy();
      return { path: "stub", size: 0, lastModified: new Date(0) };
    });
    const { reply, statusCode } = createReply();
    // Literal pin of the documented contract: at most 5 file parts per request.
    expect(FilesController.MAX_FILE_PARTS_PER_REQUEST).toBe(5);
    const over = FilesController.MAX_FILE_PARTS_PER_REQUEST + 1;
    const parts = Array.from({ length: over }, (_, i) => filePart(`f${i}`));

    await controller.handleFileUpload(server, uploadRequestMulti(parts), reply);
    const { created, unlinked } = trackedTemps();

    expect(statusCode()).toBe(413);
    expect(saveCalls).toBe(0);
    // Exactly MAX parts staged, all cleaned up, excess part never staged.
    expect(new Set(created).size).toBe(FilesController.MAX_FILE_PARTS_PER_REQUEST);
    expect(new Set(unlinked)).toEqual(new Set(created));
    await expectNoTmpLeak(created);
  });

  it("rejects accumulated staged bytes over the per-request cap with 413", async () => {
    let saveCalls = 0;
    const controller = createController(async ({ stream }) => {
      saveCalls += 1;
      stream.on("error", () => {});
      stream.destroy();
      return { path: "stub", size: 0, lastModified: new Date(0) };
    });
    const { reply, statusCode } = createReply();

    // Cap 4 bytes: "ab" (2) fits, "cde" (3) pushes the total to 5 > 4.
    await controller.handleFileUpload(
      cappedServer(4),
      uploadRequestMulti([filePart("ab"), filePart("cde")]),
      reply,
    );
    const { created, unlinked } = trackedTemps();

    expect(statusCode()).toBe(413);
    expect(saveCalls).toBe(0);
    expect(new Set(created).size).toBe(2);
    expect(new Set(unlinked)).toEqual(new Set(created));
    await expectNoTmpLeak(created);
  });

  it("unlinks all staged temps on invalid-path 400 with multiple files", async () => {
    let saveCalls = 0;
    const controller = createController(async ({ stream }) => {
      saveCalls += 1;
      stream.on("error", () => {});
      stream.destroy();
      return { path: "stub", size: 0, lastModified: new Date(0) };
    });
    const { reply, statusCode, body } = createReply();

    await controller.handleFileUpload(
      server,
      uploadRequestMulti([filePart("one"), filePart("two"), fieldPart("path", "../evil")]),
      reply,
    );
    const { created, unlinked } = trackedTemps();

    expect(statusCode()).toBe(400);
    expect(body()).toMatchObject({ success: false });
    expect(saveCalls).toBe(0);
    expect(new Set(created).size).toBe(2);
    expect(new Set(unlinked)).toEqual(new Set(created));
    await expectNoTmpLeak(created);
  });

  it("maps multipart limit errors with statusCode 413 to 413 and cleans up", async () => {
    let saveCalls = 0;
    const controller = createController(async ({ stream }) => {
      saveCalls += 1;
      stream.on("error", () => {});
      stream.destroy();
      return { path: "stub", size: 0, lastModified: new Date(0) };
    });
    const { reply, statusCode } = createReply();
    const limitError = Object.assign(new Error("request file too large"), { statusCode: 413 });

    await controller.handleFileUpload(
      server,
      {
        isMultipart: () => true,
        parts: async function* () {
          yield filePart("boom");
          throw limitError;
        },
        params: { sessionId: "s" },
      } as unknown as FastifyRequest<{ Params: { sessionId: string } }>,
      reply,
    );
    const { created, unlinked } = trackedTemps();

    expect(statusCode()).toBe(413);
    expect(saveCalls).toBe(0);
    expect(new Set(created).size).toBe(1);
    expect(new Set(unlinked)).toEqual(new Set(created));
    await expectNoTmpLeak(created);
  });
});

describe("fileStoragePlugin registration", () => {
  it("registers without options (unbounded quota)", async () => {
    // Never construct a real FileService here: its production defaults point
    // at /files, which is not writable on CI. Assert the wiring instead.
    const spy = vi.spyOn(FileService, "getInstance").mockReturnValue({} as FileService);
    const fastify = {
      log: { info: () => {} },
      decorate: (_key: string, _value: unknown) => {},
    };
    await fileStoragePlugin(fastify as unknown as FastifyInstance, {});

    expect(spy).toHaveBeenCalledWith({});
    spy.mockRestore();
  });

  it("forwards deprecated maxSizePerSession as maxSizeBytes", async () => {
    const spy = vi.spyOn(FileService, "getInstance").mockReturnValue({} as FileService);
    const fastify = {
      log: { info: () => {} },
      decorate: (_key: string, _value: unknown) => {},
    };
    await fileStoragePlugin(fastify as unknown as FastifyInstance, { maxSizePerSession: 77 });

    expect(spy).toHaveBeenCalledWith({ maxSizeBytes: 77 });
    spy.mockRestore();
  });

  it("prefers maxTotalBytes when both quota keys are set", async () => {
    const spy = vi.spyOn(FileService, "getInstance").mockReturnValue({} as FileService);
    const fastify = {
      log: { info: () => {} },
      decorate: (_key: string, _value: unknown) => {},
    };
    await fileStoragePlugin(fastify as unknown as FastifyInstance, {
      maxTotalBytes: 100,
      maxSizePerSession: 77,
    });

    expect(spy).toHaveBeenCalledWith({ maxSizeBytes: 100 });
    spy.mockRestore();
  });
});

function legacyServer(maxSizePerSession: number) {
  return {
    steelBrowserConfig: { fileStorage: { maxSizePerSession } },
  } as unknown as FastifyInstance;
}

describe("FilesController deprecated quota alias", () => {
  beforeEach(() => {
    resetTempTracking();
  });

  it("honors deprecated maxSizePerSession for staged-bytes cap", async () => {
    let saveCalls = 0;
    const controller = createController(async ({ stream }) => {
      saveCalls += 1;
      stream.on("error", () => {});
      stream.destroy();
      return { path: "stub", size: 0, lastModified: new Date(0) };
    });
    const { reply, statusCode } = createReply();

    // Cap 4 bytes via legacy key: "ab" (2) fits, "cde" (3) pushes total to 5 > 4.
    await controller.handleFileUpload(
      legacyServer(4),
      uploadRequestMulti([filePart("ab"), filePart("cde")]),
      reply,
    );
    const { created, unlinked } = trackedTemps();

    expect(statusCode()).toBe(413);
    expect(saveCalls).toBe(0);
    expect(new Set(created).size).toBe(2);
    expect(new Set(unlinked)).toEqual(new Set(created));
    await expectNoTmpLeak(created);
  });
});

describe("steelBrowserPlugin fileStorage normalization", () => {
  it("normalizes deprecated-only maxSizePerSession to maxTotalBytes", async () => {
    // steel-browser-plugin.ts delegates to this single source; importing the
    // plugin itself would pull browser/CDP deps unavailable in unit tests.
    const { normalizeSteelBrowserFileStorage } = await import("../../utils/file-quota.js");

    const config = normalizeSteelBrowserFileStorage({
      fileStorage: { maxSizePerSession: 77 } as {
        maxTotalBytes?: number;
        maxSizePerSession?: number;
      },
    });

    expect(config.fileStorage?.maxTotalBytes).toBe(77);
  });

  it("prefers maxTotalBytes when both quota keys are set", async () => {
    const { normalizeSteelBrowserFileStorage } = await import("../../utils/file-quota.js");

    const config = normalizeSteelBrowserFileStorage({
      fileStorage: { maxTotalBytes: 100, maxSizePerSession: 77 },
    });

    expect(config.fileStorage?.maxTotalBytes).toBe(100);
  });

  it("preserves exact shape when no quota is configured", async () => {
    const { normalizeSteelBrowserFileStorage } = await import("../../utils/file-quota.js");

    const input: Record<string, unknown> = {};
    const config = normalizeSteelBrowserFileStorage(input) as Record<string, unknown>;

    expect(config).toBe(input);
    expect("fileStorage" in config).toBe(false);
  });
});

describe("filesRoutes deprecated quota alias", () => {
  it("honors deprecated maxSizePerSession for multipart fileSize limit", async () => {
    const spy = vi.spyOn(FileService, "getInstance").mockReturnValue({} as FileService);
    try {
      let capturedFileSize: unknown;
      const mockServer = {
        steelBrowserConfig: { fileStorage: { maxSizePerSession: 12345 } },
        register: async (_plugin: unknown, opts?: { limits?: { fileSize?: unknown } }) => {
          if (capturedFileSize === undefined && opts?.limits?.fileSize !== undefined) {
            capturedFileSize = opts.limits.fileSize;
          }
        },
        post: () => {},
        head: () => {},
        get: () => {},
        delete: () => {},
      };
      const { default: routes } = await import("./files.routes.js");
      await routes(mockServer as unknown as FastifyInstance);

      expect(capturedFileSize).toBe(12345);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("resolveMaxTotalBytes validation", () => {
  it("returns undefined when neither key is set", async () => {
    const { resolveMaxTotalBytes } = await import("../../utils/file-quota.js");

    expect(resolveMaxTotalBytes(undefined)).toBeUndefined();
    expect(resolveMaxTotalBytes({})).toBeUndefined();
  });

  it("keeps 0 as a valid quota", async () => {
    const { resolveMaxTotalBytes } = await import("../../utils/file-quota.js");

    expect(resolveMaxTotalBytes({ maxTotalBytes: 0 })).toBe(0);
    expect(resolveMaxTotalBytes({ maxSizePerSession: 0 })).toBe(0);
  });

  it("throws RangeError on NaN, Infinity, and negative quotas", async () => {
    const { resolveMaxTotalBytes } = await import("../../utils/file-quota.js");

    expect(() => resolveMaxTotalBytes({ maxTotalBytes: NaN })).toThrow(RangeError);
    expect(() => resolveMaxTotalBytes({ maxTotalBytes: Infinity })).toThrow(RangeError);
    expect(() => resolveMaxTotalBytes({ maxTotalBytes: -1 })).toThrow(RangeError);
    expect(() => resolveMaxTotalBytes({ maxSizePerSession: NaN })).toThrow(RangeError);
    expect(() => resolveMaxTotalBytes({ maxSizePerSession: -5 })).toThrow(RangeError);
  });
});

describe("steelBrowserPlugin fileStorage wiring", () => {
  it("decorates normalized config and registers fileStoragePlugin from it (single resolve)", async () => {
    // Does not import steel-browser-plugin.ts itself: that module pulls
    // browser/CDP/puppeteer deps unavailable in unit tests. Instead replay
    // its exact two-line wiring (normalize once, derive register opts from
    // the decorated config) and assert end-to-end forwarding.
    const { normalizeSteelBrowserFileStorage } = await import("../../utils/file-quota.js");

    const spy = vi.spyOn(FileService, "getInstance").mockReturnValue({} as FileService);
    try {
      const decorated: unknown[] = [];
      const mockFastify = {
        log: { info: () => {} },
        decorate: (key: string, value: unknown) => {
          decorated.push(value);
        },
      };

      // Deprecated-only input: normalize maps to maxTotalBytes.
      const cfg = normalizeSteelBrowserFileStorage({
        fileStorage: { maxSizePerSession: 77 } as {
          maxTotalBytes?: number;
          maxSizePerSession?: number;
        },
      });
      (mockFastify as { decorate: (k: string, v: unknown) => void }).decorate(
        "steelBrowserConfig",
        cfg,
      );
      await fileStoragePlugin(mockFastify as unknown as FastifyInstance, {
        maxTotalBytes: cfg.fileStorage?.maxTotalBytes,
      });

      expect(
        (decorated[0] as { fileStorage?: { maxTotalBytes?: number } }).fileStorage?.maxTotalBytes,
      ).toBe(77);
      expect(spy).toHaveBeenCalledWith({ maxSizeBytes: 77 });
    } finally {
      spy.mockRestore();
    }
  });

  it("wiring preserves precedence and unbounded shape", async () => {
    const { normalizeSteelBrowserFileStorage } = await import("../../utils/file-quota.js");

    const spy = vi.spyOn(FileService, "getInstance").mockReturnValue({} as FileService);
    try {
      const mockFastify = {
        log: { info: () => {} },
        decorate: (_key: string, _value: unknown) => {},
      };

      const both = normalizeSteelBrowserFileStorage({
        fileStorage: { maxTotalBytes: 100, maxSizePerSession: 77 },
      });
      await fileStoragePlugin(mockFastify as unknown as FastifyInstance, {
        maxTotalBytes: both.fileStorage?.maxTotalBytes,
      });
      expect(spy).toHaveBeenCalledWith({ maxSizeBytes: 100 });

      spy.mockClear();
      const empty = normalizeSteelBrowserFileStorage(
        {} as { fileStorage?: { maxTotalBytes?: number; maxSizePerSession?: number } },
      );
      await fileStoragePlugin(mockFastify as unknown as FastifyInstance, {
        maxTotalBytes: empty.fileStorage?.maxTotalBytes,
      });
      // Stale-{} guard: unbounded stays {} so a bare call never clobbers quota.
      expect(spy).toHaveBeenCalledWith({});
    } finally {
      spy.mockRestore();
    }
  });
});
