import { record } from "rrweb";
import { pack } from "@rrweb/packer";

const FLUSH_INTERVAL_MS = 250;
const MAX_BATCH_EVENTS = 200;
const MAX_BATCH_BYTES = 512 * 1024;

let batch = [];
let batchBytes = 0;
let timer;

function jsonBytes(text) {
  let bytes = 2;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20) bytes += 6;
    else if (code === 0x22 || code === 0x5c) bytes += 2;
    else if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else bytes += 3;
  }
  return bytes;
}

function flush() {
  clearTimeout(timer);
  timer = undefined;
  if (batch.length === 0) return;
  const events = batch;
  batch = [];
  batchBytes = 0;
  chrome.runtime.sendMessage({ type: "SAVE_EVENTS", events }).catch(() => {});
}

record({
  emit(event) {
    batch.push(event);
    batchBytes += jsonBytes(event);
    if (batch.length >= MAX_BATCH_EVENTS || batchBytes >= MAX_BATCH_BYTES) {
      flush();
    } else {
      timer ??= setTimeout(flush, FLUSH_INTERVAL_MS);
    }
  },
  packFn: pack,
  sampling: {
    media: 800,
  },
  inlineImages: true,
  collectFonts: true,
  recordCrossOriginIframes: true,
  recordCanvas: true,
});

addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flush();
});
