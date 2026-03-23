const DEFAULT_ENDPOINT = "http://127.0.0.1:7331";
const MAX_HISTORY = 40;
const RISKY_PATTERN = /\b(submit|delete|remove|payment|pay|purchase|checkout|send|transfer|wire|confirm order|place order)\b/i;

const STORAGE_DEFAULTS = {
  relayEndpoint: DEFAULT_ENDPOINT,
  attachedTabs: {},
  tabState: {},
  lastDiagnostics: "Not checked yet",
  relayReachable: false,
  relayLastCheckedAt: null,
  actionHistory: []
};

async function getState() {
  return chrome.storage.local.get(STORAGE_DEFAULTS);
}

async function saveState(patch) {
  await chrome.storage.local.set(patch);
}

function normalizeEndpoint(value) {
  const raw = String(value || "").trim();
  return raw.replace(/\/$/, "") || DEFAULT_ENDPOINT;
}

function nowIso() {
  return new Date().toISOString();
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

function isRiskyLabel(text = "") {
  return RISKY_PATTERN.test(String(text || ""));
}

function safeControlText(text = "") {
  const t = String(text || "").trim();
  if (!t) return null;
  if (isRiskyLabel(t)) return null;
  if (t.length > 80) return null;
  return t;
}

function quoteForCommand(value = "") {
  return String(value).replace(/"/g, '\\"');
}

function deriveAutopilotPlan(analysis, understanding) {
  const controls = [
    ...(analysis?.controls?.buttons || []).map((x) => ({ ...x, kind: "button" })),
    ...(analysis?.controls?.links || []).map((x) => ({ ...x, kind: "link" }))
  ];

  const riskyCandidates = [];
  const safeCandidates = [];

  for (const c of controls) {
    const label = (c?.text || "").trim();
    if (!label) continue;

    if (isRiskyLabel(label)) {
      riskyCandidates.push({
        label,
        reason: "Potentially destructive/committing action",
        command: `click ${label}`
      });
      continue;
    }

    const safeText = safeControlText(label);
    if (!safeText) continue;

    safeCandidates.push({
      label: safeText,
      reason: c.kind === "link" ? "Navigation-like action" : "Visible non-risk control",
      command: `click ${safeText}`
    });
  }

  const lowRisk = [];

  lowRisk.push({
    label: "Refresh understanding snapshot",
    reason: "Read-only analysis step",
    command: "snapshot"
  });

  for (const candidate of safeCandidates) {
    if (lowRisk.length >= 4) break;
    if (!lowRisk.find((x) => x.command.toLowerCase() === candidate.command.toLowerCase())) {
      lowRisk.push(candidate);
    }
  }

  return {
    pageIntent: understanding?.intent || [],
    lowRisk,
    risky: riskyCandidates.slice(0, 6)
  };
}

async function withTimeout(promise, ms = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await promise(controller.signal);
  } finally {
    clearTimeout(id);
  }
}

async function pingRelay(endpoint) {
  const url = `${endpoint}/health`;
  const startedAt = Date.now();
  try {
    const res = await withTimeout((signal) => fetch(url, { method: "GET", signal }), 5000);
    const latency = Date.now() - startedAt;
    const diagnostics = `${res.ok ? "OK" : "ERROR"} ${res.status} in ${latency}ms (${url})`;
    await saveState({
      relayReachable: res.ok,
      relayLastCheckedAt: Date.now(),
      lastDiagnostics: diagnostics
    });
    return { ok: res.ok, diagnostics, status: res.status };
  } catch (error) {
    const latency = Date.now() - startedAt;
    const diagnostics = `UNREACHABLE in ${latency}ms (${url}) - ${error.message}`;
    await saveState({
      relayReachable: false,
      relayLastCheckedAt: Date.now(),
      lastDiagnostics: diagnostics
    });
    return { ok: false, diagnostics, error: error.message };
  }
}

async function relayPost(endpoint, path, payload) {
  const url = `${endpoint}${path}`;
  try {
    const res = await withTimeout(
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
      data = await res.json();
    } catch {
      // noop
    }

    return { ok: res.ok, status: res.status, data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function notifyRelayAttach(endpoint, payload) {
  return relayPost(endpoint, "/attach", payload);
}

async function updateBadgeForTab(tabId) {
  const { attachedTabs } = await getState();
  const isOn = Boolean(attachedTabs[String(tabId)]);
  await chrome.action.setBadgeBackgroundColor({ color: isOn ? "#16a34a" : "#6b7280", tabId });
  await chrome.action.setBadgeText({ text: isOn ? "ON" : "OFF", tabId });
}

async function updateTabMetadata(tabId) {
  if (typeof tabId !== "number") return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;

  const state = await getState();
  const tabState = { ...state.tabState };
  const prev = tabState[String(tabId)] || {};
  tabState[String(tabId)] = {
    ...prev,
    tabId,
    title: tab.title || null,
    url: tab.url || null,
    lastSeenAt: Date.now()
  };
  await saveState({ tabState });
}

async function setAttachForTab(tabId, attached) {
  if (typeof tabId !== "number") return;

  const state = await getState();
  const attachedTabs = { ...state.attachedTabs, [String(tabId)]: Boolean(attached) };
  const tabState = { ...state.tabState };
  const tab = await chrome.tabs.get(tabId).catch(() => null);

  tabState[String(tabId)] = {
    ...(tabState[String(tabId)] || {}),
    tabId,
    title: tab?.title || null,
    url: tab?.url || null,
    attached: Boolean(attached),
    attachedAt: Boolean(attached) ? Date.now() : null,
    lastSeenAt: Date.now()
  };

  await saveState({ attachedTabs, tabState });

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

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

async function getLocalAnalysis(tabId) {
  const response = await sendToTab(tabId, { type: "OPENCLAW_ANALYZE_PAGE" }).catch(() => null);
  if (!response?.ok) throw new Error("Could not analyze current page. Reload tab and try again.");
  return response.analysis;
}

function localUnderstand(analysis) {
  const intent = [];
  if (analysis.pageTypeSignals.includes("auth/login")) intent.push("Sign-in/authentication flow likely.");
  if (analysis.pageTypeSignals.includes("checkout/form")) intent.push("Form submission or checkout flow likely.");
  if (analysis.pageTypeSignals.includes("dashboard/analytics")) intent.push("Metrics/dashboard exploration likely.");
  if (analysis.pageTypeSignals.includes("article/content")) intent.push("Content reading/summarization likely.");
  if (intent.length === 0) intent.push("General browsing + interaction flow.");

  const keyControls = [...analysis.controls.buttons.slice(0, 8), ...analysis.controls.links.slice(0, 8)]
    .map((x) => x.text)
    .filter(Boolean);

  return {
    intent,
    keyControls,
    forms: analysis.forms,
    errors: analysis.alerts,
    pageTypeSignals: analysis.pageTypeSignals
  };
}

function localSuggestions(understanding) {
  const suggestions = [];
  if (understanding.errors?.length) suggestions.push("Address visible page errors before running next actions.");
  if (understanding.pageTypeSignals.includes("auth/login")) suggestions.push("Try: type email = <value>, type password = <value>, click sign in.");
  if (understanding.forms?.length) suggestions.push("Fill required fields first, then submit once.");
  if (understanding.pageTypeSignals.includes("dashboard/analytics")) suggestions.push("Snapshot now, then ask for KPI extraction.");
  suggestions.push("Use click <text> for safe navigation between steps.");
  suggestions.push("Use go to <url> for direct navigation.");
  return suggestions.slice(0, 6);
}

async function executeCommandInTab(tabId, command) {
  if (command === "snapshot") {
    const analysis = await getLocalAnalysis(tabId);
    return { ok: true, note: "Snapshot refreshed", analysis };
  }
  return sendToTab(tabId, { type: "OPENCLAW_RUN_ACTION", command }).catch(() => ({ ok: false, error: "Action dispatch failed" }));
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await getState();
  await saveState({
    relayEndpoint: normalizeEndpoint(current.relayEndpoint),
    attachedTabs: current.attachedTabs,
    tabState: current.tabState,
    lastDiagnostics: current.lastDiagnostics,
    relayReachable: Boolean(current.relayReachable),
    relayLastCheckedAt: current.relayLastCheckedAt || null,
    actionHistory: Array.isArray(current.actionHistory) ? current.actionHistory.slice(0, MAX_HISTORY) : []
  });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await updateBadgeForTab(tabId);
  await updateTabMetadata(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status === "complete") {
    await updateBadgeForTab(tabId);
    await updateTabMetadata(tabId);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  const attachedTabs = { ...state.attachedTabs };
  const tabState = { ...state.tabState };
  delete attachedTabs[String(tabId)];
  delete tabState[String(tabId)];
  await saveState({ attachedTabs, tabState });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "GET_POPUP_STATE") {
      const state = await getState();
      const tab = await getActiveTab();
      const tabId = tab?.id;
      sendResponse({
        relayEndpoint: state.relayEndpoint,
        diagnostics: state.lastDiagnostics,
        relayReachable: Boolean(state.relayReachable),
        relayLastCheckedAt: state.relayLastCheckedAt,
        tabId,
        tabUrl: tab?.url || null,
        tabTitle: tab?.title || null,
        attached: tabId ? Boolean(state.attachedTabs[String(tabId)]) : false,
        actionHistory: state.actionHistory || []
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
      await addHistory("Set relay endpoint", "ok", endpoint);
      sendResponse({ ok: true, relayEndpoint: endpoint });
      return;
    }

    if (message?.type === "PING_ENDPOINT") {
      const state = await getState();
      const result = await pingRelay(state.relayEndpoint);
      await addHistory("Ping relay", result.ok ? "ok" : "error", result.diagnostics);
      sendResponse({ ok: result.ok, diagnostics: result.diagnostics });
      return;
    }

    if (message?.type === "ATTACH_CURRENT_TAB" || message?.type === "TOGGLE_ATTACH_CURRENT_TAB") {
      const tab = await getActiveTab();
      if (!tab?.id) {
        sendResponse({ ok: false, error: "No active tab" });
        return;
      }
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
      const tab = await getActiveTab();
      if (!tab?.id) return sendResponse({ ok: false, error: "No active tab" });

      try {
        const analysis = await getLocalAnalysis(tab.id);
        await addHistory("Snapshot page", "ok", tab.title || tab.url || "");
        sendResponse({ ok: true, source: "local", analysis });
      } catch (error) {
        await addHistory("Snapshot page", "error", error.message);
        sendResponse({ ok: false, error: error.message });
      }
      return;
    }

    if (message?.type === "UNDERSTAND_CURRENT_TAB") {
      const tab = await getActiveTab();
      if (!tab?.id) return sendResponse({ ok: false, error: "No active tab" });

      try {
        const state = await getState();
        const analysis = await getLocalAnalysis(tab.id);
        const understanding = localUnderstand(analysis);

        let relay = null;
        if (state.relayReachable) {
          relay = await relayPost(state.relayEndpoint, "/understand", {
            tabId: tab.id,
            url: tab.url,
            title: tab.title,
            analysis
          });
        }

        await addHistory("Understand page", "ok", tab.title || tab.url || "");
        sendResponse({
          ok: true,
          source: relay?.ok ? "relay+local" : "local",
          analysis,
          understanding: relay?.ok && relay?.data?.understanding ? relay.data.understanding : understanding,
          relay
        });
      } catch (error) {
        await addHistory("Understand page", "error", error.message);
        sendResponse({ ok: false, error: error.message });
      }
      return;
    }

    if (message?.type === "SUGGEST_CURRENT_TAB") {
      const tab = await getActiveTab();
      if (!tab?.id) return sendResponse({ ok: false, error: "No active tab" });

      try {
        const state = await getState();
        const analysis = await getLocalAnalysis(tab.id);
        const understanding = localUnderstand(analysis);
        const local = localSuggestions(understanding);

        let relay = null;
        if (state.relayReachable) {
          relay = await relayPost(state.relayEndpoint, "/suggest", {
            tabId: tab.id,
            url: tab.url,
            title: tab.title,
            analysis,
            understanding
          });
        }

        await addHistory("Auto-help suggestions", "ok", tab.title || tab.url || "");
        sendResponse({
          ok: true,
          source: relay?.ok ? "relay+local" : "local",
          analysis,
          understanding,
          suggestions: relay?.ok && Array.isArray(relay?.data?.suggestions) ? relay.data.suggestions : local,
          relay
        });
      } catch (error) {
        await addHistory("Auto-help suggestions", "error", error.message);
        sendResponse({ ok: false, error: error.message });
      }
      return;
    }

    if (message?.type === "RUN_ACTION_COMMAND") {
      const tab = await getActiveTab();
      if (!tab?.id) return sendResponse({ ok: false, error: "No active tab" });

      try {
        const state = await getState();
        let relay = null;
        if (state.relayReachable) {
          relay = await relayPost(state.relayEndpoint, "/action", {
            tabId: tab.id,
            url: tab.url,
            title: tab.title,
            command: message.command
          });
          if (relay?.ok && relay?.data) {
            await addHistory("Run command", "ok", `relay: ${message.command}`);
            sendResponse({ ok: true, source: "relay", result: relay.data, relay });
            return;
          }
        }

        const local = await sendToTab(tab.id, { type: "OPENCLAW_RUN_ACTION", command: message.command }).catch(() => null);
        if (!local?.ok) {
          await addHistory("Run command", "error", `${message.command} :: ${local?.error || "Command failed"}`);
          sendResponse({ ok: false, source: "local", error: local?.error || "Command failed" });
          return;
        }

        await addHistory("Run command", "ok", `local: ${message.command}`);
        sendResponse({ ok: true, source: "local", result: local, relay });
      } catch (error) {
        await addHistory("Run command", "error", error.message);
        sendResponse({ ok: false, error: error.message });
      }
      return;
    }

    if (message?.type === "AUTOPILOT_SAFE_RUN") {
      const tab = await getActiveTab();
      if (!tab?.id) return sendResponse({ ok: false, error: "No active tab" });

      try {
        const analysis = await getLocalAnalysis(tab.id);
        const understanding = localUnderstand(analysis);
        const plan = deriveAutopilotPlan(analysis, understanding);

        const executed = [];
        for (const step of plan.lowRisk) {
          const result = await executeCommandInTab(tab.id, step.command);
          executed.push({ step, result });
          if (!result?.ok) break;
        }

        await addHistory(
          "Safe autopilot run",
          executed.every((x) => x.result?.ok) ? "ok" : "warn",
          `${executed.filter((x) => x.result?.ok).length}/${plan.lowRisk.length} low-risk steps executed`
        );

        sendResponse({
          ok: true,
          analysis,
          understanding,
          plan,
          executed,
          requiresConfirmation: plan.risky.length > 0
        });
      } catch (error) {
        await addHistory("Safe autopilot run", "error", error.message);
        sendResponse({ ok: false, error: error.message });
      }
      return;
    }

    if (message?.type === "AUTOPILOT_EXECUTE_RISKY") {
      const tab = await getActiveTab();
      if (!tab?.id) return sendResponse({ ok: false, error: "No active tab" });

      const command = String(message.command || "").trim();
      if (!command) {
        sendResponse({ ok: false, error: "No risky command provided" });
        return;
      }

      if (!message.confirmed) {
        sendResponse({ ok: false, error: "Explicit confirmation required" });
        return;
      }

      if (!isRiskyLabel(command)) {
        sendResponse({ ok: false, error: "Command is not marked risky" });
        return;
      }

      const result = await executeCommandInTab(tab.id, command);
      await addHistory("Risky autopilot step", result?.ok ? "ok" : "error", quoteForCommand(command));
      sendResponse({ ok: Boolean(result?.ok), result });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })();

  return true;
});
