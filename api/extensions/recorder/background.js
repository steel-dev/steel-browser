const LOCAL_API_URL = "http://localhost:3000/v1/events";
const FALLBACK_API_URL = "http://0.0.0.0:3000/v1/events"; // Need to point to 0.0.0.0 in some deploys
let currentApiUrl = LOCAL_API_URL;

async function injectScript(tabId, changeInfo, tab) {
  if (changeInfo.status === "complete" && tab.url) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["inject.js"],
      });
    } catch (error) {
      console.error("Script injection failed:", error);
    }
  }
}

// Listen for tab updates
chrome.tabs.onUpdated.addListener(injectScript);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "SAVE_EVENTS") {
    return false;
  }

  console.log("[Recorder Background] Saving events to", currentApiUrl);

  const sendEvents = async (url) => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      sendResponse({ success: true });
    } catch (error) {
      if (url === LOCAL_API_URL) {
        // Retry with fallback URL
        currentApiUrl = FALLBACK_API_URL;
        return sendEvents(FALLBACK_API_URL);
      }
      sendResponse({ success: false, error: error.message });
    }
  };

  sendEvents(currentApiUrl);
  return true;
});
