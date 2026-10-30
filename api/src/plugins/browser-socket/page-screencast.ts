import { CDPSession, Page } from "puppeteer-core";
import WebSocket from "ws";

import { getPageFavicon, getPageTitle } from "../../utils/casting.js";

const MIN_ACK_INTERVAL_MS = 1000 / 30;
const SETTLE_DELAY_MS = 150;
const METADATA_REFRESH_MS = 1000;
const JPEG_QUALITY = 75;

export type CastFormat = "json" | "binary";

export interface ScreencastViewport {
  width: number;
  height: number;
  isMobile: boolean;
}

interface Frame {
  data: string;
  json?: string;
  binary?: Buffer;
}

interface Metadata {
  url: string;
  title: string;
  favicon: string | null;
}

interface Viewer {
  ws: WebSocket;
  format: CastFormat;
  page: Page;
  sending: boolean;
  pending: Frame | null;
  metadataKey: string | null;
}

const screencasts = new Map<string, PageScreencast>();

const metadataKey = ({ url, title, favicon }: Metadata) => `${url}\n${title}\n${favicon}`;

const screencastParams = ({ width, height }: ScreencastViewport) => ({
  format: "jpeg" as const,
  quality: JPEG_QUALITY,
  maxWidth: width,
  maxHeight: height,
});

