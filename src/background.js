const DEFAULT_ENDPOINT = "http://127.0.0.1:7331";
const MAX_HISTORY = 60;
const MAX_TAB_ACTIONS = 24;
const RELAY_ALARM = "openclaw-relay-health";

const RELAY_STATUS = {
  ONLINE: "online",
  CONNECTING: "connecting",
  OFFLINE: "offline",
  DEGRADED: "degraded"
};

const STORAGE_DEFAULTS = {
  relayEndpoint: DEFAULT_ENDPOINT,
  attachedTabs: {},
  tabState: {},
  tabContext: {},
  actionHistory: [],
  relayState: {
    status: RELAY_STATUS.OFFLINE,
    lastDiagnostics: "Not checked yet",
    lastCheckedAt: null,
    lastLatencyMs: null,
    failCount: 0,
    nextRetryAt: null,
    lastHttpStatus: null,
    lastError: null
  }
};

const RISKY_PATTERN = /\b(submit|delete|remove|payment|pay|purchase|checkout|send|transfer|wire|confirm order|place order|book now|buy now)\b/i;

const WAIT_MS = [0, 500, 1200, 2500, 5000, 10000, 20000, 30000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getState() {
  return chrome.storage.local.get(STORAGE_DEFAULTS);
}

async function saveState(patch) {
  return chrome.storage.local.set(patch);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEndpoint(value) {
  const raw = String(value || "").trim();
  return raw.replace(/\/$/, "") || DEFAULT_ENDPOINT;
}

function riskyLabel(value = "") {
  return RISKY_PATTERN.test(String(value || ""));
}

function diagnosticsFromRelay(relayState) {
  const checkedAt = relayState.lastCheckedAt ? new Date(relayState.lastCheckedAt).toLocaleTimeString() : "never";
  const latency = relayState.lastLatencyMs == null ? "?" : `${relayState.lastLatencyMs}ms`;
  const code = relayState.lastHttpStatus ?? "-";
  const err = relayState.lastError ? ` · err=${relayState.lastError}` : "";
  return `${relayState.status.toUpperCase()} · status=${code} · latency=${latency} · checked=${checkedAt}${err}`;
}

async function addHistory(action, status, detail = "") {
  const state = await getState();
  const next = [
    {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      action,
      status,
      detail,
      ts: Date.now(),
      tsIso: nowIso()
    },
    ...(state.actionHistory || [])
  ].slice(0, MAX_HISTORY);

  await saveState({ actionHistory: next });
}

async function updateTabContext(tabId, patch = {}) {
  if (typeof tabId !== "number") return;
  const state = await getState();
  const tabContext = { ...state.tabContext };
  const key = String(tabId);
  const prev = tabContext[key] || { tabId, actions: [] };
  const merged = {
    ...prev,
    ...patch,
    tabId,
    updatedAt: Date.now()
  };

  if (Array.isArray(patch.appendActions) && patch.appendActions.length) {
    merged.actions = [...patch.appendActions, ...(prev.actions || [])].slice(0, MAX_TAB_ACTIONS);
  }

  delete merged.appendActions;
  tabContext[key] = merged;
  await saveState({ tabContext });
}

async function withTimeout(promiseFn, ms = 6000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await promiseFn(controller.signal);
  } finally {
    clearTimeout(id);
  }
}

async function healthCheck(endpoint) {
  const started = Date.now();
  try {
    const res = await withTimeout((signal) => fetch(`${endpoint}/health`, { method: "GET", signal }), 4500);
    return {
      ok: res.ok,
      status: res.status,
      latencyMs: Date.now() - started,
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      error: error.message
    };
  }
}

async function checkRelayHealth(reason = "manual") {
  const state = await getState();
  const endpoint = normalizeEndpoint(state.relayEndpoint);
  const previous = state.relayState || STORAGE_DEFAULTS.relayState;

  const connectingState = {
    ...previous,
    status: RELAY_STATUS.CONNECTING,
    lastCheckedAt: Date.now()
  };
  await saveState({ relayEndpoint: endpoint, relayState: connectingState });

  const probe = await healthCheck(endpoint);
  const failCount = probe.ok ? 0 : Math.min((previous.failCount || 0) + 1, WAIT_MS.length - 1);
  const backoff = WAIT_MS[failCount] || WAIT_MS[WAIT_MS.length - 1];
  const nextRetryAt = probe.ok ? null : Date.now() + backoff;

  const status = probe.ok
    ? RELAY_STATUS.ONLINE
    : failCount > 3
      ? RELAY_STATUS.OFFLINE
      : RELAY_STATUS.DEGRADED;

  const relayState = {
    status,
    lastCheckedAt: Date.now(),
    lastLatencyMs: probe.latencyMs,
    failCount,
    nextRetryAt,
    lastHttpStatus: probe.status,
    lastError: probe.error,
    lastDiagnostics: ""
  };
  relayState.lastDiagnostics = diagnosticsFromRelay(relayState);

  await saveState({ relayState, relayEndpoint: endpoint });
  if (reason !== "silent") {
    await addHistory("Relay health check", probe.ok ? "ok" : "warn", relayState.lastDiagnostics);
  }

  return { ok: probe.ok, relayState };
}

async function relayPost(path, payload) {
  const state = await getState();
  const endpoint = normalizeEndpoint(state.relayEndpoint);
  const relayState = state.relayState || STORAGE_DEFAULTS.relayState;

  if (relayState.status === RELAY_STATUS.OFFLINE && relayState.nextRetryAt && Date.now() < relayState.nextRetryAt) {
    return {
      ok: false,
      skipped: true,
      error: `Relay offline, retry after ${new Date(relayState.nextRetryAt).toLocaleTimeString()}`
    };
  }

  if (relayState.status !== RELAY_STATUS.ONLINE) {
    await checkRelayHealth("silent");
  }

  const fresh = await getState();
  const url = `${normalizeEndpoint(fresh.relayEndpoint)}${path}`;

  try {
    const response = await withTimeout(
      (signal) =>
        fetch(url, {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }),
      6000
    );

    let data = null;
    try {
      data = await response.json();
    } catch {
      // noop
    }

    if (!response.ok) {
      await checkRelayHealth("silent");
    }

    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    await checkRelayHealth("silent");
    return { ok: false, error: error.message };
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
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
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const tabState = { ...state.tabState };

  tabState[String(tabId)] = {
    ...(tabState[String(tabId)] || {}),
    tabId,
    title: tab?.title || null,
    url: tab?.url || null,
    attached: Boolean(attached),
    attachedAt: attached ? Date.now() : null,
    lastSeenAt: Date.now()
  };

  await saveState({ attachedTabs, tabState });
  await updateTabContext(tabId, {
    title: tab?.title || null,
    url: tab?.url || null,
    attached: Boolean(attached),
    attachedAt: attached ? Date.now() : null,
    appendActions: [{ command: attached ? "attach tab" : "detach tab", source: "system", ts: Date.now(), ok: true }]
  });

  await relayPost("/attach", {
    attached: Boolean(attached),
    tabId,
    url: tab?.url || null,
    title: tab?.title || null,
    ts: Date.now()
  });

  await updateBadgeForTab(tabId);

  await chrome.tabs
    .sendMessage(tabId, {
      type: "OPENCLAW_ATTACH_STATE",
      attached: Boolean(attached)
    })
    .catch(() => null);
}

async function getLocalAnalysis(tabId) {
  const response = await sendToTab(tabId, { type: "OPENCLAW_ANALYZE_PAGE" }).catch(() => null);
  if (!response?.ok) throw new Error("Could not analyze current page. Reload tab and try again.");
  return response.analysis;
}

async function runActionInTab(tabId, command, options = {}) {
  const response = await sendToTab(tabId, {
    type: "OPENCLAW_RUN_ACTION",
    command,
    dryRun: Boolean(options.dryRun),
    confirmed: Boolean(options.confirmed)
  }).catch(() => ({ ok: false, error: "Action dispatch failed" }));

  await updateTabContext(tabId, {
    appendActions: [{ command, source: options.source || "local", ts: Date.now(), ok: Boolean(response?.ok), error: response?.error || null }]
  });

  return response;
}

async function withCurrentTab(handler) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return { ok: false, error: "No active tab" };
  }
  return handler(tab);
}

