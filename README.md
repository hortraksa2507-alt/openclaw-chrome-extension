# OpenClaw Chrome Extension (v4 Browser Mode)

OpenClaw Browser Mode v4 turns the extension into a persistent browser assistant (side panel primary, popup fallback), not just a small popup utility.

## What v4 adds

### 1) Stable relay handshake layer
- Relay state machine: `connecting` → `online` / `degraded` / `offline`
- Periodic health checks via `chrome.alarms` (`GET /health`)
- Lightweight retry/backoff with `nextRetryAt`
- Structured diagnostics (status code, latency, last error)

### 2) Better command understanding
Natural command plan parser now supports:
- `go to ...`, `navigate to ...`
- `open new tab [url]`
- `click ...`
- `type field = value`, `fill field with value`
- `search ...`
- `summarize page`
- `extract links`
- `extract forms`
- Multi-step chains (`then`, `and then`, `;`)

### 3) Persistent tab context memory
Per-tab memory in local storage:
- last snapshot
- last understanding
- last suggestions
- last plan preview
- recent actions for that tab

When you return to a tab, UI shows that restore context is available.

### 4) Side-panel assistant UX
- Side Panel API is enabled and set as primary experience (`sidepanel.html`)
- Popup remains as fallback (`popup.html`)
- Conversation-like action log + suggested next steps
- Dry-run preview for command plans

### 5) Safety controls
- Risky commands detected (`submit/delete/payment/send/...`)
- Risky flows require explicit **Confirm + run**
- Dry-run plan preview before execution (especially for multi-step commands)

### 6) Backward compatibility kept
Still supports existing flows:
- attach/detach tab
- snapshot
- understand
- suggest
- manual run command
- relay endpoint save + ping

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
    ├── popup.js
    └── sidepanel.html
```

## Install / reload
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** (or click **Reload** if already installed)
4. Select this folder

## Relay contract (optional but recommended)
Used endpoints:
- `GET /health`
- `POST /attach`
- `POST /understand` (optional enhancement)
- `POST /suggest` (optional enhancement)
- `POST /action` (optional enhancement)

If relay is offline, extension falls back to local content-script execution for supported commands.

## Validation

```bash
node --check src/background.js
node --check src/content.js
node --check src/popup.js
python3 -m json.tool manifest.json >/dev/null
```

## Troubleshooting
- **Side panel doesn’t open**
  - Ensure Chrome supports MV3 Side Panel API and extension is reloaded after update.
- **Relay stays offline/degraded**
  - Verify endpoint and that `/health` responds.
  - Check diagnostics in UI (status/latency/error).
- **Command asks for confirmation**
  - Expected for risky actions. Use **Confirm + run**.
- **Page action not found**
  - Command parser matched intent, but element text/label was not found on current DOM. Try snapshot first.
- **No active tab**
  - Use a standard `http/https` tab (not `chrome://` pages).

## Manual configuration still required
- Running OpenClaw relay server on your local endpoint (default: `http://127.0.0.1:7331`)
- Any relay-side implementations for `/understand`, `/suggest`, `/action` enhancements
- Chrome permissions acceptance on first install/reload
