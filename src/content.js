const MARKER_ID = "openclaw-relay-marker";
let attached = false;

const RISKY_PATTERN = /\b(submit|delete|remove|payment|pay|purchase|checkout|send|transfer|wire|confirm order|place order|book now|buy now)\b/i;

function cleanText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function pickLabel(el) {
  const aria = el?.getAttribute?.("aria-label");
  const placeholder = el?.getAttribute?.("placeholder");
  const title = el?.getAttribute?.("title");
  const text = cleanText(el?.innerText || el?.textContent || "");
  const name = el?.getAttribute?.("name");
  const id = el?.getAttribute?.("id");
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
    .slice(0, 80)
    .map((el) => ({ type: "link", text: pickLabel(el), href: el.href || null }))
    .filter((x) => x.text);

  const buttons = [...document.querySelectorAll("button, [role='button'], input[type='submit'], input[type='button']")]
    .filter(isVisible)
    .slice(0, 80)
    .map((el) => ({ type: "button", text: pickLabel(el) }))
    .filter((x) => x.text);

  return { links, buttons };
}

function collectForms() {
  return [...document.querySelectorAll("form")].slice(0, 20).map((form, idx) => {
    const fields = [...form.querySelectorAll("input, textarea, select")]
      .filter((el) => el.type !== "hidden")
      .slice(0, 60)
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
}

function collectAlertsAndErrors() {
  const selectors = ["[role='alert']", "[aria-live='assertive']", ".error", ".alert", ".warning", ".form-error", ".invalid-feedback"];
  const nodes = selectors.flatMap((s) => [...document.querySelectorAll(s)]);
  const seen = new Set();
  const out = [];
  for (const node of nodes) {
    if (!isVisible(node)) continue;
    const text = cleanText(node.innerText || node.textContent || "");
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= 20) break;
  }
  return out;
}

function analyzePage() {
  const headings = [...document.querySelectorAll("h1,h2,h3")]
    .filter(isVisible)
    .slice(0, 20)
    .map((el) => ({ level: el.tagName.toLowerCase(), text: cleanText(el.textContent || "") }))
    .filter((x) => x.text);

  const controls = collectControls();
  const forms = collectForms();
  const alerts = collectAlertsAndErrors();

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
    pageTypeSignals: inferPageTypeSignals(),
    counts: {
      links: document.querySelectorAll("a").length,
      buttons: document.querySelectorAll("button, [role='button'], input[type='submit'], input[type='button']").length,
      forms: document.querySelectorAll("form").length,
      inputs: document.querySelectorAll("input, textarea, select").length,
      alerts: alerts.length
    }
  };
}

function summarizePage() {
  const title = document.title;
  const heading = cleanText(document.querySelector("h1")?.textContent || "");
  const paragraphs = [...document.querySelectorAll("p")]
    .map((p) => cleanText(p.textContent || ""))
    .filter(Boolean)
    .slice(0, 5);

  return {
    title,
    heading,
    bullets: paragraphs,
    gist: [title, heading, paragraphs[0]].filter(Boolean).join(" | ")
  };
}

function extractLinks(limit = 30) {
  return [...document.querySelectorAll("a")]
    .filter(isVisible)
    .map((a) => ({ text: pickLabel(a), href: a.href || null }))
    .filter((x) => x.href)
    .slice(0, limit);
}

function extractForms() {
  return collectForms();
}