async function init() {
  const state = await getState();
  await saveState({
    relayEndpoint: normalizeEndpoint(state.relayEndpoint),
    attachedTabs: state.attachedTabs || {},
    tabState: state.tabState || {},
    tabContext: state.tabContext || {},
    actionHistory: Array.isArray(state.actionHistory) ? state.actionHistory.slice(0, MAX_HISTORY) : [],
    relayState: {
      ...STORAGE_DEFAULTS.relayState,
      ...(state.relayState || {})
    }
  });

  await chrome.alarms.create(RELAY_ALARM, { periodInMinutes: 1 });
  await checkRelayHealth("silent");

  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => null);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void init();
});

chrome.runtime.onStartup.addListener(() => {
  void init();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== RELAY_ALARM) return;
  void checkRelayHealth("silent");
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await updateBadgeForTab(tabId);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  await updateTabContext(tabId, {
    title: tab?.title || null,
    url: tab?.url || null,
    lastSeenAt: Date.now()
  });
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete") return;
  await updateBadgeForTab(tabId);
  await updateTabContext(tabId, {
    title: tab?.title || null,
    url: tab?.url || null,
    lastSeenAt: Date.now()
  });
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
      const tab = await getActiveTab();
      const tabId = tab?.id;
      const context = tabId ? state.tabContext[String(tabId)] || null : null;
      sendResponse({
        relayEndpoint: state.relayEndpoint,
        relayState: state.relayState,
        diagnostics: state.relayState?.lastDiagnostics || "Not checked yet",
        tabId,
        tabUrl: tab?.url || null,
        tabTitle: tab?.title || null,
        attached: tabId ? Boolean(state.attachedTabs[String(tabId)]) : false,
        actionHistory: state.actionHistory || [],
        tabContext: context
      });
      return;
    }

    if (message?.type === "CLEAR_ACTION_HISTORY") {
      await saveState({ actionHistory: [] });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "SET_ENDPOINT") {
      const endpoint = normalizeEndpoint(message.endpoint);
      await saveState({ relayEndpoint: endpoint });
      const check = await checkRelayHealth("manual");
      await addHistory("Set relay endpoint", "ok", endpoint);
      sendResponse({ ok: true, relayEndpoint: endpoint, relayState: check.relayState });
      return;
    }

    if (message?.type === "PING_ENDPOINT") {
      const result = await checkRelayHealth("manual");
      sendResponse({ ok: result.ok, diagnostics: result.relayState.lastDiagnostics, relayState: result.relayState });
      return;
    }

    if (message?.type === "ATTACH_CURRENT_TAB" || message?.type === "TOGGLE_ATTACH_CURRENT_TAB") {
      const tab = await getActiveTab();
      if (!tab?.id) return sendResponse({ ok: false, error: "No active tab" });
      await setAttachForTab(tab.id, Boolean(message.attached));
      await addHistory(Boolean(message.attached) ? "Attach current tab" : "Detach current tab", "ok", tab.title || tab.url || "");
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "GET_ATTACH_STATE_SELF") {
      const tabId = sender?.tab?.id;
      const state = await getState();
      sendResponse({ attached: tabId ? Boolean(state.attachedTabs[String(tabId)]) : false });
      return;
    }

    if (message?.type === "SNAPSHOT_CURRENT_TAB") {
      const result = await withCurrentTab(async (tab) => {
        const analysis = await getLocalAnalysis(tab.id);
        await updateTabContext(tab.id, {
          title: tab.title || null,
          url: tab.url || null,
          lastSnapshot: analysis,
          lastSnapshotAt: Date.now(),
          appendActions: [{ command: "snapshot", source: "local", ts: Date.now(), ok: true }]
        });
        return { ok: true, source: "local", analysis };
      });
      await addHistory("Snapshot page", result.ok ? "ok" : "error", result.ok ? "Snapshot updated" : result.error || "Snapshot failed");
      sendResponse(result);
      return;
    }

    if (message?.type === "UNDERSTAND_CURRENT_TAB") {
      const result = await withCurrentTab(async (tab) => {
        const analysis = await getLocalAnalysis(tab.id);
        let relay = await relayPost("/understand", { tabId: tab.id, url: tab.url, title: tab.title, analysis });
        let understanding = relay?.ok && relay.data?.understanding ? relay.data.understanding : null;
        if (!understanding) {
          const local = await sendToTab(tab.id, { type: "OPENCLAW_UNDERSTAND_PAGE" }).catch(() => null);
          understanding = local?.understanding || null;
        }
        await updateTabContext(tab.id, {
          title: tab.title || null,
          url: tab.url || null,
          lastSnapshot: analysis,
          lastSnapshotAt: Date.now(),
          lastUnderstanding: understanding,
          lastUnderstandingAt: Date.now(),
          appendActions: [{ command: "understand", source: relay?.ok ? "relay" : "local", ts: Date.now(), ok: true }]
        });
        return { ok: true, source: relay?.ok ? "relay+local" : "local", analysis, understanding, relay };
      });

      await addHistory("Understand page", result.ok ? "ok" : "error", result.ok ? "Context understanding ready" : result.error || "Understand failed");
      sendResponse(result);
      return;
    }

    if (message?.type === "SUGGEST_CURRENT_TAB") {
      const result = await withCurrentTab(async (tab) => {
        const analysis = await getLocalAnalysis(tab.id);
        const localRes = await sendToTab(tab.id, { type: "OPENCLAW_SUGGEST_ACTIONS" }).catch(() => null);
        let relay = await relayPost("/suggest", { tabId: tab.id, url: tab.url, title: tab.title, analysis });
        const suggestions = relay?.ok && Array.isArray(relay?.data?.suggestions) ? relay.data.suggestions : localRes?.suggestions || [];
        await updateTabContext(tab.id, {
          lastSuggestions: suggestions,
          lastSuggestionsAt: Date.now(),
          appendActions: [{ command: "suggest", source: relay?.ok ? "relay" : "local", ts: Date.now(), ok: true }]
        });
        return { ok: true, source: relay?.ok ? "relay+local" : "local", suggestions, relay, analysis };
      });

      await addHistory("Auto-help suggestions", result.ok ? "ok" : "error", result.ok ? "Suggested next actions generated" : result.error || "Suggestion failed");
      sendResponse(result);
      return;
    }

    if (message?.type === "PARSE_COMMAND") {
      const parsed = await withCurrentTab(async (tab) => {
        const response = await sendToTab(tab.id, {
          type: "OPENCLAW_PARSE_COMMAND",
          command: String(message.command || "")
        }).catch(() => ({ ok: false, error: "Parse failed" }));
        return response;
      });
      sendResponse(parsed);
      return;
    }

    if (message?.type === "RUN_ACTION_COMMAND") {
      const result = await withCurrentTab(async (tab) => {
        const parsed = await sendToTab(tab.id, {
          type: "OPENCLAW_PARSE_COMMAND",
          command: String(message.command || "")
        }).catch(() => null);

        if (!parsed?.ok) {
          return { ok: false, error: parsed?.error || "Could not parse command" };
        }

        const needsConfirm = parsed.plan?.steps?.some((step) => step.risky) || false;
        if (needsConfirm && !message.confirmed) {
          return { ok: false, requiresConfirmation: true, plan: parsed.plan, error: "Risky action requires explicit confirmation" };
        }

        if (message.dryRun) {
          return { ok: true, dryRun: true, plan: parsed.plan };
        }

        const local = await runActionInTab(tab.id, message.command, {
          source: "local",
          confirmed: Boolean(message.confirmed)
        });

        if (!local?.ok) {
          const relay = await relayPost("/action", {
            tabId: tab.id,
            url: tab.url,
            title: tab.title,
            command: message.command,
            plan: parsed.plan
          });

          if (relay?.ok && relay?.data) {
            await updateTabContext(tab.id, {
              appendActions: [{ command: message.command, source: "relay", ts: Date.now(), ok: true }]
            });
            return { ok: true, source: "relay", result: relay.data, plan: parsed.plan };
          }
        }

        return {
          ok: Boolean(local?.ok),
          source: "local",
          result: local,
          plan: parsed.plan,
          requiresConfirmation: false
        };
      });

      await addHistory("Run command", result.ok ? "ok" : result.requiresConfirmation ? "warn" : "error", result.ok ? String(message.command || "") : result.error || "Command failed");
      sendResponse(result);
      return;
    }

    if (message?.type === "DRY_RUN_PLAN") {
      const result = await withCurrentTab(async (tab) => {
        const parsed = await sendToTab(tab.id, {
          type: "OPENCLAW_PARSE_COMMAND",
          command: String(message.command || "")
        }).catch(() => null);
        if (!parsed?.ok) return { ok: false, error: parsed?.error || "Could not parse command" };
        await updateTabContext(tab.id, {
          lastPlan: parsed.plan,
          lastPlanAt: Date.now()
        });
        return { ok: true, plan: parsed.plan };
      });
      sendResponse(result);
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })();

  return true;
});
