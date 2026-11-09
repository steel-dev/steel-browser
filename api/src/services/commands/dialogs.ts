import type { Protocol } from "puppeteer-core";

export type DialogType = Protocol.Page.DialogType;

export const DIALOG_HINT = "Close it in the live view, or close its tab.";

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
