import { z } from "zod";

const ArtifactDetails = z.object({
  key: z.string().describe("Relative path to the artifact from the session storage root"),
  size: z.number().describe("Size of the file in bytes"),
  createdAt: z.string().datetime().describe("Timestamp when the file was created"),
  modifiedAt: z.string().datetime().describe("Timestamp when the file was last modified"),
});

export type ArtifactDetails = z.infer<typeof ArtifactDetails>;

export const artifactsSchemas = {
  ArtifactDetails,
};

export default artifactsSchemas;
