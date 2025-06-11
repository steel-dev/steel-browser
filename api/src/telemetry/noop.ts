import type { Span } from "@opentelemetry/api";

export const noopSpan: Span = {
  spanContext() {
    return {
      traceId: '',
      spanId: '',
      traceFlags: 0,
      isRemote: false,
    };
  },
  setAttribute() {
    return this;
  },
  setAttributes() {
    return this;
  },
  addEvent() {
    return this;
  },
  addLink() {
    return this;
  },
  addLinks() {
    return this;
  },
  setStatus() {
    return this;
  },
  updateName() {
    return this;
  },
  end() {},
  isRecording() {
    return false;
  },
  recordException() {},
};