function parseSingleCommand(rawCommand = "") {
  const command = cleanText(rawCommand);
  const lower = command.toLowerCase();

  if (!command) return null;
  if (/^(back|go back)$/.test(lower)) return { kind: "back", command, risky: false };
  if (/^(forward|go forward)$/.test(lower)) return { kind: "forward", command, risky: false };
  if (/^(reload|refresh)$/.test(lower)) return { kind: "reload", command, risky: false };

  const openTab = lower.match(/^(open (a )?new tab( and go to)?|new tab)\s*(.*)$/i);
  if (openTab) {
    const maybeUrl = cleanText(openTab[4] || "");
    return { kind: "open_new_tab", url: maybeUrl || null, command, risky: false };
  }

  const navigate = lower.match(/^(go to|navigate to|open)\s+(.+)$/i);
  if (navigate) return { kind: "navigate", url: cleanText(navigate[2]), command, risky: false };

  const search = lower.match(/^(search( for)?|find)\s+(.+)$/i);
  if (search) return { kind: "search", query: cleanText(search[3]), command, risky: false };

  const click = command.match(/^click\s+(.+)$/i);
  if (click) {
    const target = cleanText(click[1]);
    return { kind: "click", target, command, risky: RISKY_PATTERN.test(target) };
  }

  const typeEq = command.match(/^type\s+(.+?)\s*=\s*(.+)$/i);
  if (typeEq) return { kind: "type", field: cleanText(typeEq[1]), value: cleanText(typeEq[2]), command, risky: false };

  const fillWith = command.match(/^fill\s+(.+?)\s+with\s+(.+)$/i);
  if (fillWith) return { kind: "type", field: cleanText(fillWith[1]), value: cleanText(fillWith[2]), command, risky: false };

  if (/^(summarize page|summarize this page|page summary)$/.test(lower)) return { kind: "summarize", command, risky: false };
  if (/^(extract links|list links|get links)$/.test(lower)) return { kind: "extract_links", command, risky: false };
  if (/^(extract forms|list forms|get forms)$/.test(lower)) return { kind: "extract_forms", command, risky: false };

  return { kind: "unknown", command, risky: false };
}

function parseCommandPlan(text = "") {
  const chunks = String(text)
    .split(/\b(?:then|and then|;|\|\|)\b/gi)
    .map((x) => cleanText(x))
    .filter(Boolean);

  const steps = (chunks.length ? chunks : [cleanText(text)])
    .map((c) => parseSingleCommand(c))
    .filter(Boolean);

  const risky = steps.some((s) => s.risky || RISKY_PATTERN.test(s.command || ""));
  return {
    original: text,
    steps,
    risky,
    canExecute: steps.length > 0 && steps.every((s) => s.kind !== "unknown")
  };
}

function findClickableByText(target = "") {
  const needle = target.toLowerCase();
  const candidates = [...document.querySelectorAll("button,a,[role='button'],input[type='submit'],input[type='button']")].filter(isVisible);
  return candidates.find((el) => pickLabel(el).toLowerCase().includes(needle)) || null;
}

