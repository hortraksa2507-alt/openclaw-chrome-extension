const statusPill = document.getElementById("statusPill");
const outputText = document.getElementById("outputText");
const endpointInput = document.getElementById("endpointInput");
const tabMeta = document.getElementById("tabMeta");
const commandInput = document.getElementById("commandInput");
const voiceBtn = document.getElementById("voiceBtn");
const voiceHint = document.getElementById("voiceHint");
const historyList = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const riskyList = document.getElementById("riskyList");

const attachBtn = document.getElementById("attachBtn");
const detachBtn = document.getElementById("detachBtn");
const snapshotBtn = document.getElementById("snapshotBtn");
const understandBtn = document.getElementById("understandBtn");
const suggestBtn = document.getElementById("suggestBtn");
const runCommandBtn = document.getElementById("runCommandBtn");
const saveEndpointBtn = document.getElementById("saveEndpointBtn");
const pingBtn = document.getElementById("pingBtn");
const autopilotBtn = document.getElementById("autopilotBtn");

let currentState = null;
let recognition = null;
let listening = false;

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

function renderHistory(items = []) {
  if (!items.length) {
    historyList.innerHTML = '<div class="muted tiny">No actions yet.</div>';
    return;
  }

  historyList.innerHTML = items
    .slice(0, 20)
    .map((item) => {
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
    })
    .join("");
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

function renderRiskyActions(actions = []) {
  if (!actions.length) {
    riskyList.innerHTML = "";
    return;
  }

  riskyList.innerHTML = actions
    .map((item, index) => `
      <div class="risky-item">
        <p><strong>Risky:</strong> ${escapeHtml(item.label)}<br />${escapeHtml(item.reason || "Needs explicit confirmation")}</p>
        <button type="button" data-risky-index="${index}">Confirm & run</button>
      </div>
    `)
    .join("");

  riskyList.querySelectorAll("button[data-risky-index]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.riskyIndex || "-1");
      const action = actions[idx];
      if (!action?.command) return;

      const ok = window.confirm(`Confirm risky action?\n\n${action.command}`);
      if (!ok) return;

      await busy(btn, async () => {
        const result = await send({ type: "AUTOPILOT_EXECUTE_RISKY", command: action.command, confirmed: true });
        setOutput(result?.ok ? { riskyExecuted: action.command, result: result.result } : { error: result?.error || "Risky action failed" });
        await refresh();
      });
    });
  });
}

async function refresh() {
  currentState = await send({ type: "GET_POPUP_STATE" });
  endpointInput.value = currentState.relayEndpoint || "";
  setStatus(currentState);
  setTabMeta(currentState);
  renderHistory(currentState.actionHistory || []);
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

function setupVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    voiceBtn.disabled = true;
    voiceHint.textContent = "Voice input not supported in this browser. Type command manually.";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    listening = true;
    voiceBtn.classList.add("listening");
    voiceHint.textContent = "Listening… speak your command.";
  };

  recognition.onend = () => {
    listening = false;
    voiceBtn.classList.remove("listening");
    if (voiceHint.textContent.startsWith("Listening")) {
      voiceHint.textContent = "Voice ready. Tap mic and speak command.";
    }
  };

  recognition.onresult = (event) => {
    const transcript = event?.results?.[0]?.[0]?.transcript?.trim();
    if (!transcript) return;
    commandInput.value = transcript;
    voiceHint.textContent = `Captured: "${transcript}"`;
  };

  recognition.onerror = (event) => {
    voiceHint.textContent = `Voice error: ${event.error || "unknown"}. You can still type.`;
  };

  voiceHint.textContent = "Voice ready. Tap mic and speak command.";

  voiceBtn.addEventListener("click", () => {
    try {
      if (listening) recognition.stop();
      else recognition.start();
    } catch {
      voiceHint.textContent = "Could not start voice input. Try again or type command.";
    }
  });
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
    await refresh();
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
    await refresh();
  });
});

suggestBtn.addEventListener("click", async () => {
  await busy(suggestBtn, async () => {
    const res = await send({ type: "SUGGEST_CURRENT_TAB" });
    setOutput(res?.ok ? { source: res.source, suggestions: res.suggestions } : { error: res?.error || "Suggestion failed" });
    await refresh();
  });
});

autopilotBtn.addEventListener("click", async () => {
  await busy(autopilotBtn, async () => {
    const res = await send({ type: "AUTOPILOT_SAFE_RUN" });
    if (!res?.ok) {
      setOutput({ error: res?.error || "Autopilot failed" });
      return;
    }

    renderRiskyActions(res.plan?.risky || []);
    setOutput({
      autopilot: "safe-mode",
      intent: res.plan?.pageIntent,
      executed: res.executed?.map((x) => ({ command: x.step?.command, ok: x.result?.ok, note: x.result?.note || x.result?.error || "" })),
      riskyRequiresConfirmation: res.plan?.risky || []
    });
    await refresh();
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
    await refresh();
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

clearHistoryBtn.addEventListener("click", async () => {
  await busy(clearHistoryBtn, async () => {
    await send({ type: "CLEAR_ACTION_HISTORY" });
    setOutput("Action history cleared.");
    await refresh();
  });
});

commandInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  runCommandBtn.click();
});

setupVoiceInput();
void refresh();
