import { Readable } from "node:stream";
import * as fs from "fs";
import http from "node:http";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FileQuotaExceededError, FileService } from "../../services/file.service.js";
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

  it("keeps spaces in filename of HEAD request", async () => {
    const { reply, headers } = createReply();

    await createController().handleFileHead(server, requestFor("my report.pdf"), reply);

    expect(headers.get("Content-Disposition")).toContain('filename="my report.pdf"');
  });

  it("sends the exact non-ASCII name in filename*", async () => {
    const { reply, headers } = createReply();

    await createController().handleFileDownload(server, requestFor("résumé.pdf"), reply);

    expect(headers.get("Content-Disposition")).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.pdf");
  });

  it("replaces quotes in download filename", async () => {
    const { reply, headers } = createReply();

    await createController().handleFileDownload(server, requestFor('a"b.txt'), reply);

    expect(headers.get("Content-Disposition")).toContain('filename="a_b.txt"');
  });
});

function controllerWith(
  overrides: Partial<Record<"downloadFile" | "getFile" | "deleteFile", () => Promise<unknown>>>,
) {
  return new FilesController({
    downloadFile: async () => ({
      stream: Readable.from([]),
      size: 0,
      lastModified: new Date(0),
    }),
    getFile: async () => ({ size: 0, lastModified: new Date(0) }),
    deleteFile: async () => {},
    ...overrides,
  } as unknown as FileService);
}

function uploadRequest(part: Record<string, unknown>) {
  return {
    isMultipart: () => true,
    parts: async function* () {
      yield part;
    },
    params: { sessionId: "s" },
  } as unknown as FastifyRequest<{ Params: { sessionId: string } }>;
}

// Answers every http.get with a successful 200 so a missing blocklist guard
// turns the test red (200 + saveFile called) instead of accidentally green
// (connection refused also maps to 400). Each blocklist test asserts the mock
// was never consulted, proving the guard denied pre-connect.
function mockHttpGetSuccess() {
  return vi.spyOn(http, "get").mockImplementation(((_url: unknown, _opts: unknown, cb: unknown) => {
    const res = Object.assign(Readable.from(["tiny"]), {
      statusCode: 200,
      headers: {
        "content-length": "4",
        "content-type": "application/octet-stream",
      },
    });
    (cb as (r: unknown) => void)(res);
    return { on: () => ({}), destroy: () => ({}) };
  }) as never);
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
});

