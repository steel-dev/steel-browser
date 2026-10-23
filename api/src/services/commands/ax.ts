import type { Protocol } from "puppeteer-core";

export type AXNode = Protocol.Accessibility.AXNode;

export const ITEM_NODE_LIMIT = 500;

const ZERO_WIDTH = /[﻿​‌‍⁠]/g;

export function axString(value: Protocol.Accessibility.AXValue | undefined): string {
  const raw = value?.value;
  if (typeof raw === "string") {
    return raw;
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw);
  }
  return "";
}

export function normalizeName(name: string): string {
  return name.replace(/ /g, " ").replace(ZERO_WIDTH, "");
}

export function lostText(before: string, after: string): boolean {
  const remaining = new Map<string, number>();
  for (const text of after ? after.split("\u0001") : []) {
    remaining.set(text, (remaining.get(text) ?? 0) + 1);
  }
  for (const text of before ? before.split("\u0001") : []) {
    const left = remaining.get(text) ?? 0;
    if (left === 0) {
      return true;
    }
    remaining.set(text, left - 1);
  }
  return false;
}

const VALUE_ROLES = new Set(["ColorWell", "Date", "DateTime", "InputTime", "slider", "spinbutton"]);

export function holdsValue(node: AXNode): boolean {
  return (
    VALUE_ROLES.has(axString(node.role)) ||
    (node.properties?.some((property) => property.name === "editable") ?? false)
  );
}

export function textSignature(nodes: AXNode[]): string {
  return nodes
    .filter((node) => !node.ignored && axString(node.role) === "StaticText")
    .map((node) => normalizeName(axString(node.name)))
    .sort()
    .join("\u0001");
}
