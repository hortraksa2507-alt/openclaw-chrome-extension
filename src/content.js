const MARKER_ID = "openclaw-relay-marker";
let attached = false;

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function cleanText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function pickLabel(el) {
  if (!el) return "";
  const aria = el.getAttribute("aria-label");
  const placeholder = el.getAttribute("placeholder");
  const title = el.getAttribute("title");
  const text = cleanText(el.innerText || el.textContent || "");
  const name = el.getAttribute("name");
  const id = el.getAttribute("id");
  return cleanText(aria || placeholder || title || text || name || id || "");
}

function inferPageTypeSignals() {
  const bodyText = cleanText(document.body?.innerText || "").toLowerCase();
  const hasPassword = !!document.querySelector('input[type="password"]');
  const hasTable = !!document.querySelector("table, [role='grid']");
  const hasManyLinks = document.querySelectorAll("a").length > 40;
  const hasForm = document.querySelectorAll("form").length > 0;

  const signals = [];
  if (hasPassword && /sign in|log in|login|password/.test(bodyText)) signals.push("auth/login");
  if (hasTable && /dashboard|analytics|overview|report/.test(bodyText)) signals.push("dashboard/analytics");
  if (hasForm && /checkout|payment|shipping|billing/.test(bodyText)) signals.push("checkout/form");
  if (/article|blog|reading time/.test(bodyText) || document.querySelectorAll("article p").length > 8) signals.push("article/content");
  if (hasManyLinks && /search|results/.test(bodyText)) signals.push("search/results");
  if (signals.length === 0) signals.push("general/web-app");
  return signals;
}

function collectControls() {
  const links = [...document.querySelectorAll("a")]
    .filter(isVisible)
    .slice(0, 40)
    .map((el) => ({
      type: "link",
      text: pickLabel(el),
      href: el.href || null
    }))
    .filter((x) => x.text);

  const buttons = [...document.querySelectorAll("button, [role='button'], input[type='submit'], input[type='button']")]
    .filter(isVisible)
    .slice(0, 40)
    .map((el) => ({
      type: "button",
      text: pickLabel(el)
    }))
    .filter((x) => x.text);

  return { links, buttons };
}

function collectForms() {
  const forms = [...document.querySelectorAll("form")].slice(0, 10).map((form, idx) => {
    const fields = [...form.querySelectorAll("input, textarea, select")]
      .filter((el) => el.type !== "hidden")
      .slice(0, 30)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: (el.getAttribute("type") || "text").toLowerCase(),
        name: el.getAttribute("name") || null,
        id: el.id || null,
        label: pickLabel(el),
        required: !!el.required
      }));

    return {
      index: idx,
      id: form.id || null,
      name: form.getAttribute("name") || null,
      action: form.getAttribute("action") || null,
      method: (form.getAttribute("method") || "get").toLowerCase(),
      fields
    };
  });

  return forms;
}

function collectAlertsAndErrors() {
  const selectors = [
    "[role='alert']",
    "[aria-live='assertive']",
    ".error",
    ".alert",
    ".warning",
    ".form-error",
    ".invalid-feedback"
  ];

  const seen = new Set();
  const nodes = selectors.flatMap((s) => [...document.querySelectorAll(s)]);
  const messages = [];

  for (const node of nodes) {
    if (!isVisible(node)) continue;
    const text = cleanText(node.innerText || node.textContent || "");
    if (!text || seen.has(text)) continue;
    seen.add(text);
    messages.push(text);
    if (messages.length >= 20) break;
  }

  return messages;
}

function analyzePage() {
  const headings = [...document.querySelectorAll("h1, h2, h3")]
    .filter(isVisible)
    .slice(0, 20)
    .map((el) => ({ level: el.tagName.toLowerCase(), text: cleanText(el.textContent || "") }))
    .filter((h) => h.text);

  const controls = collectControls();
  const forms = collectForms();
  const alerts = collectAlertsAndErrors();
  const pageTypeSignals = inferPageTypeSignals();

  return {
    meta: {
      title: document.title,
      url: location.href,
      timestamp: new Date().toISOString()
    },
    headings,
    controls,
    forms,
    alerts,
    pageTypeSignals,
    counts: {
      links: document.querySelectorAll("a").length,
      buttons: document.querySelectorAll("button, [role='button'], input[type='submit'], input[type='button']").length,
      forms: document.querySelectorAll("form").length,
      inputs: document.querySelectorAll("input, textarea, select").length,
      alerts: alerts.length
    }
  };
}

function understandPage(analysis) {
  const intent = [];
  if (analysis.pageTypeSignals.includes("auth/login")) intent.push("User likely needs to authenticate/sign in.");
  if (analysis.pageTypeSignals.includes("checkout/form")) intent.push("User may be completing a checkout or submission form.");
  if (analysis.pageTypeSignals.includes("dashboard/analytics")) intent.push("User likely wants to inspect metrics or dashboard data.");
  if (analysis.pageTypeSignals.includes("article/content")) intent.push("User likely wants summary, extraction, or research notes.");
  if (intent.length === 0) intent.push("General interactive webpage; likely navigation and form actions.");

  const keyControls = [...analysis.controls.buttons.slice(0, 8), ...analysis.controls.links.slice(0, 8)].map((x) => x.text);

  return {
    intent,
    keyControls,
    forms: analysis.forms,
    errors: analysis.alerts,
    pageTypeSignals: analysis.pageTypeSignals
  };
}

