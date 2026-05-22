import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BROWSER_INTERACTION_BINDING } from "./browser-interaction-events.js";
import { createBrowserInteractionScript } from "./browser-interaction-script.js";
import { BROWSER_INTERACTION_SOURCE } from "./browser-interaction-sanitize.js";

function createDom(html: string) {
  const dom = new JSDOM(html, {
    url: "https://example.com/form",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const binding = vi.fn();
  (dom.window as any)[BROWSER_INTERACTION_BINDING] = binding;
  dom.window.eval(createBrowserInteractionScript(BROWSER_INTERACTION_BINDING));
  return { dom, binding };
}

function payloads(binding: ReturnType<typeof vi.fn>) {
  return binding.mock.calls.map(([payload]) => JSON.parse(payload as string));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("browser interaction injected script", () => {
  it("emits click and doubleClick payloads through the binding", () => {
    const { dom, binding } = createDom(`<button id="save">Save</button>`);
    const button = dom.window.document.querySelector("button")!;

    button.dispatchEvent(
      new dom.window.MouseEvent("click", {
        bubbles: true,
        composed: true,
        clientX: 10,
        clientY: 20,
        detail: 1,
        button: 0,
      }),
    );
    button.dispatchEvent(
      new dom.window.MouseEvent("click", {
        bubbles: true,
        composed: true,
        clientX: 11,
        clientY: 21,
        detail: 2,
        button: 0,
      }),
    );

    expect(payloads(binding).map((payload) => payload.interaction.action)).toEqual([
      "click",
      "doubleClick",
    ]);
    expect(payloads(binding)[0]).toMatchObject({
      source: BROWSER_INTERACTION_SOURCE,
      interaction: {
        pointer: { x: 10, y: 20, button: 0, clickCount: 1 },
        target: {
          tagName: "button",
          role: "button",
          text: "Save",
        },
      },
    });
    dom.window.close();
  });

  it("omits input text by default while preserving length and redaction metadata", () => {
    const { dom, binding } = createDom(`
      <input id="email" name="email" />
      <input id="password" type="password" />
      <input id="otp" autocomplete="one-time-code" />
    `);
    const email = dom.window.document.querySelector<HTMLInputElement>("#email")!;
    const password = dom.window.document.querySelector<HTMLInputElement>("#password")!;
    const otp = dom.window.document.querySelector<HTMLInputElement>("#otp")!;

    email.value = "user@example.com";
    password.value = "super-secret";
    otp.value = "123456";

    email.dispatchEvent(new dom.window.Event("input", { bubbles: true, composed: true }));
    password.dispatchEvent(new dom.window.Event("input", { bubbles: true, composed: true }));
    otp.dispatchEvent(new dom.window.Event("input", { bubbles: true, composed: true }));

    const interactions = payloads(binding).map((payload) => payload.interaction);
    expect(interactions[0].value).toMatchObject({
      inputType: "text",
      valueLength: "user@example.com".length,
    });
    expect(interactions[0].value.text).toBeUndefined();
    expect(interactions[1].value).toMatchObject({
      inputType: "password",
      valueLength: "super-secret".length,
      redacted: true,
    });
    expect(interactions[1].value.text).toBeUndefined();
    expect(interactions[2].value).toMatchObject({
      inputType: "text",
      valueLength: "123456".length,
      redacted: true,
    });
    expect(interactions[2].value.text).toBeUndefined();
    dom.window.close();
  });

  it("redacts sensitive inputs identified by test attributes", () => {
    const { dom, binding } = createDom(`
      <input data-test="credit-card-number" />
      <input data-cy="password" />
    `);
    const creditCard = dom.window.document.querySelector<HTMLInputElement>("[data-test]")!;
    const password = dom.window.document.querySelector<HTMLInputElement>("[data-cy]")!;

    creditCard.value = "4111111111111111";
    password.value = "secret-from-data-cy";

    creditCard.dispatchEvent(new dom.window.Event("input", { bubbles: true, composed: true }));
    password.dispatchEvent(new dom.window.Event("input", { bubbles: true, composed: true }));

    const interactions = payloads(binding).map((payload) => payload.interaction);
    expect(interactions[0].value).toMatchObject({
      valueLength: "4111111111111111".length,
      redacted: true,
    });
    expect(interactions[0].value.text).toBeUndefined();
    expect(interactions[1].value).toMatchObject({
      valueLength: "secret-from-data-cy".length,
      redacted: true,
    });
    expect(interactions[1].value.text).toBeUndefined();
    dom.window.close();
  });

  it("uses the matched test attribute when building selectors", () => {
    const { dom, binding } = createDom(`<button data-cy="save">Save</button>`);
    const button = dom.window.document.querySelector("button")!;

    button.dispatchEvent(
      new dom.window.MouseEvent("click", {
        bubbles: true,
        composed: true,
        detail: 1,
      }),
    );

    const [payload] = payloads(binding);
    expect(payload.interaction.target.attributes.testId).toBe("save");
    expect(payload.interaction.target.selector.testId).toBe('[data-cy="save"]');
    expect(payload.interaction.target.selector.css).toContain('[data-cy="save"]');
    dom.window.close();
  });

  it("does not include direct text from editable targets", () => {
    const { dom, binding } = createDom(`<div contenteditable="true">typed private note</div>`);
    const editor = dom.window.document.querySelector("div")!;

    editor.dispatchEvent(
      new dom.window.MouseEvent("click", {
        bubbles: true,
        composed: true,
        detail: 1,
      }),
    );

    const [payload] = payloads(binding);
    expect(payload.interaction.target.tagName).toBe("div");
    expect(payload.interaction.target.text).toBeUndefined();
    expect(payload.interaction.target.accessibleName).toBeUndefined();
    dom.window.close();
  });

  it("records non-printable key presses but skips printable input typing", () => {
    const { dom, binding } = createDom(`<input id="query" />`);
    const input = dom.window.document.querySelector<HTMLInputElement>("#query")!;

    input.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        bubbles: true,
        composed: true,
        key: "a",
        code: "KeyA",
      }),
    );
    input.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        bubbles: true,
        composed: true,
        key: "Enter",
        code: "Enter",
      }),
    );

    const interactions = payloads(binding).map((payload) => payload.interaction);
    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({
      action: "keyPress",
      keyboard: { key: "Enter", code: "Enter" },
    });
    dom.window.close();
  });

  it("emits drag and suppresses the following click", () => {
    const { dom, binding } = createDom(`<button id="drag">Drag</button>`);
    const button = dom.window.document.querySelector("button")!;
    const now = vi.spyOn(dom.window.Date, "now");
    now.mockReturnValueOnce(1_000);
    now.mockReturnValueOnce(1_600);
    now.mockReturnValueOnce(1_601);

    button.dispatchEvent(
      new dom.window.MouseEvent("mousedown", {
        bubbles: true,
        composed: true,
        clientX: 0,
        clientY: 0,
        button: 0,
      }),
    );
    button.dispatchEvent(
      new dom.window.MouseEvent("mouseup", {
        bubbles: true,
        composed: true,
        clientX: 20,
        clientY: 0,
        button: 0,
      }),
    );
    button.dispatchEvent(
      new dom.window.MouseEvent("click", {
        bubbles: true,
        composed: true,
        clientX: 20,
        clientY: 0,
        detail: 1,
        button: 0,
      }),
    );

    const interactions = payloads(binding).map((payload) => payload.interaction);
    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({
      action: "drag",
      pointer: { startX: 0, startY: 0, endX: 20, endY: 0, button: 0 },
    });
    dom.window.close();
  });

  it("debounces scroll events", async () => {
    const { dom, binding } = createDom(`<main>content</main>`);
    Object.defineProperty(dom.window, "scrollX", { value: 12, configurable: true });
    Object.defineProperty(dom.window, "scrollY", { value: 34, configurable: true });

    dom.window.document.dispatchEvent(new dom.window.Event("scroll"));
    dom.window.document.dispatchEvent(new dom.window.Event("scroll"));
    expect(binding).not.toHaveBeenCalled();

    await new Promise((resolve) => dom.window.setTimeout(resolve, 250));

    const interactions = payloads(binding).map((payload) => payload.interaction);
    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({
      action: "scroll",
      pointer: { x: 12, y: 34 },
    });
    dom.window.close();
  });

  it("does not install duplicate listeners", () => {
    const { dom, binding } = createDom(`<button>Save</button>`);
    const button = dom.window.document.querySelector("button")!;
    dom.window.eval(createBrowserInteractionScript(BROWSER_INTERACTION_BINDING));

    button.dispatchEvent(
      new dom.window.MouseEvent("click", {
        bubbles: true,
        composed: true,
        detail: 1,
      }),
    );

    expect(payloads(binding)).toHaveLength(1);
    dom.window.close();
  });
});
