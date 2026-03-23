let attached = false;

function renderAttachMarker(isAttached) {
  const markerId = "openclaw-relay-marker";
  let marker = document.getElementById(markerId);

  if (isAttached) {
    if (!marker) {
      marker = document.createElement("div");
      marker.id = markerId;
      marker.textContent = "OpenClaw Relay ON";
      Object.assign(marker.style, {
        position: "fixed",
        right: "10px",
        bottom: "10px",
        zIndex: "2147483647",
        background: "#16a34a",
        color: "white",
        fontSize: "11px",
        padding: "4px 6px",
        borderRadius: "6px",
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "none",
        opacity: "0.9"
      });
      document.documentElement.appendChild(marker);
    }
  } else if (marker) {
    marker.remove();
  }
}

function updateAttachState(next) {
  attached = Boolean(next);
  document.documentElement.dataset.openclawRelayAttached = attached ? "1" : "0";
  renderAttachMarker(attached);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OPENCLAW_ATTACH_STATE") {
    updateAttachState(message.attached);
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "OPENCLAW_PING") {
    sendResponse({ ok: true, attached });
  }
});

chrome.runtime.sendMessage({ type: "GET_ATTACH_STATE_SELF" }, (response) => {
  if (chrome.runtime.lastError) return;
  updateAttachState(Boolean(response?.attached));
});
