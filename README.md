# OpenClaw Chrome Extension (v2, Claude-like workflow)

A Manifest V3 Chrome extension that provides a Claude-style browser-assistant workflow for OpenClaw.

> This project is **inspired by publicly documented behaviors** of Claude for Chrome, but does **not** copy Anthropic proprietary code, branding assets, or internal APIs.

## What it can do

### Popup actions
1. **Attach current tab** / detach tab
2. **Snapshot page** (structured page analysis)
3. **Understand page** (intent + key controls/forms/errors)
4. **Auto-help suggestions** (next best action list)
5. **Run action command** (lightweight helper commands)

### Content analysis module (content script)
Collects:
- headings (`h1/h2/h3`)
- visible links/buttons
- forms and inputs
- visible alerts/errors
- dominant page type signals (login/dashboard/article/checkout/general)

### Background orchestration
- Per-tab attach state tracking
- Per-tab metadata tracking (`title`, `url`, timestamps)
- Badge status (`ON`/`OFF`) by tab
- Configurable relay endpoint health ping

### Relay integration + local fallback
- Relay endpoint is configurable in popup settings
- If relay is unavailable, extension still works with **local analysis + local suggestions + local action command execution**

---

## Public references used (research basis)

Primary sources reviewed:
1. Claude product page: https://claude.com/claude-for-chrome
2. Chrome Web Store listing (Claude): https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn
3. Engadget coverage summary: https://www.engadget.com/ai/claudes-chrome-plugin-is-now-available-to-all-paid-users-221024295.html

Feature themes extracted from public docs/listing:
- browser navigation + clicking + form filling via natural language
- workflow automation / multi-step tasks
- optional planning & workflow recording concepts
- integration with Claude Code / desktop workflow concepts
- safety emphasis around prompt-injection and risky actions

---

## Limitations vs official Claude extension

This extension does **not** currently include:
- cloud-hosted agent planning/execution engine
- true multi-tab autonomous workflows
- workflow recording/playback
- scheduled workflow runner
- Claude account auth/subscription integration
- enterprise admin controls (allowlist/blocklist/org policy)
- deep console/network debugging pipeline like official product claims

Instead, this project provides a practical, open, local-first relay UX for OpenClaw.

---

## Project structure

```text
openclaw-chrome-extension/
├── manifest.json
├── README.md
└── src/
    ├── background.js
    ├── content.js
    ├── popup.css
    ├── popup.html
    └── popup.js
```

---

## Install (Load unpacked)

1. Open Chrome: `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select folder: `openclaw-chrome-extension/`
5. Pin extension to toolbar

---

## Test steps

1. Open any regular website tab (`https://...`)
2. Open popup and click **Ping**
   - if relay is reachable: status shows `relay:online`
   - if not reachable: status shows `relay:offline` (local mode still usable)
3. Click **Attach current tab**
   - badge becomes `ON`
   - page marker appears in bottom-right
4. Click **Snapshot page**
   - output shows structured analysis JSON
5. Click **Understand page**
   - output includes intent + key controls + errors
6. Click **Auto-help suggestions**
   - output includes next-step suggestions
7. Run command examples:
   - `click sign in`
   - `type email = alice@example.com`
   - `go to example.com`
   - `back`

---

## Relay endpoint contract (best-effort)

Used endpoints (optional):
- `GET /health` (connectivity)
- `POST /attach`
- `POST /understand` (optional enhancement)
- `POST /suggest` (optional enhancement)
- `POST /action` (optional enhancement)

If optional endpoints are missing/unavailable, local fallback is used.

---

## Troubleshooting

### 1) "No active tab" or command failures
- Open a normal `http/https` tab first
- `chrome://` pages cannot run content scripts

### 2) Snapshot/understand fails
- Reload page, then retry
- Verify content script is allowed on site

### 3) Badge not updating
- Switch tabs once or reload the page
- Check service worker logs in `chrome://extensions`

### 4) Relay always offline
- Verify relay process and endpoint URL
- Confirm endpoint responds to `GET /health`

### 5) Command didn’t click/type expected target
- Use more specific target text
- Check if target is visible and interactable

---

## Development notes

- Manifest V3 (`background.service_worker` as module)
- No proprietary third-party assets bundled
- Local-first fallback behavior for resilience

## Validate syntax locally

From this project directory:

```bash
node --check src/background.js
node --check src/content.js
node --check src/popup.js
python -m json.tool manifest.json >/dev/null
```
