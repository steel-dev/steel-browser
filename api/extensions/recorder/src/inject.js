import { STEEL_RECORDER_SOURCE } from "./recorder-protocol.js";

window.addEventListener("message", (event) => {
  if (event.source !== window) {
    return;
  }
  if (!event.data || event.data.source !== STEEL_RECORDER_SOURCE) {
    return;
  }

  const events = event.data.events;
  if (!Array.isArray(events) || events.length === 0) {
    return;
  }

  chrome.runtime.sendMessage(
    {
      type: "SAVE_EVENTS",
      events,
    },
    (response) => {
      if (!response?.success) {
        console.error("[Recorder] Failed to save events:", response?.error);
      }
    },
  );
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