describe("FilesController URL SSRF blocklist", () => {
  it("rejects loopback URLs instead of fetching them", async () => {
    // 127.0.0.1 is denied pre-connect, so no local server is needed. http.get
    // answers 200 here, so a deleted guard would fetch and return 200: the
    // not-called assertion plus the distinct message prove the guard ran.
    const getSpy = mockHttpGetSuccess();
    try {
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
          value: "http://127.0.0.1:1/tiny.bin",
        }),
        reply,
      );

      expect(saveCalls).toBe(0);
      expect(statusCode()).toBe(400);
      expect(body()).toMatchObject({
        success: false,
        message: expect.stringContaining("not allowed"),
      });
      expect(getSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
    }
  });

  it("rejects private-range URLs without connecting", async () => {
    const getSpy = mockHttpGetSuccess();
    try {
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
          value: "http://10.255.255.1/file.bin",
        }),
        reply,
      );

      expect(saveCalls).toBe(0);
      expect(statusCode()).toBe(400);
      expect(body()).toMatchObject({
        success: false,
        message: expect.stringContaining("not allowed"),
      });
      expect(getSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
    }
  });

  it("rejects localhost by name", async () => {
    // localhost is denied by name before DNS/fetch. http.get answers 200, so
    // a deleted guard would fetch and return 200 instead of 400.
    const getSpy = mockHttpGetSuccess();
    try {
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
          value: "http://localhost:8080/file.bin",
        }),
        reply,
      );

      expect(saveCalls).toBe(0);
      expect(statusCode()).toBe(400);
      expect(body()).toMatchObject({
        success: false,
        message: expect.stringContaining("not allowed"),
      });
      expect(getSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
    }
  });

  it("rejects non-http(s) schemes", async () => {
    // The scheme check runs before any fetch. http.get answers 200, so a
    // deleted check would fetch and return 200 instead of 400.
    const getSpy = mockHttpGetSuccess();
    try {
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
          value: "file:///etc/passwd",
        }),
        reply,
      );

      expect(saveCalls).toBe(0);
      expect(statusCode()).toBe(400);
      expect(body()).toMatchObject({
        success: false,
        message: expect.stringContaining("Only http and https"),
      });
      expect(getSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
    }
  });

  it("rejects IPv6 loopback without connecting", async () => {
    // ::1 is denied pre-connect by the blocklist, so this is instant and
    // deterministic with no server. Must stay 400, never 500. http.get
    // answers 200, so a deleted guard would fetch and return 200.
    const getSpy = mockHttpGetSuccess();
    try {
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
      expect(body()).toMatchObject({
        success: false,
        message: expect.stringContaining("not allowed"),
      });
      expect(getSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
    }
  });

  it.each(["::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", "::ffff:127.0.0.1"])(
    "rejects hex IPv4-mapped loopback %s without connecting",
    async (addr) => {
      // Hex and dotted spellings of the same mapped host must get the same
      // verdict. http.get answers 200, so a regressed guard fetches (200).
      const getSpy = mockHttpGetSuccess();
      try {
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
            value: `http://[${addr}]/tiny.bin`,
          }),
          reply,
        );

        expect(saveCalls).toBe(0);
        expect(statusCode()).toBe(400);
        expect(body()).toMatchObject({
          success: false,
          message: expect.stringContaining("not allowed"),
        });
        expect(getSpy).not.toHaveBeenCalled();
      } finally {
        getSpy.mockRestore();
      }
    },
  );

  it("still fetches public IPv4-mapped addresses", async () => {
    // Guards against over-blocking: ::ffff:5db8:d822 is the public
    // 93.184.216.34, so the mapped-hex check must let it through.
    const getSpy = mockHttpGetSuccess();
    try {
      let saveCalls = 0;
      const controller = createController(async ({ stream }) => {
        saveCalls += 1;
        stream.on("error", () => {});
        stream.destroy();
        return { path: "stub", size: 4, lastModified: new Date(0) };
      });
      const { reply, statusCode } = createReply();

      await controller.handleFileUpload(
        server,
        uploadRequest({
          fieldname: "file",
          type: "field",
          value: "http://[::ffff:5db8:d822]/tiny.bin",
        }),
        reply,
      );

      expect(getSpy).toHaveBeenCalled();
      expect(saveCalls).toBe(1);
      expect(statusCode()).toBe(200);
    } finally {
      getSpy.mockRestore();
    }
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

  it("cleans up staged temps on multi-file success", async () => {
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

  it("rejects excess file parts with 413", async () => {
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

  it("commits last part without 413 when over quota", async () => {
    // Regression: only the last staged part is committed, so the transient
    // sum of staged bytes must never be compared against the cumulative
    // quota. Cap 4 bytes: "ab" (2) + "cde" (3) sums to 5 > 4, but each part
    // fits and only the last (3 bytes) reaches FileService.
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
      // cappedServer(4) is intentionally passed but must be ignored (no staged-sum check).
      cappedServer(4),
      uploadRequestMulti([filePart("ab"), filePart("cde")]),
      reply,
    );
    const { created, unlinked } = trackedTemps();

    expect(statusCode()).toBe(200);
    expect(saveCalls).toBe(1);
    expect(declaredSize).toBe(3);
    expect(new Set(created).size).toBe(2);
    expect(new Set(unlinked)).toEqual(new Set(created));
    await expectNoTmpLeak(created);
  });

  it("unlinks staged temps on invalid-path 400", async () => {
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

  it("maps multipart 413 errors to 413", async () => {
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
