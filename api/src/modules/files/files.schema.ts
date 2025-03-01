import { FastifyRequest } from "fastify";
import { z } from "zod";

const FileUploadRequest = z.object({
  content: z.string().describe("Base64-encoded file content"),
  fileName: z.string().optional().describe("Name of the file to be saved"),
  mimeType: z.string().optional().describe("MIME type of the file"),
});

const FileUploadResponse = z.object({
  id: z.string(),
  success: z.boolean(),
  fileSize: z.number(),
});

const FileDownloadResponse = z.object({
  content: z.string(),
  fileSize: z.number(),
});

const FileListResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      fileName: z.string(),
      fileSize: z.number(),
      mimeType: z.string().optional(),
      createdAt: z.string().datetime(),
    }),
  ),
  count: z.number(),
});

const FileDeleteResponse = z.object({
  success: z.boolean(),
});

export type FileUploadRequestBody = z.infer<typeof FileUploadRequest>;
export type FileUploadRequest = FastifyRequest<{ Body: FileUploadRequestBody }>;

export const filesSchemas = {
  FileUploadRequest,
  FileUploadResponse,
  FileDownloadResponse,
  FileListResponse,
  FileDeleteResponse,
};

export default filesSchemas;
