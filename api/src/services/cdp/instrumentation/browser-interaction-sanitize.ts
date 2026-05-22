import type { BrowserInteractionEvent } from "./types.js";

export const BROWSER_INTERACTION_SOURCE = "steel-browser-interaction";
export const MAX_BROWSER_INTERACTION_TEXT_LENGTH = 256;

const ALLOWED_ACTIONS = new Set([
  "click",
  "doubleClick",
  "keyPress",
  "input",
  "change",
  "submit",
  "scroll",
  "drag",
]);

export interface BrowserInteractionWirePayload {
  source?: unknown;
  timestamp?: unknown;
  interaction?: unknown;
}

export function truncateBrowserInteractionText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > MAX_BROWSER_INTERACTION_TEXT_LENGTH
    ? `${normalized.slice(0, MAX_BROWSER_INTERACTION_TEXT_LENGTH - 3)}...`
    : normalized;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return truncateBrowserInteractionText(value);
}

export function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function sanitizeTarget(value: unknown): BrowserInteractionEvent["interaction"]["target"] {
  const target = toRecord(value);
  if (!target) return undefined;

  const attributes = toRecord(target.attributes);
  const selector = toRecord(target.selector);
  const boundingBox = toRecord(target.boundingBox);

  const x = optionalNumber(boundingBox?.x);
  const y = optionalNumber(boundingBox?.y);
  const width = optionalNumber(boundingBox?.width);
  const height = optionalNumber(boundingBox?.height);

  return {
    tagName: optionalString(target.tagName),
    role: optionalString(target.role),
    accessibleName: optionalString(target.accessibleName),
    text: optionalString(target.text),
    attributes: attributes
      ? {
          id: optionalString(attributes.id),
          name: optionalString(attributes.name),
          type: optionalString(attributes.type),
          href: optionalString(attributes.href),
          ariaLabel: optionalString(attributes.ariaLabel),
          placeholder: optionalString(attributes.placeholder),
          title: optionalString(attributes.title),
          testId: optionalString(attributes.testId),
        }
      : undefined,
    selector: selector
      ? {
          css: optionalString(selector.css),
          id: optionalString(selector.id),
          testId: optionalString(selector.testId),
          name: optionalString(selector.name),
          aria: optionalString(selector.aria),
        }
      : undefined,
    boundingBox:
      x !== undefined && y !== undefined && width !== undefined && height !== undefined
        ? { x, y, width, height }
        : undefined,
  };
}

export function sanitizeInteractionPayload(
  payload: unknown,
): BrowserInteractionEvent["interaction"] | null {
  const parsed = toRecord(payload);
  const interaction = toRecord(parsed?.interaction);
  if (!interaction) return null;

  const action = interaction?.action;
  const eventType = interaction?.eventType;

  if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) return null;
  if (typeof eventType !== "string") return null;

  const pointer = toRecord(interaction.pointer);
  const keyboard = toRecord(interaction.keyboard);
  const value = toRecord(interaction.value);
  const page = toRecord(interaction.page);

  const x = optionalNumber(pointer?.x);
  const y = optionalNumber(pointer?.y);
  const startX = optionalNumber(pointer?.startX);
  const startY = optionalNumber(pointer?.startY);
  const endX = optionalNumber(pointer?.endX);
  const endY = optionalNumber(pointer?.endY);
  const hasDragPointer =
    startX !== undefined || startY !== undefined || endX !== undefined || endY !== undefined;

  return {
    action: action as BrowserInteractionEvent["interaction"]["action"],
    eventType,
    target: sanitizeTarget(interaction.target),
    endTarget: action === "drag" ? sanitizeTarget(interaction.endTarget) : undefined,
    endTimestamp:
      action === "drag" && typeof interaction.endTimestamp === "string"
        ? interaction.endTimestamp
        : undefined,
    pointer: hasDragPointer
      ? {
          startX,
          startY,
          endX,
          endY,
          button: optionalNumber(pointer?.button),
        }
      : x !== undefined && y !== undefined
      ? {
          x,
          y,
          button: optionalNumber(pointer?.button),
          clickCount: optionalNumber(pointer?.clickCount),
        }
      : undefined,
    keyboard: keyboard
      ? {
          key: optionalString(keyboard.key),
          code: optionalString(keyboard.code),
        }
      : undefined,
    value: value
      ? {
          inputType: optionalString(value.inputType),
          valueLength: optionalNumber(value.valueLength),
          text: optionalString(value.text),
          redacted: value.redacted === true ? true : undefined,
          checked: typeof value.checked === "boolean" ? value.checked : undefined,
        }
      : undefined,
    page: page
      ? {
          url: optionalString(page.url),
          title: optionalString(page.title),
        }
      : undefined,
  };
}