class PageScreencast {
  private readonly viewers = new Set<Viewer>();
  private client: CDPSession | null = null;
  private owner: Viewer | null = null;
  private attaching: Promise<void> | null = null;
  private metadata: Metadata = { url: "", title: "", favicon: null };
  private metadataRefreshedAt = 0;
  private refreshingMetadata = false;
  private lastFrame: Frame | null = null;
  private nextAckAt = 0;
  private settleTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pageId: string,
    private readonly viewport: ScreencastViewport,
  ) {}

  async add(viewer: Viewer) {
    this.viewers.add(viewer);
    if (!this.client && !this.attaching) {
      await this.attach(viewer);
      return;
    }
    await this.attaching;
    if (this.lastFrame) this.deliver(viewer, this.lastFrame);
  }

  remove(viewer: Viewer) {
    if (!this.viewers.delete(viewer)) return;
    if (this.viewers.size === 0) {
      this.stop();
      if (screencasts.get(this.pageId) === this) screencasts.delete(this.pageId);
      return;
    }
    if (viewer !== this.owner) return;
    this.stop();
    const next = this.viewers.values().next().value;
    if (next) {
      this.attach(next).catch((err) => console.error("Error moving screencast:", err));
    }
  }

  private async attach(owner: Viewer) {
    this.owner = owner;
    const attaching = this.start(owner);
    this.attaching = attaching;
    try {
      await attaching;
    } finally {
      if (this.attaching === attaching) this.attaching = null;
    }
  }

  private async start(owner: Viewer) {
    const client = await owner.page.target().createCDPSession();
    if (this.owner !== owner) {
      client.detach().catch(() => {});
      return;
    }
    this.client = client;
    this.nextAckAt = 0;

    const { width, height, isMobile } = this.viewport;
    await client.send("Page.setDeviceMetricsOverride", {
      screenHeight: height,
      screenWidth: width,
      width,
      height,
      mobile: isMobile,
      screenOrientation: isMobile
        ? { angle: 0, type: "portraitPrimary" }
        : { angle: 90, type: "landscapePrimary" },
      deviceScaleFactor: isMobile ? 3 : 1,
    });

    client.on("Page.screencastFrame", ({ data, sessionId }) =>
      this.onFrame(client, data, sessionId),
    );
    await this.refreshMetadata();
    await client.send("Page.startScreencast", screencastParams(this.viewport));
  }

  private stop() {
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    const client = this.client;
    this.client = null;
    this.owner = null;
    if (!client) return;
    client.send("Page.stopScreencast").catch(() => {});
    client.detach().catch(() => {});
  }

  private onFrame(client: CDPSession, data: string, sessionId: number) {
    if (client !== this.client) return;
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    this.broadcast({ data });

    const now = Date.now();
    const ackAt = Math.max(now, this.nextAckAt);
    this.nextAckAt = ackAt + MIN_ACK_INTERVAL_MS;
    const ack = () => {
      if (client === this.client) {
        client.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      }
    };

    if (ackAt === now) {
      ack();
      return;
    }
    setTimeout(() => {
      ack();
      this.scheduleSettle(client);
    }, ackAt - now);
  }

  private scheduleSettle(client: CDPSession) {
    if (client !== this.client) return;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      void this.captureSettledFrame(client);
    }, SETTLE_DELAY_MS);
  }

  private async captureSettledFrame(client: CDPSession) {
    if (client !== this.client || this.viewers.size === 0) return;
    try {
      await client.send("Page.stopScreencast");
      if (client === this.client) {
        await client.send("Page.startScreencast", screencastParams(this.viewport));
      }
    } catch (err) {
      if (client === this.client) console.error("Error capturing settled frame:", err);
    }
  }

  private broadcast(frame: Frame) {
    this.lastFrame = frame;
    this.trackMetadata();
    for (const viewer of this.viewers) this.deliver(viewer, frame);
  }

  private deliver(viewer: Viewer, frame: Frame) {
    viewer.pending = frame;
    this.flush(viewer);
  }

  private flush(viewer: Viewer) {
    if (viewer.sending || !viewer.pending || viewer.ws.readyState !== WebSocket.OPEN) return;
    const frame = viewer.pending;
    viewer.pending = null;

    if (viewer.format === "binary") {
      this.sendMetadata(viewer);
      frame.binary ??= Buffer.from(frame.data, "base64");
      this.send(viewer, frame.binary);
      return;
    }

    frame.json ??= JSON.stringify({
      pageId: this.pageId,
      url: this.metadata.url,
      title: this.metadata.title,
      favicon: this.metadata.favicon,
      data: frame.data,
    });
    this.send(viewer, frame.json);
  }

  private send(viewer: Viewer, payload: string | Buffer) {
    viewer.sending = true;
    viewer.ws.send(payload, () => {
      viewer.sending = false;
      this.flush(viewer);
    });
  }

  private sendMetadata(viewer: Viewer) {
    const key = metadataKey(this.metadata);
    if (key === viewer.metadataKey || viewer.ws.readyState !== WebSocket.OPEN) return;
    viewer.metadataKey = key;
    viewer.ws.send(JSON.stringify({ type: "metadata", pageId: this.pageId, ...this.metadata }));
  }

  private trackMetadata() {
    const url = this.owner?.page.url();
    if (url !== undefined && url !== this.metadata.url) {
      this.metadata = { ...this.metadata, url };
      void this.refreshMetadata();
    } else if (Date.now() - this.metadataRefreshedAt > METADATA_REFRESH_MS) {
      void this.refreshMetadata();
    }
  }

  private async refreshMetadata() {
    const page = this.owner?.page;
    if (!page || this.refreshingMetadata) return;
    this.refreshingMetadata = true;
    try {
      const [title, favicon] = await Promise.all([getPageTitle(page), getPageFavicon(page)]);
      const next = { url: page.url(), title, favicon };
      const changed = metadataKey(next) !== metadataKey(this.metadata);
      this.metadata = next;
      this.metadataRefreshedAt = Date.now();
      if (changed) this.announceMetadata();
    } catch (err) {
      console.error("Error refreshing cast metadata:", err);
    } finally {
      this.refreshingMetadata = false;
    }
  }

  private announceMetadata() {
    const previous = this.lastFrame;
    const frame = previous ? { data: previous.data, binary: previous.binary } : null;
    if (frame) this.lastFrame = frame;
    for (const viewer of this.viewers) {
      if (viewer.format === "binary") this.sendMetadata(viewer);
      else if (frame && !viewer.pending) this.deliver(viewer, frame);
    }
  }
}

export async function subscribeToScreencast(
  pageId: string,
  viewport: ScreencastViewport,
  ws: WebSocket,
  format: CastFormat,
  page: Page,
): Promise<() => void> {
  let screencast = screencasts.get(pageId);
  if (!screencast) {
    screencast = new PageScreencast(pageId, viewport);
    screencasts.set(pageId, screencast);
  }
  const current = screencast;
  const viewer: Viewer = { ws, format, page, sending: false, pending: null, metadataKey: null };
  try {
    await current.add(viewer);
  } catch (err) {
    current.remove(viewer);
    throw err;
  }
  return () => current.remove(viewer);
}
