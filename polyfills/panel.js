// Runs in the panel page (sidepanel.html), before the extension's own code.
// globalThis.__shimMode comes from shim-mode.js (see sidepanel.js).
{
  const mode = globalThis.__shimMode ?? "arc";
  const panelUrl = chrome.runtime.getURL("sidepanel.html");
  const params = new URLSearchParams(location.search);
  const anchorTabId = () => Number(new URLSearchParams(location.search).get("tabId"));
  let windowId;
  const windowReady = chrome.windows
    .getCurrent()
    .then((w) => (windowId = w.id))
    .catch(() => undefined);

  // The panel page refuses to run inside a regular tab; in a real side panel
  // chrome.tabs.getCurrent() resolves to undefined, so mimic that here.
  Object.defineProperty(chrome.tabs, "getCurrent", { value: async () => undefined, writable: true, configurable: true });

  // Crest: the global panel always loads plain "sidepanel.html", but the
  // extension expects "?tabId=N". Use the window's active tab, then start the
  // extension's code, which build.sh parked in <script id="shim-entry">.
  let tabReady = windowReady;
  if (mode === "crest") {
    const start = () => {
      const entry = document.getElementById("shim-entry");
      if (!entry) return;
      const script = document.createElement("script");
      script.type = "module";
      script.crossOrigin = "";
      script.src = entry.dataset.src;
      document.head.appendChild(script);
    };
    tabReady = windowReady
      .then(async () => {
        if (params.has("tabId") || windowId == null) return;
        const [tab] = await chrome.tabs.query({ active: true, windowId });
        if (!tab || tab.url?.startsWith(panelUrl)) return;
        params.set("tabId", String(tab.id));
        history.replaceState(null, "", `${location.pathname}?${params}`);
      })
      .catch(() => {});
    tabReady.then(() => {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
      else start();
    });
  }

  // A native side panel has no tab, so the service worker can't tell which
  // window a panel message comes from. Send it along (sidepanel.js reads it).
  const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
  Object.defineProperty(chrome.runtime, "sendMessage", {
    value: (...args) => {
      const i = typeof args[0] === "string" ? 1 : 0;
      const type = args[i]?.type;
      if ((type === "CIC_IFRAME_TOOL_CALL" || type === "CIC_IFRAME_BRIDGE_INIT") && windowId != null) {
        args[i] = { ...args[i], __shimWindowId: windowId };
      }
      return sendMessage(...args);
    },
    writable: true,
    configurable: true,
  });

  // Tell claude.ai about the tab the panel is following (see FOLLOW_KEY in
  // sidepanel.js), not the one it was opened from. claude.ai learns the
  // current tab from "CURRENT_TAB" parent events sent over the bridge's
  // MessagePort, so rewrite those and send a fresh one whenever it changes.
  const FOLLOW_KEY = "__arcFollowedTabs";
  const SPLIT_KEY = "__shimSplitTabs"; // other tabs visible beside it in a split view
  let followedTabId = anchorTabId();
  let splitTabIds = [];
  let bridgePort = null;
  let current = null; // { tabId, title, url } as the extension formats it

  const cleanUrl = (url) => {
    if (!url) return url;
    try {
      const u = new URL(url);
      u.username = u.password = u.search = u.hash = "";
      return u.toString();
    } catch {
      return "[unparseable url]";
    }
  };
  const cleanTitle = (title) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(title) ? cleanUrl(title) : title);
  const describe = (tab) => ({ tabId: tab.id, title: cleanTitle(tab.title ?? ""), url: cleanUrl(tab.url ?? "") });

  const postMessage = MessagePort.prototype.postMessage;
  const isCurrentTabEvent = (msg) => msg?.type === "PARENT_EVENT" && msg.eventName === "CURRENT_TAB";
  Object.defineProperty(MessagePort.prototype, "postMessage", {
    value: function (msg, ...rest) {
      if (isCurrentTabEvent(msg)) {
        bridgePort = this;
        if (current) msg = { ...msg, data: current };
      }
      return postMessage.call(this, msg, ...rest);
    },
    writable: true,
    configurable: true,
  });

  // CURRENT_TAB holds a single tab, so tabs shown beside it in a split view go
  // in its title, with their ids so Claude can act on them.
  const withSplit = async (info) => {
    const others = [];
    for (const id of splitTabIds.filter((id) => id !== info.tabId)) {
      try {
        const t = describe(await chrome.tabs.get(id));
        others.push(`tab ${t.tabId} "${t.title}" (${t.url})`);
      } catch {}
    }
    if (!others.length) return info;
    const note = `split view: also on screen and in your tab group, so you can read and use it: ${others.join("; ")}`;
    return { ...info, title: `${info.title} [${note}]` };
  };
  const announce = async () => {
    let tab;
    try {
      tab = await chrome.tabs.get(followedTabId);
    } catch {
      return;
    }
    current = await withSplit(describe(tab));
    if (bridgePort) postMessage.call(bridgePort, { type: "PARENT_EVENT", eventName: "CURRENT_TAB", data: current });
  };
  const follow = (followed) => {
    const next = (windowId != null ? followed?.[windowId] : undefined) ?? anchorTabId();
    if (next === followedTabId && current) return;
    followedTabId = next;
    announce();
  };

  const setSplit = (split) => {
    const next = (windowId != null ? split?.[windowId] : undefined) ?? [];
    if (JSON.stringify(next) === JSON.stringify(splitTabIds)) return false;
    splitTabIds = next;
    return true;
  };

  tabReady
    .then(() => chrome.storage.session.get([FOLLOW_KEY, SPLIT_KEY]))
    .then((r) => {
      setSplit(r[SPLIT_KEY]);
      follow(r[FOLLOW_KEY]);
    })
    .catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "session") return;
    const splitChanged = SPLIT_KEY in changes && setSplit(changes[SPLIT_KEY].newValue);
    if (FOLLOW_KEY in changes) follow(changes[FOLLOW_KEY].newValue);
    if (splitChanged && !(FOLLOW_KEY in changes)) announce();
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    const shown = tabId === followedTabId || splitTabIds.includes(tabId);
    if (shown && (info.title !== undefined || info.url !== undefined)) announce();
  });
}
