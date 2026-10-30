import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { subscribeToScreencast } from "./page-screencast.js";

const viewport = { width: 1280, height: 800, isMobile: false };

function fakePage(url = "https://example.com") {
  let onFrame: ((event: { data: string; sessionId: number }) => void) | null = null;
  const client = {
    on: vi.fn((event: string, handler: typeof onFrame) => {
      if (event === "Page.screencastFrame") onFrame = handler;
    }),
    send: vi.fn(async (_method: string, _params?: unknown) => undefined),
    detach: vi.fn(async () => undefined),
  };
  const page = {
    target: () => ({ createCDPSession: vi.fn(async () => client) }),
    url: () => url,
  };
  const emit = (data: string, sessionId = 1) => onFrame?.({ data, sessionId });
  const calls = (method: string) => client.send.mock.calls.filter(([m]) => m === method).length;
  return { page: page as any, client, emit, calls };
}

function fakeSocket() {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn((_payload: unknown, done?: () => void) => done?.()),
  } as any;
}

const payloads = (ws: any) => ws.send.mock.calls.map(([payload]: [unknown]) => payload);

describe("subscribeToScreencast", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shares one screencast between viewers of the same page", async () => {
    const { page, emit, calls } = fakePage();
    const first = fakeSocket();
    const second = fakeSocket();

    const leaveFirst = await subscribeToScreencast("shared", viewport, first, "json", page);
    const leaveSecond = await subscribeToScreencast("shared", viewport, second, "json", page);
    emit("AAAA");

    expect(calls("Page.startScreencast")).toBe(1);
    for (const ws of [first, second]) {
      expect(JSON.parse(payloads(ws).at(-1)).data).toBe("AAAA");
    }

    leaveSecond();
    leaveFirst();
    expect(calls("Page.stopScreencast")).toBe(1);
  });

  it("moves the screencast to a remaining viewer when its owner leaves", async () => {
    const owner = fakePage();
    const other = fakePage();
    const leaveOwner = await subscribeToScreencast(
      "moving",
      viewport,
      fakeSocket(),
      "json",
      owner.page,
    );
    const leaveOther = await subscribeToScreencast(
      "moving",
      viewport,
      fakeSocket(),
      "json",
      other.page,
    );

    leaveOwner();
    await vi.waitFor(() => expect(other.calls("Page.startScreencast")).toBe(1));

    expect(owner.calls("Page.stopScreencast")).toBe(1);
    leaveOther();
  });

  it("sends metadata and raw JPEG bytes to binary viewers", async () => {
    const { page, emit } = fakePage("https://steel.dev/");
    const ws = fakeSocket();
    const leave = await subscribeToScreencast("binary", viewport, ws, "binary", page);

    emit(Buffer.from("jpeg-bytes").toString("base64"));

    const [metadata, frame] = payloads(ws);
    expect(JSON.parse(metadata)).toMatchObject({ type: "metadata", url: "https://steel.dev/" });
    expect(Buffer.isBuffer(frame) && frame.toString()).toBe("jpeg-bytes");
    leave();
  });

  it("gives a late viewer the latest frame right away", async () => {
    const { page, emit } = fakePage();
    const leaveFirst = await subscribeToScreencast("late", viewport, fakeSocket(), "json", page);
    emit("BBBB");

    const late = fakeSocket();
    const leaveLate = await subscribeToScreencast("late", viewport, late, "json", page);

    expect(JSON.parse(payloads(late).at(-1)).data).toBe("BBBB");
    leaveLate();
    leaveFirst();
  });

  it("spaces acks at 30fps and restarts the screencast after a burst", async () => {
    vi.useFakeTimers();
    const { page, client, emit, calls } = fakePage();
    const ws = fakeSocket();
    const leave = await subscribeToScreencast("throttle", viewport, ws, "json", page);

    emit("AAAA", 1);
    emit("BBBB", 2);
    expect(calls("Page.screencastFrameAck")).toBe(1);

    await vi.advanceTimersByTimeAsync(40);
    expect(calls("Page.screencastFrameAck")).toBe(2);

    await vi.advanceTimersByTimeAsync(200);
    expect(calls("Page.stopScreencast")).toBe(1);
    expect(calls("Page.captureScreenshot")).toBe(0);
    const starts = client.send.mock.calls.filter(([method]) => method === "Page.startScreencast");
    expect(starts).toHaveLength(2);
    expect(starts[0]?.[1]).toMatchObject({ maxWidth: 1280, maxHeight: 800 });
    expect(starts[1]?.[1]).toEqual(starts[0]?.[1]);

    emit("CCCC", 3);
    expect(JSON.parse(payloads(ws).at(-1)).data).toBe("CCCC");
    leave();
  });
});
