import { FastifyRequest } from "fastify";
import { z } from "zod";

const UploadExtension = z.object({
  name: z
    .string()
    .regex(/^[a-zA-Z0-9-_]+$/, "Extension name must contain only letters, numbers, hyphens and underscores")
    .describe("Name of the extension"),
  contents: z.string().base64().describe("ZIP or CRX archive with extension files"),
});

const ImportExtension = z.object({
  name: z
    .string()
    .regex(/^[a-zA-Z0-9-_]+$/, "Extension name must contain only letters, numbers, hyphens and underscores")
    .optional()
    .describe("Name of the extension"),
  id: z.string().describe("ID of the extension in the Chrome Web Store"),
});

const ExtensionDetails = z.object({
  name: z.string().describe("Name of the extension"),
  default: z.boolean().describe("Whether the extension is bundled and cannot be deleted"),
  createdAt: z.string().datetime().describe("Timestamp when the extension was uploaded"),
});

const MultipleExtensions = z.array(ExtensionDetails);

const DeleteExtensionParams = z.object({
  name: z.string().describe("Name of the extension to delete"),
});

export type UploadExtensionBody = z.infer<typeof UploadExtension>;
export type UploadExtensionRequest = FastifyRequest<{ Body: UploadExtensionBody }>;
export type ImportExtensionBody = z.infer<typeof ImportExtension>;
export type ImportExtensionRequest = FastifyRequest<{ Body: ImportExtensionBody }>;
export type ExtensionDetails = z.infer<typeof ExtensionDetails>;
export type MultipleExtensions = z.infer<typeof MultipleExtensions>;
export type DeleteExtensionParams = z.infer<typeof DeleteExtensionParams>;
export type DeleteExtensionRequest = FastifyRequest<{ Params: DeleteExtensionParams }>;

export const extensionSchemas = {
  UploadExtension,
  ImportExtension,
  ExtensionDetails,
  MultipleExtensions,
  DeleteExtensionParams,
};

export default extensionSchemas;
