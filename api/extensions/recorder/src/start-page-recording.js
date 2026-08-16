import { record } from "rrweb";
import { pack } from "@rrweb/packer";
import { STEEL_RECORDER_SOURCE } from "./recorder-protocol.js";

export function startPageRecording(options = {}) {
  const targetWindow = options.win || window;
  if (targetWindow.__steelPageRecordingStarted) {
    return () => {};
  }
  Object.defineProperty(targetWindow, "__steelPageRecordingStarted", {
    value: true,
    configurable: true,
    enumerable: false,
  });

  const emit =
    options.emit ||
    ((event) => {
      targetWindow.postMessage(
        {
          source: STEEL_RECORDER_SOURCE,
          events: [event],
        },
        "*",
      );
    });

  const recordOptions = {
    emit,
    sampling: {
      media: 800,
    },
    inlineImages: true,
    collectFonts: true,
    recordCrossOriginIframes: true,
    recordCanvas: true,
  };

  if (options.packFn !== null) {
    recordOptions.packFn = options.packFn === undefined ? pack : options.packFn;
  }

  return record(recordOptions);
}
