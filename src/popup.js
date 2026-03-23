const statusText = document.getElementById("statusText");
const diagnosticsText = document.getElementById("diagnosticsText");
const attachToggle = document.getElementById("attachToggle");
const endpointInput = document.getElementById("endpointInput");
const quickConnectBtn = document.getElementById("quickConnectBtn");
const saveEndpointBtn = document.getElementById("saveEndpointBtn");

function setStatus(connected, attached) {
  if (connected && attached) {
    statusText.textContent = "Connected + attached";
    return;
  }
  if (connected) {
    statusText.textContent = "Connected (tab not attached)";
    return;
  }
  statusText.textContent = "Disconnected";
}

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

async function refresh() {
  const state = await send({ type: "GET_POPUP_STATE" });
  endpointInput.value = state.relayEndpoint || "";
  attachToggle.checked = Boolean(state.attached);
  diagnosticsText.textContent = state.diagnostics || "No diagnostics";
  const connected = !String(state.diagnostics || "").startsWith("UNREACHABLE");
  setStatus(connected, Boolean(state.attached));
}

attachToggle.addEventListener("change", async () => {
  const response = await send({
    type: "TOGGLE_ATTACH_CURRENT_TAB",
    attached: attachToggle.checked
  });

  if (!response?.ok) {
    diagnosticsText.textContent = response?.error || "Failed to update attach state";
    return;
  }

  await refresh();
});

quickConnectBtn.addEventListener("click", async () => {
  quickConnectBtn.disabled = true;
  quickConnectBtn.textContent = "Connecting…";

  const response = await send({ type: "QUICK_CONNECT" });
  diagnosticsText.textContent = response?.diagnostics || "No response";

  quickConnectBtn.disabled = false;
  quickConnectBtn.textContent = "Quick connect";
  await refresh();
});

saveEndpointBtn.addEventListener("click", async () => {
  const response = await send({
    type: "SET_ENDPOINT",
    endpoint: endpointInput.value
  });

  if (response?.ok) {
    diagnosticsText.textContent = `Endpoint saved: ${response.relayEndpoint}`;
  } else {
    diagnosticsText.textContent = response?.error || "Failed to save endpoint";
  }

  await refresh();
});

void refresh();
