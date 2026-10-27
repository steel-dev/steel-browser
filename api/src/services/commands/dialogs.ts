import type { Protocol } from "puppeteer-core";

export type DialogType = Protocol.Page.DialogType;

export type DialogHandler = "command" | "client" | "closed";

export interface Dialog {
  id: string;
  tab: string;
  type: DialogType;
  message: string;
  defaultPrompt?: string;
  open: boolean;
  accepted?: boolean;
  text?: string;
  by?: DialogHandler;
  closed: Promise<void>;
  close: () => void;
}

export function openDialog(
  id: string,
  tab: string,
  event: Protocol.Page.JavascriptDialogOpeningEvent,
): Dialog {
  const { promise, resolve } = Promise.withResolvers<void>();
  return {
    id,
    tab,
    type: event.type,
    message: event.message,
    defaultPrompt: event.defaultPrompt || undefined,
    open: true,
    closed: promise,
    close: resolve,
  };
}

export function describeDialog(dialog: Dialog) {
  return {
    id: dialog.id,
    tab: dialog.tab,
    type: dialog.type,
    message: dialog.message,
    ...(dialog.defaultPrompt ? { defaultPrompt: dialog.defaultPrompt } : {}),
    ...(dialog.open
      ? {}
      : {
          accepted: dialog.accepted ?? false,
          ...(dialog.text ? { text: dialog.text } : {}),
          by: dialog.by ?? "client",
        }),
  };
}