function findInputByField(field = "") {
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
    const nested = label.querySelector("input,textarea,select");
    if (nested) return nested;
  }

  return [...document.querySelectorAll("input,textarea,select")]
    .filter((el) => el.type !== "hidden")
    .find((el) => {
      const hay = `${el.name || ""} ${el.id || ""} ${el.placeholder || ""} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
      return hay.includes(needle);
    }) || null;
}

function executeStep(step, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const confirmed = Boolean(options.confirmed);

  if (!step || step.kind === "unknown") return { ok: false, error: "Unsupported command" };
  if (step.risky && !confirmed) return { ok: false, requiresConfirmation: true, error: "Risky action requires confirmation", step };

  if (step.kind === "back") {
    if (!dryRun) history.back();
    return { ok: true, note: "Navigating back", step };
  }
  if (step.kind === "forward") {
    if (!dryRun) history.forward();
    return { ok: true, note: "Navigating forward", step };
  }
  if (step.kind === "reload") {
    if (!dryRun) location.reload();
    return { ok: true, note: "Refreshing page", step };
  }

  if (step.kind === "navigate") {
    let target = step.url || "";
    if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
    if (!dryRun) location.assign(target);
    return { ok: true, note: `Navigate to ${target}`, step };
  }

  if (step.kind === "open_new_tab") {
    if (!dryRun) {
      const url = step.url && !/^https?:\/\//i.test(step.url) ? `https://${step.url}` : step.url || "about:blank";
      window.open(url, "_blank", "noopener");
    }
    return { ok: true, note: `Open new tab${step.url ? `: ${step.url}` : ""}`, step };
  }

  if (step.kind === "search") {
    const q = encodeURIComponent(step.query || "");
    const url = `https://www.google.com/search?q=${q}`;
    if (!dryRun) location.assign(url);
    return { ok: true, note: `Search for ${step.query}`, step };
  }

  if (step.kind === "click") {
    const el = findClickableByText(step.target || "");
    if (!el) return { ok: false, error: `No clickable control found for: ${step.target}`, step };
    if (!dryRun) el.click();
    return { ok: true, note: `Clicked: ${pickLabel(el)}`, step };
  }

  if (step.kind === "type") {
    const input = findInputByField(step.field || "");
    if (!input) return { ok: false, error: `No input found for: ${step.field}`, step };
    if (!dryRun) {
      input.focus();
      if ("value" in input) {
        input.value = step.value || "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    return { ok: true, note: `Filled ${step.field}`, step };
  }

  if (step.kind === "summarize") {
    return { ok: true, note: "Page summarized", summary: summarizePage(), step };
  }

  if (step.kind === "extract_links") {
    return { ok: true, note: "Extracted links", links: extractLinks(50), step };
  }

  if (step.kind === "extract_forms") {
    return { ok: true, note: "Extracted forms", forms: extractForms(), step };
  }

  return { ok: false, error: "Unsupported command", step };
}

function runActionCommand(command, options = {}) {
  const plan = parseCommandPlan(command);
  if (!plan.canExecute) {
    return {
      ok: false,
      plan,
      error: "Unsupported command. Try: go to, open new tab, click, type, search, summarize page, extract links/forms"
    };
  }

  const results = [];
  for (const step of plan.steps) {
    const result = executeStep(step, options);
    results.push(result);
    if (!result.ok) break;
  }

  return {
    ok: results.every((x) => x.ok),
    plan,
    results,
    requiresConfirmation: plan.risky && !options.confirmed
  };
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

function understandPage(analysis) {
  const intent = [];
  if (analysis.pageTypeSignals.includes("auth/login")) intent.push("User likely needs to authenticate/sign in.");
  if (analysis.pageTypeSignals.includes("checkout/form")) intent.push("User may be completing a checkout or submission form.");
  if (analysis.pageTypeSignals.includes("dashboard/analytics")) intent.push("User likely wants to inspect metrics or dashboard data.");
  if (analysis.pageTypeSignals.includes("article/content")) intent.push("User likely wants summary, extraction, or research notes.");
  if (!intent.length) intent.push("General interactive webpage; likely navigation and form actions.");

  const keyControls = [...analysis.controls.buttons.slice(0, 8), ...analysis.controls.links.slice(0, 8)].map((x) => x.text);
  return { intent, keyControls, forms: analysis.forms, errors: analysis.alerts, pageTypeSignals: analysis.pageTypeSignals };
}

function suggestNextActions(understanding) {
  const out = [];
  if (understanding.errors?.length) out.push("Resolve visible errors first.");
  if (understanding.pageTypeSignals.includes("auth/login")) out.push("Use: type email = ..., type password = ..., click sign in.");
  if (understanding.forms?.length) out.push("Fill required fields before submit.");
  out.push("Try: summarize page");
  out.push("Try: extract links");
  out.push("Try: extract forms");
  return out.slice(0, 6);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OPENCLAW_ATTACH_STATE") {
    updateAttachState(message.attached);
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "OPENCLAW_ANALYZE_PAGE") {
    sendResponse({ ok: true, analysis: analyzePage() });
    return;
  }

  if (message?.type === "OPENCLAW_UNDERSTAND_PAGE") {
    const analysis = analyzePage();
    sendResponse({ ok: true, analysis, understanding: understandPage(analysis) });
    return;
  }

  if (message?.type === "OPENCLAW_SUGGEST_ACTIONS") {
    const analysis = analyzePage();
    const understanding = understandPage(analysis);
    sendResponse({ ok: true, analysis, understanding, suggestions: suggestNextActions(understanding) });
    return;
  }

  if (message?.type === "OPENCLAW_PARSE_COMMAND") {
    const plan = parseCommandPlan(message.command || "");
    sendResponse({ ok: true, plan });
    return;
  }

  if (message?.type === "OPENCLAW_RUN_ACTION") {
    const result = runActionCommand(message.command || "", {
      dryRun: Boolean(message.dryRun),
      confirmed: Boolean(message.confirmed)
    });
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
