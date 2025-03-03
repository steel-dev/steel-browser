import { FastifyRequest } from "fastify";
import { z } from "zod";

const FileUploadRequest = z.object({
  content: z.string().describe("Base64-encoded file content"),
  fileName: z.string().optional().describe("Name of the file to be saved"),
  mimeType: z.string().optional().describe("MIME type of the file"),
});

const FileUploadResponse = z.object({
  id: z.string().describe("Unique identifier for the file"),
  success: z.boolean().describe("Indicates if the file upload was successful"),
  fileSize: z.number().describe("Size of the uploaded file in bytes"),
});

const FileDownloadResponse = z.object({
  content: z.string().describe("Base64-encoded file content"),
  fileSize: z.number().describe("Size of the downloaded file in bytes"),
});

const FileListResponse = z.object({
  files: z.array(
    z.object({
      id: z.string().describe("Unique identifier for the file"),
      fileName: z.string().describe("Name of the file"),
      fileSize: z.number().describe("Size of the file in bytes"),
      mimeType: z.string().optional().describe("MIME type of the file"),
      createdAt: z.string().datetime().describe("Timestamp when the file was created"),
    }),
  ),
  count: z.number().describe("Total number of files"),
});

const FileDeleteResponse = z.object({
  success: z.boolean().describe("Indicates if the file deletion was successful"),
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
