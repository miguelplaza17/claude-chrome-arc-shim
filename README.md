# claude-chrome-arc-shim

Run the official **Claude in Chrome** extension in the **Arc** browser on macOS.

> **Unofficial.** This project is not affiliated with, endorsed by or supported by Anthropic or The Browser Company. It does not contain or redistribute any Anthropic code: the scripts download the official extension from the Chrome Web Store on your own machine, verify its signature and patch it locally. Modifying the extension may be against Anthropic's terms; read them and decide for yourself. Use at your own risk.

## Paste to your AI

If you use an AI coding agent with shell access (Claude Code, Codex, Cursor and similar), paste this and it will do the install for you:

```text
Install claude-chrome-arc-shim for me, which makes the Claude in Chrome extension work in the Arc browser on macOS: https://github.com/miguelplaza17/claude-chrome-arc-shim

Clone it into a folder I will keep (it is where Arc loads the extension from, so not a temp folder), then read AGENTS.md in the repo and follow it step by step. Explain what each step does, and ask me before anything that changes my browser or schedules a background job.
```

## Why it doesn't work in Arc

Arc is built on Chromium but leaves out or stubs some extension APIs the extension depends on:

| What Arc does | Symptom | What the shim does |
| --- | --- | --- |
| `chrome.sidePanel` exists, but `open()` does nothing | Clicking the icon does nothing, or shows "Browser not supported" | Opens the panel in a regular tab right after the site, ready for Arc's Split View |
| `chrome.tabs.group` exists, but never resolves | Every browser action hangs | Emulates tab groups in `chrome.storage.session` |
| (consequence of the above) The extension trusts the panel only when the sender has no tab | "Can't reach the Claude extension" inside the panel | Treats everything running inside the panel tab (the panel page and its claude.ai iframe) as the side panel |
| (consequence of the above) The panel page refuses to run outside a side panel | Blank or refused panel | Makes `chrome.tabs.getCurrent()` return `undefined`, as it does in a real side panel |

Because the panel lives in a tab, it also **follows the active tab**: Claude acts on the last site tab you activated in each window, and claude.ai is told which tab that is whenever it changes. You can move Claude between tabs freely, across several windows.

## Requirements

- macOS with Arc
- `python3`, `perl`, `openssl` (all ship with macOS; the Xcode Command Line Tools provide `python3`)
- `node`, only to run the tests (optional)

## Install by hand

1. Clone this repo somewhere permanent. Arc loads the extension from inside it.
2. Run `./update.sh --force`. It downloads the extension, verifies it and builds `claude-arc/`.
3. In Arc, open `arc://extensions`. If the Claude extension from the Chrome Web Store is installed, **remove it**: both copies share the same ID.
4. Turn on **Developer mode**, click **Load unpacked** and choose the `claude-arc/` folder inside this repo.
5. Optional: run `launchd/install.sh` to check for updates every Monday at 10:00.

To use it, open a normal website (not an `arc://` or `chrome://` page) and click the Claude icon. A Claude tab opens next to it. To see both side by side, select both tabs (Cmd-click), right-click them and choose Split View.

## Updates

`./update.sh` (run weekly by `launchd/install.sh`, or by hand) works like this:

1. Downloads the latest version from Google's update service, the one Chrome itself uses.
2. Checks that the package's developer key matches the extension ID, and verifies the developer's RSA signature with `openssl`.
3. If the version is new, runs `scripts/check_compat.sh`. If something the shim relies on has changed, it stops there and Arc keeps the previous build.
4. Rebuilds `claude-arc/` (swapping it in only at the end) and runs the tests.
5. Arc reloads the extension the next time its service worker wakes up (`polyfills/autoreload.js` compares `build-id.txt`). Nothing to click.

Results show up as a macOS notification and in `logs/update.log`. To remove the schedule, run `launchd/install.sh --uninstall`.

If an update is rejected by the compatibility check, the extension changed in a way the polyfills don't handle yet. The log names the missing hook and the polyfill that depends on it. See AGENTS.md for how to adapt it, or open an issue.

## Repository layout

```
polyfills/              code injected into the extension, before its own code
scripts/fetch_crx.py    downloads and verifies the extension from the Chrome Web Store
scripts/check_compat.sh checks that a new version still has what the polyfills hook into
build.sh                builds claude-arc/ from the newest version in source/
update.sh               checks for a new version, then downloads, builds and tests it
tests/                  polyfill tests (Node, with a fake chrome API)
launchd/install.sh      weekly schedule for update.sh
source/                 downloaded versions (not in git)
claude-arc/             the extension Arc loads (not in git)
```

## Known limitations

- The panel is a tab, not a docked side panel. Arc has no API to open Split View, so you have to put the tabs side by side yourself.
- The title at the top of the panel may keep showing the tab the panel was opened from, even after it starts following another one.
- Pages like `arc://` and `chrome://` can't be read or captured, as in Chrome.
- Only tested on macOS.

## License

MIT, for the code in this repository only (see LICENSE). The Claude in Chrome extension belongs to Anthropic and is not covered by this license.
