const statusPill = document.getElementById("statusPill");
const outputText = document.getElementById("outputText");
const endpointInput = document.getElementById("endpointInput");
const tabMeta = document.getElementById("tabMeta");
const contextMeta = document.getElementById("contextMeta");
const commandInput = document.getElementById("commandInput");
const voiceBtn = document.getElementById("voiceBtn");
const voiceHint = document.getElementById("voiceHint");
const historyList = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const suggestionsList = document.getElementById("suggestionsList");
const previewPlanBox = document.getElementById("planPreview");

const attachBtn = document.getElementById("attachBtn");
const detachBtn = document.getElementById("detachBtn");
const snapshotBtn = document.getElementById("snapshotBtn");
const understandBtn = document.getElementById("understandBtn");
const suggestBtn = document.getElementById("suggestBtn");
const runCommandBtn = document.getElementById("runCommandBtn");
const runConfirmedBtn = document.getElementById("runConfirmedBtn");
const previewPlanBtn = document.getElementById("previewPlanBtn");
const saveEndpointBtn = document.getElementById("saveEndpointBtn");
const pingBtn = document.getElementById("pingBtn");

let currentState = null;
let recognition = null;
let listening = false;

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function setOutput(value) {
  outputText.textContent = typeof value === "string" ? value : pretty(value);
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function setStatus(state) {
  const relay = state?.relayState?.status || "offline";
  const attached = state?.attached ? "attached" : "detached";
  statusPill.textContent = `relay:${relay} · ${attached}`;
}

function setTabMeta(state) {
  const title = state?.tabTitle || "Untitled tab";
  const url = state?.tabUrl || "No URL";
  tabMeta.textContent = `${title}\n${url}`;

  const ctx = state?.tabContext;
  if (!ctx) {
    contextMeta.textContent = "No saved tab context yet.";
    return;
  }

  const snapshotAt = ctx.lastSnapshotAt ? formatTime(ctx.lastSnapshotAt) : "-";
  const understandAt = ctx.lastUnderstandingAt ? formatTime(ctx.lastUnderstandingAt) : "-";
  const actions = Array.isArray(ctx.actions) ? ctx.actions.length : 0;
  contextMeta.textContent = `Restore available: snapshot ${snapshotAt} · understand ${understandAt} · ${actions} remembered actions`;
}

function renderSuggestions(items = []) {
  if (!suggestionsList) return;
  if (!items.length) {
    suggestionsList.innerHTML = '<div class="muted tiny">No suggestions yet. Click Suggest.</div>';
    return;
  }
  suggestionsList.innerHTML = items.map((item) => `<div class="list-item">${escapeHtml(item)}</div>`).join("");
}

function renderHistory(items = []) {
  if (!items.length) {
    historyList.innerHTML = '<div class="muted tiny">No actions yet.</div>';
    return;
  }

  historyList.innerHTML = items.slice(0, 24).map((item) => {
    const statusClass = `status-${item.status || "ok"}`;
    const detail = item.detail ? `<div class="line2">${escapeHtml(item.detail)}</div>` : "";
    return `
      <div class="history-item">
        <div class="line1">
          <span>${escapeHtml(item.action || "Action")}</span>
          <span class="${statusClass}">${escapeHtml(item.status || "ok")}</span>
        </div>
        <div class="line2">${formatTime(item.ts)}</div>
        ${detail}
      </div>
    `;
  }).join("");
}

function renderPlan(plan) {
  if (!previewPlanBox) return;
  if (!plan || !Array.isArray(plan.steps)) {
    previewPlanBox.innerHTML = '<div class="muted tiny">No plan preview yet.</div>';
    return;
  }

  previewPlanBox.innerHTML = plan.steps.map((step, idx) => {
    const risky = step.risky ? "<span class='badge-risk'>risky</span>" : "<span class='badge-safe'>safe</span>";
    return `<div class="list-item"><strong>${idx + 1}.</strong> ${escapeHtml(step.command || step.kind || "step")} ${risky}</div>`;
  }).join("");
}

async function refresh() {
  currentState = await send({ type: "GET_POPUP_STATE" });
  if (endpointInput) endpointInput.value = currentState.relayEndpoint || "";
  setStatus(currentState);
  setTabMeta(currentState);
  renderHistory(currentState.actionHistory || []);
  renderSuggestions(currentState.tabContext?.lastSuggestions || []);
}

async function busy(button, fn) {
  if (!button) return fn();
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

async function previewPlan() {
  const command = commandInput.value.trim();
  if (!command) return setOutput("Enter a command first.");
  const res = await send({ type: "DRY_RUN_PLAN", command });
  if (!res?.ok) {
    renderPlan(null);
    return setOutput({ error: res?.error || "Preview failed" });
  }
  renderPlan(res.plan);
  setOutput({ dryRun: true, plan: res.plan });
}

async function runCommand({ confirmed }) {
  const command = commandInput.value.trim();
  if (!command) return setOutput("Enter a command first.");

  const res = await send({ type: "RUN_ACTION_COMMAND", command, confirmed: Boolean(confirmed) });
  if (res?.requiresConfirmation && !confirmed) {
    renderPlan(res.plan);
    return setOutput({ requiresConfirmation: true, plan: res.plan, error: res.error });
  }

  if (res?.plan) renderPlan(res.plan);
  setOutput(res?.ok ? { source: res.source, plan: res.plan, result: res.result } : { error: res?.error || "Command failed", plan: res?.plan });
  await refresh();
}

function setupVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition || !voiceBtn || !voiceHint) {
    if (voiceBtn) voiceBtn.disabled = true;
    if (voiceHint) voiceHint.textContent = "Voice input not supported in this browser.";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    listening = true;
    voiceBtn.classList.add("listening");
    voiceHint.textContent = "Listening…";
  };
  recognition.onend = () => {
    listening = false;
    voiceBtn.classList.remove("listening");
    if (voiceHint.textContent.startsWith("Listening")) voiceHint.textContent = "Voice ready.";
  };
  recognition.onresult = (event) => {
    const transcript = event?.results?.[0]?.[0]?.transcript?.trim();
    if (!transcript) return;
    commandInput.value = transcript;
    voiceHint.textContent = `Captured: "${transcript}"`;
  };
  recognition.onerror = (event) => {
    voiceHint.textContent = `Voice error: ${event.error || "unknown"}`;
  };

  voiceHint.textContent = "Voice ready.";
  voiceBtn.addEventListener("click", () => {
    try {
      if (listening) recognition.stop();
      else recognition.start();
    } catch {
      voiceHint.textContent = "Could not start voice input.";
    }
  });
}

