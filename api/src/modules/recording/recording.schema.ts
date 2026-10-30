import { z } from "zod";

const RecordingQuery = z.object({
  after: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(0)
    .describe("Only return batches recorded after this cursor"),
});

const RecordingResponse = z.object({
  batches: z.array(
    z.object({
      seq: z.number().int().describe("Position of the batch in the recording"),
      tabId: z.number().int().nullable().describe("Chrome tab the events came from"),
      events: z.array(z.any()).describe("rrweb events, packed with @rrweb/packer"),
    }),
  ),
  next: z.number().int().describe("Cursor to pass as `after` to get newer batches"),
  truncated: z
    .boolean()
    .describe("True when the recording reached its size limit and stopped keeping events"),
});

export type RecordingQuery = z.infer<typeof RecordingQuery>;
export type RecordingResponse = z.infer<typeof RecordingResponse>;

export const recordingSchemas = {
  RecordingQuery,
  RecordingResponse,
};

export default recordingSchemas;
