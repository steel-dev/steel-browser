export interface ItemSignature {
  backendNodeId: number;
  text: string;
}

export interface RefEntry {
  ref: string;
  tabId: string;
  frameId: string;
  sessionKey: string;
  loaderId: string | null;
  backendNodeId: number;
  role: string;
  name: string;
  axName: string | null;
  item: ItemSignature | null;
}

interface DocumentRefs {
  tabId: string;
  sessionKey: string;
  loaderId: string;
  refs: Map<number, string>;
}

export class RefTable {
  private readonly first: number;
  private retiredBelow: number;
  private readonly entries = new Map<string, RefEntry>();
  private readonly documents = new Map<string, DocumentRefs>();

  constructor(
    private readonly limit = 50_000,
    private readonly counters: { refs: number } = { refs: 1 },
  ) {
    this.first = counters.refs;
    this.retiredBelow = counters.refs;
  }

  observe(
    tabId: string,
    frameId: string,
    sessionKey: string,
    loaderId: string | null,
    isMainFrame: boolean,
  ) {
    const current = this.documents.get(frameId);
    if (current && current.sessionKey === sessionKey && current.loaderId === loaderId) {
      return;
    }
    if (isMainFrame) {
      for (const [id, document] of this.documents) {
        if (document.tabId === tabId) {
          this.documents.delete(id);
        }
      }
    }
    if (loaderId) {
      this.documents.set(frameId, { tabId, sessionKey, loaderId, refs: new Map() });
    } else {
      this.documents.delete(frameId);
    }
  }

  reserve(entry: Omit<RefEntry, "ref">): string {
    const document = this.documents.get(entry.frameId);
    const durable =
      document && document.sessionKey === entry.sessionKey && document.loaderId === entry.loaderId
        ? document
        : undefined;
    let ref = durable?.refs.get(entry.backendNodeId);
    if (!ref) {
      ref = `e${this.counters.refs++}`;
      durable?.refs.set(entry.backendNodeId, ref);
    }
    return ref;
  }

  commit(entries: RefEntry[]) {
    for (const entry of entries) {
      this.entries.delete(entry.ref);
      this.entries.set(entry.ref, entry);
    }
    this.evict(new Set(entries.map((entry) => entry.ref)));
  }

  get(ref: string): RefEntry | undefined {
    return this.entries.get(ref);
  }

  missing(ref: string): "browser_restarted" | "evicted" | "unknown" {
    const number = Number(ref.slice(1));
    if (!Number.isInteger(number) || number < this.first || number >= this.counters.refs) {
      return "unknown";
    }
    return number < this.retiredBelow ? "browser_restarted" : "evicted";
  }

  retire() {
    this.entries.clear();
    this.documents.clear();
    this.retiredBelow = this.counters.refs;
  }

  private evict(kept: Set<string>) {
    for (const [ref, entry] of this.entries) {
      if (this.entries.size <= this.limit) {
        return;
      }
      if (kept.has(ref)) {
        continue;
      }
      this.entries.delete(ref);
      const document = this.documents.get(entry.frameId);
      if (document?.refs.get(entry.backendNodeId) === ref) {
        document.refs.delete(entry.backendNodeId);
      }
    }
  }
}

export function parseRef(target: string): string | null {
  const match = target.trim().match(/^(?:@|ref=)?(e\d+)$/);
  return match ? match[1] : null;
}
