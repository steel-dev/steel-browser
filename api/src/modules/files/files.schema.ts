import { z } from "zod";

const FileUploadRequest = z.object({
  file: z.any().describe("The file to upload (binary) or URL string to download from"),
  path: z.string().optional().describe("Path to the file in the storage system"),
});

const FileDetails = z.object({
  path: z.string().describe("Path to the file in the storage system"),
  size: z.number().describe("Size of the file in bytes"),
  lastModified: z.string().datetime().describe("Timestamp when the file was last updated"),
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
