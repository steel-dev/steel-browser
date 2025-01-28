import { record } from 'rrweb';

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
  sampling: {
    media: 800,
  },
  inlineImages: true,
  collectFonts: true,
  recordCrossOriginIframes: true,
  recordCanvas: true,
});
