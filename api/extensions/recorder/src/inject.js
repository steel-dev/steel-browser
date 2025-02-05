import { record } from 'rrweb';
import { pack } from '@rrweb/packer';

record({
  emit: (event) => {
    chrome.runtime.sendMessage(
      {
        type: "SAVE_EVENTS",
        events: [event],
      },
      (response) => {
        if (!response.success) {
          console.error("[Recorder] Failed to save events:", response.error);
        }
      }
    );
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
