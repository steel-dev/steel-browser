import type { Protocol } from "puppeteer-core";

export type DialogType = Protocol.Page.DialogType;

export function dialogHint(tab?: string): string {
  const closing = tab ? `tab ${tab}` : "its tab";
  return `Close it in the live view, or open a new tab and close ${closing}.`;
}

export interface Dialog {
  id: string;
  tab: string;
  type: DialogType;
  message: string;
  defaultPrompt?: string;
  open: boolean;
}

export function openDialog(
  id: string,
  tab: string,
  event: Protocol.Page.JavascriptDialogOpeningEvent,
): Dialog {
  return {
    id,
    tab,
    type: event.type,
    message: event.message,
    defaultPrompt: event.defaultPrompt || undefined,
    open: true,
  };
}

export function describeDialog(dialog: Dialog) {
  return {
    id: dialog.id,
    tab: dialog.tab,
    type: dialog.type,
    message: dialog.message,
    ...(dialog.defaultPrompt ? { defaultPrompt: dialog.defaultPrompt } : {}),
  };
}
