# OpenClaw Chrome Extension (Browser Relay)

A minimal Manifest V3 Chrome extension that provides a Claude-style convenience flow for attaching your current tab to OpenClaw.

## Features

- **Popup UI** with:
  - Attach status
  - **Quick connect** button
  - Current tab attach toggle
  - Basic diagnostics text
- **Content script + service worker messaging** for per-tab attach state
- Configurable **OpenClaw relay endpoint** (default: `http://127.0.0.1:7331`)
- **Badge ON/OFF** state on the extension icon (per active tab)

## Project Structure

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

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `openclaw-chrome-extension/`
5. Pin the extension to your toolbar for easier access

## Usage

1. Open the extension popup.
2. (Optional) Set your relay endpoint and click **Save endpoint**.
3. Click **Quick connect** to test relay health and auto-attach current tab on success.
4. Toggle **Attach** to manually set attach state for current tab.
5. Check diagnostics text for relay connectivity details.

## Permissions Explained

- `storage`: save endpoint + attach state + diagnostics
- `tabs` / `activeTab`: identify and control current tab attach status
- Host permissions (`http://127.0.0.1/*`, `http://localhost/*`): talk to local OpenClaw relay endpoints
- Content script on `http/https`: display attach marker and sync state with background worker

## Relay Endpoint Contract (expected)

This extension calls:

- `GET {endpoint}/health` for quick diagnostics
- `POST {endpoint}/attach` (best effort) when tab attach state changes

If your relay uses a different API shape, adjust `src/background.js` accordingly.

## Verification / Smoke Test

After loading unpacked:

1. Confirm extension loads with no manifest errors in `chrome://extensions`.
2. Open popup and click **Quick connect**.
3. If relay is reachable, status should show connected and badge should change to `ON` when attached.
4. Toggle attach off/on and verify:
   - Badge switches `OFF` / `ON`
   - Small page marker appears/disappears in the bottom-right corner.
5. Reload a tab and ensure state remains consistent.

## Package for Release

From workspace root:

```bash
cd /Users/raksa/.openclaw/workspace
zip -r openclaw-chrome-extension.zip openclaw-chrome-extension
```

Then publish the ZIP as a GitHub release asset or share directly.

## Troubleshooting

- **UNREACHABLE diagnostics**:
  - Ensure OpenClaw relay is running locally.
  - Verify endpoint host/port in popup.
  - Check CORS/network restrictions on relay server.
- **Badge not updating**:
  - Refresh tab and reopen popup.
  - Check extension service worker in `chrome://extensions` → "service worker" logs.
- **No page marker**:
  - Verify content script is allowed on that URL.
  - Some browser internal pages (`chrome://`) do not allow content scripts.

## Security Notes

- No secrets are hardcoded.
- Endpoint is user-configurable and stored locally in extension storage.
- Extension scopes network access only to localhost by default.