attachBtn?.addEventListener("click", () => busy(attachBtn, async () => {
  const res = await send({ type: "ATTACH_CURRENT_TAB", attached: true });
  setOutput(res?.ok ? "Attached current tab." : res?.error || "Attach failed");
  await refresh();
}));

detachBtn?.addEventListener("click", () => busy(detachBtn, async () => {
  const res = await send({ type: "ATTACH_CURRENT_TAB", attached: false });
  setOutput(res?.ok ? "Detached current tab." : res?.error || "Detach failed");
  await refresh();
}));

snapshotBtn?.addEventListener("click", () => busy(snapshotBtn, async () => {
  const res = await send({ type: "SNAPSHOT_CURRENT_TAB" });
  setOutput(res?.ok ? { source: res.source, snapshot: res.analysis } : { error: res?.error || "Snapshot failed" });
  await refresh();
}));

understandBtn?.addEventListener("click", () => busy(understandBtn, async () => {
  const res = await send({ type: "UNDERSTAND_CURRENT_TAB" });
  setOutput(res?.ok ? { source: res.source, understanding: res.understanding } : { error: res?.error || "Understand failed" });
  await refresh();
}));

suggestBtn?.addEventListener("click", () => busy(suggestBtn, async () => {
  const res = await send({ type: "SUGGEST_CURRENT_TAB" });
  if (res?.ok) renderSuggestions(res.suggestions || []);
  setOutput(res?.ok ? { source: res.source, suggestions: res.suggestions } : { error: res?.error || "Suggest failed" });
  await refresh();
}));

previewPlanBtn?.addEventListener("click", () => busy(previewPlanBtn, previewPlan));
runCommandBtn?.addEventListener("click", () => busy(runCommandBtn, () => runCommand({ confirmed: false })));
runConfirmedBtn?.addEventListener("click", () => busy(runConfirmedBtn, () => runCommand({ confirmed: true })));

saveEndpointBtn?.addEventListener("click", () => busy(saveEndpointBtn, async () => {
  const res = await send({ type: "SET_ENDPOINT", endpoint: endpointInput.value });
  setOutput(res?.ok ? `Saved endpoint: ${res.relayEndpoint}` : res?.error || "Save failed");
  await refresh();
}));

pingBtn?.addEventListener("click", () => busy(pingBtn, async () => {
  const res = await send({ type: "PING_ENDPOINT" });
  setOutput(res?.diagnostics || "No diagnostics");
  await refresh();
}));

clearHistoryBtn?.addEventListener("click", () => busy(clearHistoryBtn, async () => {
  await send({ type: "CLEAR_ACTION_HISTORY" });
  setOutput("Action history cleared.");
  await refresh();
}));

commandInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  runCommandBtn?.click();
});

setupVoiceInput();
renderPlan(null);
void refresh();
