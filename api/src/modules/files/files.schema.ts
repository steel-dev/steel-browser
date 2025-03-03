import { z } from "zod";

// For schema generation
const FileUploadRequest = z.object({
  file: z.any().optional().describe("The file to upload (binary)"),
  fileUrl: z.string().optional().describe("Public URL to download file from"),
  name: z.string().optional().describe("Filename to use in session"),
  metadata: z.record(z.any()).optional().describe("Custom metadata to associate with the file"),
});

const FileUploadResponse = z.object({
  id: z.string().describe("Unique identifier for the file"),
  success: z.boolean().describe("Indicates if the file upload was successful"),
  fileSize: z.number().describe("Size of the uploaded file in bytes"),
  metadata: z.record(z.any()).optional().describe("Custom metadata associated with the file"),
});

const FileListResponse = z.object({
  files: z.array(
    z.object({
      id: z.string().describe("Unique identifier for the file"),
      fileName: z.string().describe("Name of the file"),
      fileSize: z.number().describe("Size of the file in bytes"),
      mimeType: z.string().optional().describe("MIME type of the file"),
      createdAt: z.string().datetime().describe("Timestamp when the file was created"),
      metadata: z.record(z.any()).optional().describe("Custom metadata associated with the file"),
    }),
  ),
  count: z.number().describe("Total number of files"),
});

const FileDeleteResponse = z.object({
  success: z.boolean().describe("Indicates if the file deletion was successful"),
});

export const filesSchemas = {
  FileUploadRequest,
  FileUploadResponse,
  FileListResponse,
  FileDeleteResponse,
};

export default filesSchemas;
