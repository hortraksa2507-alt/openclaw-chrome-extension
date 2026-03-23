# OpenClaw Chrome Extension (v3)

A Manifest V3 Chrome extension for OpenClaw browser relay workflows, now with voice command input, in-popup action history, and safe autopilot.

> Inspired by public Claude-for-Chrome workflows, but implemented as an independent local-first OpenClaw extension.

## What’s new in v3

1. **Voice command input in popup**
   - Uses Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) when available.
   - Graceful fallback: mic button disables with clear hint if unsupported.

2. **Action history in popup**
   - Tracks recent actions with status (`ok` / `warn` / `error`) and timestamps.
   - Includes **Clear** button.
   - Persists in extension local storage (last 40 actions).

3. **One-click Safe Autopilot**
   - Analyzes current page context.
   - Proposes low-risk and risky actions.
   - Automatically executes only low-risk steps.
   - Risky actions (`submit/delete/payment/send/...`) are listed and require explicit click confirmation before execution.

4. **UX polish**
   - Cleaner v3 popup layout, clearer section labels, status visibility, and compact history/risky lists.

## Existing features kept (v2 compatibility)

- Attach/detach current tab
- Snapshot page
- Understand page
- Auto-help suggestions
- Manual action command runner (`click`, `type`, `go to`, `back`, etc.)
- Relay endpoint setting + ping
- Local fallback if relay is offline
- MV3 service worker + content-script architecture

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

## Install (Load unpacked)

1. Open Chrome: `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select folder: `openclaw-chrome-extension/`
5. Pin extension to toolbar

## v3 usage quick guide

### Voice commands
1. Open popup
2. Tap mic button (🎙️)
3. Speak command (example: “click sign in”)
4. Transcript appears in command box, then click **Run command**

### Safe autopilot
1. Open popup on the desired page
2. Click **Run safe autopilot**
3. Extension executes low-risk steps only
4. If risky actions are found, each appears with **Confirm & run**

### Action history
- Review last actions in **Action history** section
- Click **Clear** to wipe stored history

## Relay endpoint contract (optional)

Used endpoints:
- `GET /health`
- `POST /attach`
- `POST /understand` (optional enhancement)
- `POST /suggest` (optional enhancement)
- `POST /action` (optional enhancement)

If relay is unavailable, extension runs local fallback logic.

## Validation / syntax checks

From project directory:

```bash
node --check src/background.js
node --check src/content.js
node --check src/popup.js
python3 -m json.tool manifest.json >/dev/null
```

## Troubleshooting

- **No active tab**: use a normal `http/https` page (`chrome://` pages are restricted)
- **Voice input unavailable**: browser/Web Speech support may be missing; type command manually
- **Autopilot found risky actions only**: confirm risky entries manually or run command yourself
- **Badge not updating**: switch tab or reload
- **Relay offline**: verify endpoint and `GET /health`
