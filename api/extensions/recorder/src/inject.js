import { record } from "rrweb";
import { pack } from "@rrweb/packer";

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
      },
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

const enableWebRtcSites = ["meet.google.com", "zoom.us", "discord.com"];

try {
  const hostname = new URL(window.location.href).hostname;
  const shouldDisableWebRtc = !enableWebRtcSites.includes(hostname);

  if (shouldDisableWebRtc) {
    navigator.mediaDevices.getUserMedia =
      navigator.webkitGetUserMedia =
      navigator.mozGetUserMedia =
      navigator.getUserMedia =
      webkitRTCPeerConnection =
      RTCPeerConnection =
      MediaStreamTrack =
        undefined;

    Object.defineProperty(window, "RTCPeerConnection", {
      get: () => {
        return {};
      },
    });
    Object.defineProperty(window, "RTCDataChannel", {
      get: () => {
        return {};
      },
    });
  }
} catch (e) {
  console.error(`Error processing URL for WebRTC blocking: ${e}`);
}
