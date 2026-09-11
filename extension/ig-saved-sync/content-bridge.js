const CHANNEL = "INSTA_POST_EXPLORER_SYNC_V2";
const ALLOWED_ORIGINS = new Set([
  "https://insta-explorer.hz.kalyros.dev",
  "https://preview-insta-explorer.hz.kalyros.dev",
  "http://localhost:3000",
]);

let pollTimer = null;
let pollFailures = 0;
const extensionInfo = {
  extensionId: chrome.runtime.id,
  version: chrome.runtime.getManifest().version,
};

window.addEventListener("message", (event) => {
  if (event.source !== window || !ALLOWED_ORIGINS.has(event.origin)) return;
  const message = event.data;
  if (!message || message.channel !== CHANNEL) return;
  if (message.type === "DISCOVER") {
    announceReady();
    return;
  }
  if (message.type !== "START") return;
  if (message.targetExtensionId !== extensionInfo.extensionId) return;
  if (typeof message.requestId !== "string" || typeof message.payload?.token !== "string") return;

  try {
    // The browser origin is authoritative; proxy-derived server URLs may be internal.
    const data = { ...message.payload, apiBaseUrl: window.location.origin };
    chrome.runtime.sendMessage({ type: "startWebSync", data }, (response) => {
      post("START_RESULT", message.requestId, withExtension(response ?? { ok: false, error: "EXTENSION_UNAVAILABLE" }));
      if (response?.ok) startPolling(message.requestId);
    });
  } catch {
    post("START_RESULT", message.requestId, withExtension({ ok: false, error: "EXTENSION_UNAVAILABLE" }));
  }
});

function startPolling(requestId) {
  if (pollTimer) clearInterval(pollTimer);
  pollFailures = 0;
  const poll = () => chrome.runtime.sendMessage({ type: "getWebSyncState" }, (response) => {
    if (chrome.runtime.lastError) {
      pollFailures += 1;
      if (pollFailures < 3) return;
      post("STATE", requestId, withExtension({ ok: false, error: "EXTENSION_UNAVAILABLE" }));
      clearInterval(pollTimer);
      pollTimer = null;
      return;
    }
    pollFailures = 0;
    post("STATE", requestId, withExtension(response));
    const status = response?.task?.status;
    if (["completed", "failed"].includes(status)) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });
  poll();
  pollTimer = setInterval(poll, 1500);
}

function post(type, requestId, payload) {
  window.postMessage({ channel: CHANNEL, type, requestId, payload }, window.location.origin);
}

function withExtension(payload) {
  return { ...(payload ?? {}), extensionId: extensionInfo.extensionId };
}

function announceReady() {
  window.postMessage({ channel: CHANNEL, type: "EXTENSION_READY", payload: extensionInfo }, window.location.origin);
}

announceReady();
