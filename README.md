# claude-chrome-arc-shim

Run the official **Claude in Chrome** extension in the **Arc** browser, and get a side panel that follows you across tabs and split views in **Crest**, on macOS.

> **Unofficial.** This project is not affiliated with, endorsed by or supported by Anthropic, The Browser Company or Crest. It does not contain or redistribute any Anthropic code: the scripts download the official extension from the Chrome Web Store on your own machine, verify its signature and patch it locally. Modifying the extension may be against Anthropic's terms; read them and decide for yourself. Use at your own risk.

## Paste to your AI

If you use an AI coding agent with shell access (Claude Code, Codex, Cursor and similar), paste this and it will do the install for you:

```text
Install claude-chrome-arc-shim for me, which patches the Claude in Chrome extension to work in the Arc browser and to follow tabs and split views in the Crest browser, on macOS: https://github.com/miguelplaza17/claude-chrome-arc-shim

Clone it into a folder I will keep (it is where the browser loads the extension from, so not a temp folder), then read AGENTS.md in the repo and follow it step by step. Ask me which browser I use (Arc or Crest). Explain what each step does, and ask me before anything that changes my browser or schedules a background job.
```

## What you get

**In Arc**, the extension doesn't work at all without this (see below). With it, the panel opens in a tab next to the site, ready for Arc's Split View.

**In Crest**, the extension works out of the box, but its side panel belongs to a single tab: switch tabs and it's gone, along with the conversation. With the `crest` build, the native side panel stays open across tabs and keeps the conversation.

**In both**, the panel follows you:

- Claude acts on the site tab you last used in each window, not the one the panel was opened from, and is told whenever it changes.
- In a split view, every tab on screen is in Claude's tab group, and Claude is told about all of them from the start, so it can read and use each one.
- Your tabs are never moved around. Claude's tab group is emulated rather than a real (orange) group.

## Why it doesn't work in Arc

Arc is built on Chromium but leaves out or stubs some extension APIs the extension depends on:

| What Arc does | Symptom | What the shim does |
| --- | --- | --- |
| `chrome.sidePanel` exists, but `open()` does nothing | Clicking the icon does nothing | Opens the panel in a regular tab right after the site |
| `chrome.tabs.group` exists, but never resolves | Every browser action hangs | Emulates tab groups in `chrome.storage.session` |
| (consequence of the above) The extension trusts the panel only when the sender has no tab | "Can't reach the Claude extension" inside the panel | Treats everything running inside the panel tab (the panel page and its claude.ai iframe) as the side panel |
| (consequence of the above) The panel page refuses to run outside a side panel | Blank or refused panel | Makes `chrome.tabs.getCurrent()` return `undefined`, as it does in a real side panel |

## How the Crest build works

- **Global panel:** the extension sets a per-tab panel path (`sidepanel.html?tabId=N`) on every click. The shim makes the panel global with one fixed path, so the open panel never reloads. When it loads, it picks the window's active tab and only then starts the extension's code.
- **Split view detection:** Crest doesn't report its split view to extensions (`splitViewId` stays `-1`), but a tab on screen has a visible document even when it isn't the active tab. When the active tab is narrower than its window, the shim checks which other site tabs are visible.

## Requirements

- macOS with Arc or Crest
- `python3`, `perl`, `openssl` (all ship with macOS; the Xcode Command Line Tools provide `python3`)
- `node`, only to run the tests (optional)

## Install by hand

1. Clone this repo somewhere permanent. The browser loads the extension from inside it.
2. Optional: edit `targets` to list only the browsers you use (`arc`, `crest`).
3. Run `./update.sh --force`. It downloads the extension, verifies it and builds `claude-arc/` and/or `claude-crest/`.
4. In your browser, open the extensions page (`arc://extensions` in Arc, `chrome://extensions` in Crest). If the Claude extension from the Chrome Web Store is installed, **remove it**: both copies share the same ID.
5. Turn on **Developer mode**, click **Load unpacked** and choose `claude-arc/` (Arc) or `claude-crest/` (Crest) inside this repo.
6. Optional: run `launchd/install.sh` to check for updates every Monday at 10:00.

To use it, open a normal website (not an `arc://` or `chrome://` page) and click the Claude icon. In Arc, a Claude tab opens next to the site: to see both side by side, select both tabs (Cmd-click), right-click them and choose Split View. In Crest, the side panel opens and stays with you as you switch tabs.

## Updates

`./update.sh` (run weekly by `launchd/install.sh`, or by hand) works like this:

1. Downloads the latest version from Google's update service, the one Chrome itself uses.
2. Checks that the package's developer key matches the extension ID, and verifies the developer's RSA signature with `openssl`.
3. If the version is new, runs `scripts/check_compat.sh`. If something the shim relies on has changed, it stops there and your browser keeps the previous build.
4. Rebuilds each browser in `targets` (swapping each build in only at the end) and runs the tests.
5. The browser reloads the extension the next time its service worker wakes up (`polyfills/autoreload.js` compares `build-id.txt`). Nothing to click.

Results show up as a macOS notification and in `logs/update.log`. To remove the schedule, run `launchd/install.sh --uninstall`.

If an update is rejected by the compatibility check, the extension changed in a way the polyfills don't handle yet. The log names the missing hook and the polyfill that depends on it. See AGENTS.md for how to adapt it, or open an issue.

## Repository layout

```
polyfills/              code injected into the extension, before its own code
scripts/fetch_crx.py    downloads and verifies the extension from the Chrome Web Store
scripts/check_compat.sh checks that a new version still has what the polyfills hook into
build.sh                builds claude-arc/ or claude-crest/ (./build.sh arc|crest)
targets                 browsers update.sh builds for
update.sh               checks for a new version, then downloads, builds and tests it
tests/                  polyfill tests (Node, with a fake chrome API)
launchd/install.sh      weekly schedule for update.sh
source/                 downloaded versions (not in git)
claude-arc/, claude-crest/  the extension your browser loads (not in git)
```

## Known limitations

- Arc: the panel is a tab, not a docked side panel, and Arc has no API to open Split View, so you put the tabs side by side yourself. The title at the top of the panel may keep showing the tab it was opened from.
- Split detection relies on page visibility: a window covered by another app reports its pages as hidden. The shim checks again when the window regains focus.
- Pages like `arc://` and `chrome://` can't be read or captured, as in Chrome.
- Only tested on macOS.

## License

MIT, for the code in this repository only (see LICENSE). The Claude in Chrome extension belongs to Anthropic and is not covered by this license.
