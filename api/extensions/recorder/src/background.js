const API_URLS = ["localhost", "127.0.0.1", "0.0.0.0"].map(
  (host) => `http://${host}:${process.env.PORT}/v1/events`,
);
const MAX_QUEUED_BATCHES = 100;
const MAX_ATTEMPTS = 5;

const queue = [];
let apiUrl = API_URLS[0];
let draining = false;

async function send(body) {
  let failure;
  for (const url of [apiUrl, ...API_URLS.filter((candidate) => candidate !== apiUrl)]) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (error) {
      failure = error;
      continue;
    }
    apiUrl = url;
    if (!response.ok) throw new Error(`Saving events failed with status ${response.status}`);
    return;
  }
  throw failure;
}

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    const batch = queue.shift();
    try {
      await send(batch.body);
    } catch (error) {
      batch.attempts += 1;
      if (batch.attempts < MAX_ATTEMPTS) {
        queue.unshift(batch);
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** batch.attempts));
      } else {
        console.error("[Recorder] Dropped a batch of events:", error);
      }
    }
  }
  draining = false;
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "SAVE_EVENTS" || !Array.isArray(message.events)) return;
  if (message.events.length === 0) return;
  if (queue.length >= MAX_QUEUED_BATCHES) queue.shift();
  queue.push({
    body: JSON.stringify({ events: message.events, tabId: sender.tab?.id }),
    attempts: 0,
  });
  void drain();
});
