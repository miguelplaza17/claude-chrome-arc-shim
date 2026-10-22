// Runs in the panel page (sidepanel.html), before the extension's own code.
{
  const getCurrentTab = chrome.tabs.getCurrent.bind(chrome.tabs);

  // The panel page refuses to run inside a regular tab; in a real side panel
  // chrome.tabs.getCurrent() resolves to undefined, so mimic that here.
  Object.defineProperty(chrome.tabs, "getCurrent", { value: async () => undefined, writable: true, configurable: true });

  // Tell claude.ai about the tab the panel is following (see FOLLOW_KEY in
  // sidepanel-polyfill.js), not the one it was opened from. claude.ai learns
  // the current tab from "CURRENT_TAB" parent events sent over the bridge's
  // MessagePort, so rewrite those and send a fresh one whenever it changes.
  const FOLLOW_KEY = "__arcFollowedTabs";
  const anchorTabId = Number(new URLSearchParams(location.search).get("tabId"));
  let windowId;
  let followedTabId = anchorTabId;
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

  const announce = async () => {
    let tab;
    try {
      tab = await chrome.tabs.get(followedTabId);
    } catch {
      return;
    }
    current = describe(tab);
    if (bridgePort) postMessage.call(bridgePort, { type: "PARENT_EVENT", eventName: "CURRENT_TAB", data: current });
  };
  const follow = (followed) => {
    const next = (windowId != null ? followed?.[windowId] : undefined) ?? anchorTabId;
    if (next === followedTabId && current) return;
    followedTabId = next;
    announce();
  };

  getCurrentTab()
    .then((tab) => {
      windowId = tab?.windowId;
      return chrome.storage.session.get(FOLLOW_KEY);
    })
    .then((r) => follow(r[FOLLOW_KEY]))
    .catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && FOLLOW_KEY in changes) follow(changes[FOLLOW_KEY].newValue);
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (tabId === followedTabId && (info.title !== undefined || info.url !== undefined)) announce();
  });
}
