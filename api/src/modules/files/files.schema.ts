import { z } from "zod";

// For schema generation
const FileUploadRequest = z.object({
  file: z.any().optional().describe("The file to upload (binary)"),
  fileId: z.string().uuid().optional().describe("Optional custom UUID for the file"),
  fileUrl: z.string().url().optional().describe("Public URL to download file from"),
  name: z.string().optional().describe("Filename to use in session"),
  metadata: z.record(z.any()).optional().describe("Custom metadata to associate with the file"),
});

const FileDetails = z.object({
  id: z.string().uuid().describe("Unique identifier for the file"),
  name: z.string().describe("Name of the file"),
  size: z.number().describe("Size of the file in bytes"),
  contentType: z.string().describe("MIME type of the file"),
  createdAt: z.string().datetime().describe("Timestamp when the file was created"),
  updatedAt: z.string().datetime().describe("Timestamp when the file was last updated"),
  checksum: z.string().describe("Checksum or hash of the file content for integrity verification"),
  metadata: z.record(z.any()).optional().describe("Custom metadata associated with the file"),
  path: z.string().describe("Path to the file in the storage system"),
});

const DeleteFile = FileDetails.merge(
  z.object({
    success: z.boolean().describe("Indicates if the file deletion was successful"),
  }),
);

const DeleteFiles = z.array(DeleteFile);

const MultipleFiles = z.object({
  data: z.array(FileDetails).describe("Array of files for the current page"),
});

export type FileDetails = z.infer<typeof FileDetails>;
export type MultipleFiles = z.infer<typeof MultipleFiles>;
export type FileUploadRequest = z.infer<typeof FileUploadRequest>;
export type DeleteFile = z.infer<typeof DeleteFile>;
export type DeleteFiles = z.infer<typeof DeleteFiles>;

export const filesSchemas = {
  FileUploadRequest,
  FileDetails,
  DeleteFile,
  DeleteFiles,
  MultipleFiles,
};

export default filesSchemas;
