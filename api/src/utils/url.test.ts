import { describe, expect, it } from "vitest";

import { buildDevtoolsFrontendUrl } from "./url.js";

const frontend = "http://localhost:9222/devtools/devtools_app.html";
const secureFrontend = "https://browser.example.com/devtools/devtools_app.html";
const pageId = "A1B2C3D4E5F6";

describe("buildDevtoolsFrontendUrl", () => {
  it("passes an insecure endpoint through the ws parameter", () => {
    const result = buildDevtoolsFrontendUrl(
      frontend,
      `ws://localhost:9222/devtools/page/${pageId}`,
    );

    expect(result).toBe(`${frontend}?ws=//localhost:9222/devtools/page/${pageId}`);
  });

  it("passes a secure endpoint through the wss parameter", () => {
    const result = buildDevtoolsFrontendUrl(
      secureFrontend,
      `wss://browser.example.com/devtools/page/${pageId}`,
    );

    expect(result).toBe(
      `${secureFrontend}?wss=//browser.example.com/devtools/page/${pageId}`,
    );
  });

  it("never leaves a scheme in the parameter value", () => {
    for (const endpoint of [
      "ws://localhost:9222/devtools/page/x",
      "wss://browser.example.com/devtools/page/x",
    ]) {
      const value = new URL(buildDevtoolsFrontendUrl(frontend, endpoint)).search;

      expect(value).not.toContain("ws://");
      expect(value).not.toContain("wss://");
    }
  });

  it("does not hand a secure endpoint to the insecure parameter", () => {
    // The frontend derives the scheme from the parameter name, so a wss endpoint
    // announced as `ws` would be dialled as ws:// and blocked as mixed content.
    const result = buildDevtoolsFrontendUrl(
      secureFrontend,
      `wss://browser.example.com/devtools/page/${pageId}`,
    );

    expect(result).not.toContain("?ws=");
    expect(result).toContain("?wss=");
  });

  it("preserves the page id and the rest of the path", () => {
    const result = buildDevtoolsFrontendUrl(
      frontend,
      `ws://127.0.0.1:9222/devtools/page/${pageId}`,
    );

    expect(result.endsWith(`/devtools/page/${pageId}`)).toBe(true);
  });

  it("keeps a non-default host and port intact", () => {
    const result = buildDevtoolsFrontendUrl(
      "https://cdp.example.com:8443/devtools/devtools_app.html",
      "wss://cdp.example.com:8443/devtools/page/deadbeef",
    );

    expect(result).toBe(
      "https://cdp.example.com:8443/devtools/devtools_app.html?wss=//cdp.example.com:8443/devtools/page/deadbeef",
    );
  });
});
