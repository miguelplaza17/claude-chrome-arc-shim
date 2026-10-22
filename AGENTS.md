# Instructions for AI agents

You are helping a user run the Claude in Chrome extension in the Arc browser, or get a tab- and split-following side panel in the Crest browser, with this repository. Read README.md first for what it does and why. Follow the steps in order, tell the user what each one does, and stop to ask where this says to.

Some steps are for the user only: you cannot click inside Arc. Give them the exact clicks and wait for them to confirm.

## 1. Check the environment

- macOS only. If the user is on Windows or Linux, say this repo doesn't support it and stop.
- Ask which browser they use: Arc (`/Applications/Arc.app`) or Crest (`/Applications/Crest.app`). Write only that one in `targets` (`arc` or `crest`, one per line).
- `python3 --version`, `perl -v` and `openssl version` must work. If `python3` is missing, the user can install the Xcode Command Line Tools (`xcode-select --install`); ask before running it.
- `node` is optional. It is only needed for `tests/run.sh`.

## 2. Put the repo somewhere permanent

The browser loads the extension straight from `claude-arc/` or `claude-crest/` inside this repo. If the repo is in a temporary or scratch folder, ask the user where to keep it and clone or move it there before going on. Don't clone into Downloads or `/tmp`.

## 3. Build the extension

```bash
./update.sh --force
tail -5 logs/update.log
```

This downloads the official extension from the Chrome Web Store, verifies its signature, applies the polyfills and builds `claude-<target>/` for each browser in `targets`. The log should end with `updated  -> <version>` (the first version is empty on a fresh clone). If it fails, see Troubleshooting. Never weaken or skip the signature check to get past an error.

## 4. Load it in the browser (user steps)

Give the user these steps and the absolute path of `claude-arc/` (Arc) or `claude-crest/` (Crest):

1. Open `arc://extensions` (Arc) or `chrome://extensions` (Crest).
2. If "Claude" from the Chrome Web Store is installed, click **Remove** on it. This copy has the same ID, and the two would conflict. They may need to sign in to Claude again afterwards.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose that folder. In the file picker, Cmd+Shift+G lets them paste the path.

## 5. Check that it works (user steps)

Ask the user to:

1. Open a normal website (not `arc://` or `chrome://`) and click the Claude icon in the toolbar. In Arc a Claude tab opens right after it; in Crest the side panel opens.
2. Sign in if asked, and send a message such as "what page am I on?".
3. Switch to another tab and ask again: Claude should follow it (in Crest, the panel stays open with the same conversation).
4. Optionally, put two site tabs in a split view, click one side, and ask "which tabs do you see?" in a new conversation. Claude should list both and be able to use them.

If the panel shows an error, ask for the red lines in two consoles: the Claude tab (right-click, **Inspect**, **Console**) and the extension's service worker (`arc://extensions`, the **service worker** link on the Claude card).

## 6. Offer automatic updates (ask first)

`launchd/install.sh` installs a launchd agent (`local.claude-chrome-arc-shim.update`) that runs `update.sh` every Monday at 10:00. This is a background job on the user's Mac, so explain it and ask before running it. It can be removed with `launchd/install.sh --uninstall`. If the repo is moved later, it has to be run again, and the extension loaded again from the new path.

## Troubleshooting

- **`fetch_crx` errors in the log:** run `python3 -I scripts/fetch_crx.py fcoeoabgfenejglbffodgkkbkcdhcgfn "$(mktemp -d)"` to see the error. Usually there's no network, or Google changed the download endpoint or the CRX format.
- **`missing: ...` lines from `check_compat.sh`:** the extension changed in a way the polyfills don't handle yet. See "Adapting to a new extension version" below.
- **Arc still runs the old build:** the auto-reload only happens when the service worker wakes up. Switching tabs usually wakes it, or the user can click the reload button on the Claude card in `arc://extensions`.
- **"Can't reach the Claude extension":** the panel isn't being recognised as the side panel. Check the service worker console for `sender is not an extension page`, and whether `get_sidepanel_host_info` is handled in `polyfills/sidepanel.js` for the current version.
- **Every action hangs:** tab groups aren't being emulated. Check that `service-worker-loader.js` in `claude-arc/` or `claude-crest/` imports `tabgroups-polyfill.js` before the extension's code.

## Adapting to a new extension version

The extension's code in `source/<version>/assets/` is minified JavaScript. To find something, search it with Python's `re` and print about 500 characters around each match. Compare with the previous version in `source/` to see what changed.

What each polyfill hooks into:

- `polyfills/sidepanel.js`: `chrome.sidePanel.open/setOptions` (Arc replaces them; Crest makes `setOptions` global with a fixed path); `chrome.runtime.getContexts` with `ContextType.SIDE_PANEL`; the service worker's "no tab" sender checks (`void 0===e.tab&&e.id===chrome.runtime.id`, and `get_sidepanel_host_info` in `onMessageExternal`); the `CIC_IFRAME_TOOL_CALL` message with `panelTabId` and `tabGroupId` (following the active tab) and the `CIC_IFRAME_BRIDGE_INIT` reply with `tabGroupId` (joining on-screen tabs early); split detection via `chrome.scripting.executeScript` reading `document.visibilityState`.
- `polyfills/panel.js`: the panel's refusal to run via `chrome.tabs.getCurrent()`; the `PARENT_EVENT` / `CURRENT_TAB` events sent to claude.ai over a `MessagePort`; in Crest, the `?tabId=` it adds before starting the panel's entry script, which `build.sh` parks in `<script id="shim-entry">`.
- `polyfills/tabgroups.js`: `chrome.tabs.group/ungroup`, `chrome.tabGroups.get/query/update`, and `chrome.tabs.query({groupId})`.
- `polyfills/autoreload.js`: `build-id.txt`, written by `build.sh`.
- `shim-mode.js` (written by `build.sh`) sets `globalThis.__shimMode` to `arc` or `crest` for the polyfills.

After a change: update the matching string in `scripts/check_compat.sh` if it moved, add or update a test in `tests/`, run `tests/run.sh`, then `./update.sh --force`, and ask the user to test in Arc again.

## Rules

- Never commit or publish `source/`, `claude-arc/` or `claude-crest/`: they contain Anthropic's code.
- Never disable the signature verification in `scripts/fetch_crx.py`.
- Don't edit files inside `claude-arc/` or `claude-crest/` by hand. Change `polyfills/` or `build.sh` and rebuild.
