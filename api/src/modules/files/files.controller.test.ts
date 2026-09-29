import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import type { FileService } from "../../services/file.service.js";
import { FilesController } from "./files.controller.js";

function createReply() {
  const headers = new Map<string, unknown>();
  const reply = {
    header(name: string, value: unknown) {
      headers.set(name, value);
      return reply;
    },
    code: () => reply,
    send: () => reply,
  };
  return { reply: reply as unknown as FastifyReply, headers };
}

function createController() {
  const fileService = {
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
