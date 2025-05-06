import { z } from "zod";

// For schema generation
const FileUploadRequest = z.object({
  file: z.any().optional().describe("The file to upload (binary)"),
  fileUrl: z.string().url().optional().describe("Public URL to download file from"),
  // metadata: z.record(z.any()).optional().describe("Custom metadata to associate with the file"),
});

const FileDetails = z.object({
  path: z.string().describe("Path to the file in the storage system"),
  size: z.number().describe("Size of the file in bytes"),
  lastModified: z.string().datetime().describe("Timestamp when the file was last updated"),
  // metadata: z.record(z.any()).optional().describe("Custom metadata associated with the file"),
});

const MultipleFiles = z.object({
  data: z.array(FileDetails).describe("Array of files for the current page"),
});

export type FileDetails = z.infer<typeof FileDetails>;
export type MultipleFiles = z.infer<typeof MultipleFiles>;
export type FileUploadRequest = z.infer<typeof FileUploadRequest>;

export const filesSchemas = {
  FileUploadRequest,
  FileDetails,
  MultipleFiles,
};

export default filesSchemas;
