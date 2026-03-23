const statusPill = document.getElementById("statusPill");
const outputText = document.getElementById("outputText");
const endpointInput = document.getElementById("endpointInput");
const tabMeta = document.getElementById("tabMeta");
const commandInput = document.getElementById("commandInput");

const attachBtn = document.getElementById("attachBtn");
const detachBtn = document.getElementById("detachBtn");
const snapshotBtn = document.getElementById("snapshotBtn");
const understandBtn = document.getElementById("understandBtn");
const suggestBtn = document.getElementById("suggestBtn");
const runCommandBtn = document.getElementById("runCommandBtn");
const saveEndpointBtn = document.getElementById("saveEndpointBtn");
const pingBtn = document.getElementById("pingBtn");

let currentState = null;

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function setOutput(textOrObject) {
  outputText.textContent = typeof textOrObject === "string" ? textOrObject : pretty(textOrObject);
}

function setStatus(state) {
  const relay = state?.relayReachable ? "relay:online" : "relay:offline";
  const attached = state?.attached ? "attached" : "detached";
  statusPill.textContent = `${relay} · ${attached}`;
}

function setTabMeta(state) {
  const title = state?.tabTitle || "Untitled tab";
  const url = state?.tabUrl || "No URL";
  tabMeta.textContent = `${title}\n${url}`;
}

async function refresh() {
  currentState = await send({ type: "GET_POPUP_STATE" });
  endpointInput.value = currentState.relayEndpoint || "";
  setStatus(currentState);
  setTabMeta(currentState);
}

async function busy(button, fn) {
  const before = button.textContent;
  button.disabled = true;
  button.textContent = "Working…";
  try {
    await fn();
  } finally {
    button.disabled = false;
    button.textContent = before;
  }
}

attachBtn.addEventListener("click", async () => {
  await busy(attachBtn, async () => {
    const res = await send({ type: "ATTACH_CURRENT_TAB", attached: true });
    setOutput(res?.ok ? "Attached current tab." : res?.error || "Failed to attach tab.");
    await refresh();
  });
});

detachBtn.addEventListener("click", async () => {
  await busy(detachBtn, async () => {
    const res = await send({ type: "ATTACH_CURRENT_TAB", attached: false });
    setOutput(res?.ok ? "Detached current tab." : res?.error || "Failed to detach tab.");
    await refresh();
  });
});

snapshotBtn.addEventListener("click", async () => {
  await busy(snapshotBtn, async () => {
    const res = await send({ type: "SNAPSHOT_CURRENT_TAB" });
    setOutput(res?.ok ? { source: res.source, snapshot: res.analysis } : { error: res?.error || "Snapshot failed" });
  });
});

understandBtn.addEventListener("click", async () => {
  await busy(understandBtn, async () => {
    const res = await send({ type: "UNDERSTAND_CURRENT_TAB" });
    setOutput(
      res?.ok
        ? { source: res.source, intent: res.understanding?.intent, keyControls: res.understanding?.keyControls, errors: res.understanding?.errors }
        : { error: res?.error || "Understand failed" }
    );
  });
});

suggestBtn.addEventListener("click", async () => {
  await busy(suggestBtn, async () => {
    const res = await send({ type: "SUGGEST_CURRENT_TAB" });
    setOutput(res?.ok ? { source: res.source, suggestions: res.suggestions } : { error: res?.error || "Suggestion failed" });
  });
});

runCommandBtn.addEventListener("click", async () => {
  await busy(runCommandBtn, async () => {
    const command = commandInput.value.trim();
    if (!command) {
      setOutput("Enter a command first.");
      return;
    }

    const res = await send({ type: "RUN_ACTION_COMMAND", command });
    setOutput(res?.ok ? { source: res.source, result: res.result } : { error: res?.error || "Command failed" });
  });
});

saveEndpointBtn.addEventListener("click", async () => {
  await busy(saveEndpointBtn, async () => {
    const res = await send({ type: "SET_ENDPOINT", endpoint: endpointInput.value });
    setOutput(res?.ok ? `Saved endpoint: ${res.relayEndpoint}` : res?.error || "Failed to save endpoint");
    await refresh();
  });
});

pingBtn.addEventListener("click", async () => {
  await busy(pingBtn, async () => {
    const res = await send({ type: "PING_ENDPOINT" });
    setOutput(res?.diagnostics || "No diagnostics.");
    await refresh();
  });
});

commandInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  runCommandBtn.click();
});

void refresh();