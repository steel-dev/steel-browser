import { createServer } from "node:http";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { FileQuotaExceededError, FileService } from "../../services/file.service.js";
import fileStoragePlugin from "../../plugins/file-storage.js";
import { FilesController } from "./files.controller.js";

function createReply() {
  const headers = new Map<string, unknown>();
  let statusCode = 200;
  const reply = {
    header(name: string, value: unknown) {
      headers.set(name, value);
      return reply;
    },
    code: (status: number) => {
      statusCode = status;
      return reply;
    },
    send: () => reply,
  };
  return { reply: reply as unknown as FastifyReply, headers, statusCode: () => statusCode };
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

    expect(statusCode()).toBe(413);
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
    const httpServer = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": "4" });
      res.end("tiny");
    });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    try {
      const address = httpServer.address();
      const port = typeof address === "object" && address ? address.port : 0;
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
          value: `http://127.0.0.1:${port}/tiny.bin`,
        }),
        reply,
      );

      expect(declaredSize).toBe(4);
      expect(statusCode()).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve())),
      );
    }
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

    expect(spy).toHaveBeenCalledWith({ maxSizeBytes: undefined });
    spy.mockRestore();
  });
});
