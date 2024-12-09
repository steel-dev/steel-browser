// Function to inject the script
function injectScript(tabId, changeInfo, tab) {
  // Only injected once the tab is completely loaded
  if (changeInfo.status === "complete" && tab.url) {
    chrome.tabs.executeScript(
      tabId,
      {
        file: "inject.js",
      },
      function () {
        if (chrome.runtime.lastError) {
          console.log("Script injection failed: ", chrome.runtime.lastError.message);
        }
      },
    );
  }
}

// Listen for any tab updates
chrome.tabs.onUpdated.addListener(injectScript);

const LOCAL_API_URL = "http://localhost:3000/v1/events";
const FALLBACK_API_URL = "http://0.0.0.0:3000/v1/events"; // Need to point to 0.0.0.0 in some deploys
let currentApiUrl = LOCAL_API_URL;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const sendEvents = () => {
    fetch(currentApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        sendResponse({ success: true });
      })
      .catch((error) => {
        if (currentApiUrl === LOCAL_API_URL) {
          // Retry with fallback URL
          currentApiUrl = FALLBACK_API_URL;
          sendEvents();
        }
      });
  };
  if (message.type === "SAVE_EVENTS") {
    console.log("[Recorder Background] Saving events to", currentApiUrl);
    sendEvents();

    sendResponse({ success: true });
    return true; // Required for async response
  }
});
