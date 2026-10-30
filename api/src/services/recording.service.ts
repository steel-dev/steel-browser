export type RecordedBatch = {
  seq: number;
  tabId: number | null;
  events: unknown[];
};

export type RecordingPage = {
  batches: RecordedBatch[];
  next: number;
  truncated: boolean;
};

export class RecordingService {
  private sessionId: string | null = null;
  private batches: RecordedBatch[] = [];
  private bytes = 0;
  private seq = 0;
  private truncated = false;

  constructor(private readonly maxBytes: number) {}

  append(sessionId: string, events: unknown[], tabId: number | undefined, bytes: number) {
    if (sessionId !== this.sessionId) {
      this.sessionId = sessionId;
      this.batches = [];
      this.bytes = 0;
      this.truncated = false;
    }
    if (this.truncated) return;
    if (this.bytes + bytes > this.maxBytes) {
      this.truncated = true;
      return;
    }
    this.bytes += bytes;
    this.seq += 1;
    this.batches.push({ seq: this.seq, tabId: tabId ?? null, events });
  }

  read(sessionId: string, after: number): RecordingPage | null {
    if (sessionId !== this.sessionId) return null;
    const start = this.batches.findIndex((batch) => batch.seq > after);
    const batches = start === -1 ? [] : this.batches.slice(start);
    return {
      batches,
      next: batches.at(-1)?.seq ?? after,
      truncated: this.truncated,
    };
  }
}
