const DEFAULT_ENDPOINT = "http://127.0.0.1:7331";

async function getState() {
  const data = await chrome.storage.local.get({
    relayEndpoint: DEFAULT_ENDPOINT,
    attachedTabs: {},
    lastDiagnostics: "Not checked yet"
  });
  return data;
}

async function saveState(patch) {
  await chrome.storage.local.set(patch);
}

function normalizeEndpoint(value) {
  const raw = String(value || "").trim();
  return raw.replace(/\/$/, "") || DEFAULT_ENDPOINT;
}

async function pingRelay(endpoint) {
  const url = `${endpoint}/health`;
  const startedAt = Date.now();

  try {
    const res = await fetch(url, { method: "GET" });
    const latency = Date.now() - startedAt;
    const text = `${res.ok ? "OK" : "ERROR"} ${res.status} in ${latency}ms (${url})`;
    await saveState({ lastDiagnostics: text });
    return { ok: res.ok, diagnostics: text };
  } catch (error) {
    const latency = Date.now() - startedAt;
    const text = `UNREACHABLE in ${latency}ms (${url}) - ${error.message}`;
    await saveState({ lastDiagnostics: text });
    return { ok: false, diagnostics: text };
  }
}

async function notifyRelayAttach(endpoint, payload) {
  try {
    await fetch(`${endpoint}/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch {
    // best-effort only; diagnostics are handled by ping
  }
}

async function updateBadgeForTab(tabId) {
  const { attachedTabs } = await getState();
  const isOn = Boolean(attachedTabs[String(tabId)]);
  await chrome.action.setBadgeBackgroundColor({ color: isOn ? "#16a34a" : "#6b7280", tabId });
  await chrome.action.setBadgeText({ text: isOn ? "ON" : "OFF", tabId });
}

async function setAttachForTab(tabId, attached) {
  if (typeof tabId !== "number") return;

  const state = await getState();
  const attachedTabs = { ...state.attachedTabs, [String(tabId)]: Boolean(attached) };
  await saveState({ attachedTabs });

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  await notifyRelayAttach(state.relayEndpoint, {
    attached: Boolean(attached),
    tabId,
    url: tab?.url || null,
    title: tab?.title || null,
    ts: Date.now()
  });

  await updateBadgeForTab(tabId);
  await chrome.tabs.sendMessage(tabId, {
    type: "OPENCLAW_ATTACH_STATE",
    attached: Boolean(attached)
  }).catch(() => null);
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await getState();
  await saveState({
    relayEndpoint: normalizeEndpoint(current.relayEndpoint),
    attachedTabs: current.attachedTabs,
    lastDiagnostics: current.lastDiagnostics
  });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await updateBadgeForTab(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status === "complete") {
    await updateBadgeForTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  const attachedTabs = { ...state.attachedTabs };
  delete attachedTabs[String(tabId)];
  await saveState({ attachedTabs });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "GET_POPUP_STATE") {
      const state = await getState();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tab?.id;
      sendResponse({
        relayEndpoint: state.relayEndpoint,
        diagnostics: state.lastDiagnostics,
        tabId,
        tabUrl: tab?.url || null,
        attached: tabId ? Boolean(state.attachedTabs[String(tabId)]) : false
      });
      return;
    }

    if (message?.type === "SET_ENDPOINT") {
      const endpoint = normalizeEndpoint(message.endpoint);
      await saveState({ relayEndpoint: endpoint });
      sendResponse({ ok: true, relayEndpoint: endpoint });
      return;
    }

    if (message?.type === "TOGGLE_ATTACH_CURRENT_TAB") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        sendResponse({ ok: false, error: "No active tab" });
        return;
      }
      await setAttachForTab(tab.id, Boolean(message.attached));
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "QUICK_CONNECT") {
      const state = await getState();
      const ping = await pingRelay(state.relayEndpoint);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && ping.ok) {
        await setAttachForTab(tab.id, true);
      }
      sendResponse({ ok: ping.ok, diagnostics: ping.diagnostics });
      return;
    }

    if (message?.type === "GET_ATTACH_STATE_FOR_TAB") {
      const tabId = Number(message.tabId);
      const state = await getState();
      sendResponse({ attached: Boolean(state.attachedTabs[String(tabId)]) });
      return;
    }

    if (message?.type === "GET_ATTACH_STATE_SELF") {
      const tabId = sender?.tab?.id;
      const state = await getState();
      sendResponse({ attached: tabId ? Boolean(state.attachedTabs[String(tabId)]) : false });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })();

  return true;
});