function suggestNextActions(understanding) {
  const out = [];
  if (understanding.errors?.length) {
    out.push("Resolve visible errors first (field validation/auth/session issues).");
  }
  if (understanding.pageTypeSignals.includes("auth/login")) {
    out.push("Use `type email = ...` and `type password = ...`, then `click sign in`.");
  }
  if (understanding.pageTypeSignals.includes("dashboard/analytics")) {
    out.push("Ask for a snapshot and extract key KPI values from headings/cards/tables.");
  }
  if (understanding.forms?.length) {
    out.push("Fill required fields before submit; verify highlighted required inputs.");
  }
  out.push("Use `click <button text>` for safe incremental navigation.");
  out.push("Use `go to <url>` for direct navigation if needed.");
  return out.slice(0, 6);
}

function renderAttachMarker(isAttached) {
  let marker = document.getElementById(MARKER_ID);
  if (isAttached) {
    if (!marker) {
      marker = document.createElement("div");
      marker.id = MARKER_ID;
      marker.textContent = "OpenClaw Attached";
      Object.assign(marker.style, {
        position: "fixed",
        right: "10px",
        bottom: "10px",
        zIndex: "2147483647",
        background: "#111827",
        color: "#f9fafb",
        fontSize: "11px",
        padding: "5px 8px",
        borderRadius: "999px",
        border: "1px solid #374151",
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "none",
        opacity: "0.95"
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

function matchCommand(command) {
  const raw = cleanText(command).toLowerCase();

  if (/^(back|go back)$/.test(raw)) return { type: "back" };
  if (/^(forward|go forward)$/.test(raw)) return { type: "forward" };
  if (/^(reload|refresh)$/.test(raw)) return { type: "reload" };

  const goTo = raw.match(/^(go to|navigate to)\s+(.+)$/i);
  if (goTo) return { type: "navigate", value: cleanText(goTo[2]) };

  const click = raw.match(/^click\s+(.+)$/i);
  if (click) return { type: "click", target: cleanText(click[1]) };

  const typeEq = command.match(/^type\s+(.+?)\s*=\s*(.+)$/i);
  if (typeEq) return { type: "type", field: cleanText(typeEq[1]), value: cleanText(typeEq[2]) };

  const fillWith = command.match(/^fill\s+(.+?)\s+with\s+(.+)$/i);
  if (fillWith) return { type: "type", field: cleanText(fillWith[1]), value: cleanText(fillWith[2]) };

  return { type: "unknown", raw: command };
}

function findClickableByText(target) {
  const needle = target.toLowerCase();
  const candidates = [...document.querySelectorAll("button, a, [role='button'], input[type='submit'], input[type='button']")]
    .filter(isVisible);

  return candidates.find((el) => pickLabel(el).toLowerCase().includes(needle)) || null;
}

function findInputByField(field) {
  const needle = field.toLowerCase();
  const labels = [...document.querySelectorAll("label")];

  for (const label of labels) {
    const text = cleanText(label.textContent || "").toLowerCase();
    if (!text.includes(needle)) continue;
    const forId = label.getAttribute("for");
    if (forId) {
      const byId = document.getElementById(forId);
      if (byId) return byId;
    }
    const nested = label.querySelector("input, textarea, select");
    if (nested) return nested;
  }

  const all = [...document.querySelectorAll("input, textarea, select")]
    .filter((el) => el.type !== "hidden");
  return all.find((el) => {
    const hay = `${el.name || ""} ${el.id || ""} ${el.placeholder || ""} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
    return hay.includes(needle);
  }) || null;
}

function runActionCommand(command) {
  const parsed = matchCommand(command);

  if (parsed.type === "back") {
    history.back();
    return { ok: true, action: parsed, note: "Navigating back" };
  }
  if (parsed.type === "forward") {
    history.forward();
    return { ok: true, action: parsed, note: "Navigating forward" };
  }
  if (parsed.type === "reload") {
    location.reload();
    return { ok: true, action: parsed, note: "Refreshing page" };
  }
  if (parsed.type === "navigate") {
    let targetUrl = parsed.value;
    if (!/^https?:\/\//i.test(targetUrl)) targetUrl = `https://${targetUrl}`;
    location.assign(targetUrl);
    return { ok: true, action: parsed, note: `Navigating to ${targetUrl}` };
  }
  if (parsed.type === "click") {
    const el = findClickableByText(parsed.target);
    if (!el) return { ok: false, error: `No clickable control found for: ${parsed.target}` };
    el.click();
    return { ok: true, action: parsed, note: `Clicked: ${pickLabel(el)}` };
  }
  if (parsed.type === "type") {
    const input = findInputByField(parsed.field);
    if (!input) return { ok: false, error: `No input field found for: ${parsed.field}` };

    input.focus();
    if ("value" in input) {
      input.value = parsed.value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, action: parsed, note: `Filled ${parsed.field}` };
    }
    return { ok: false, error: `Target field is not writable: ${parsed.field}` };
  }

  return {
    ok: false,
    error: "Unsupported command. Try: click <text>, type <field> = <value>, go to <url>, back, forward, refresh"
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OPENCLAW_ATTACH_STATE") {
    updateAttachState(message.attached);
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "OPENCLAW_ANALYZE_PAGE") {
    const analysis = analyzePage();
    sendResponse({ ok: true, analysis });
    return;
  }

  if (message?.type === "OPENCLAW_UNDERSTAND_PAGE") {
    const analysis = analyzePage();
    const understanding = understandPage(analysis);
    sendResponse({ ok: true, analysis, understanding });
    return;
  }

  if (message?.type === "OPENCLAW_SUGGEST_ACTIONS") {
    const analysis = analyzePage();
    const understanding = understandPage(analysis);
    const suggestions = suggestNextActions(understanding);
    sendResponse({ ok: true, analysis, understanding, suggestions });
    return;
  }

  if (message?.type === "OPENCLAW_RUN_ACTION") {
    const result = runActionCommand(message.command || "");
    sendResponse(result);
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