// Emulates chrome.sidePanel for Arc by opening the panel page as a regular tab
// right after the site's tab, so it can sit beside it in Arc's Split View.
// Arc exposes a sidePanel object whose open() silently does nothing, so always
// replace it.
{
  const paths = new Map(); // tabId -> panel path
  let defaultPath = "sidepanel.html";
  const panelUrl = chrome.runtime.getURL("sidepanel.html");
  const isPanel = (url) => !!url?.startsWith(panelUrl);

  const sidePanel = {
    async setOptions({ tabId, path } = {}) {
      if (!path) return;
      if (tabId == null) defaultPath = path;
      else paths.set(tabId, path);
    },
    async getOptions({ tabId } = {}) {
      return { path: paths.get(tabId) ?? defaultPath, enabled: true };
    },
    async setPanelBehavior() {},
    async getPanelBehavior() {
      return { openPanelOnActionClick: false };
    },
    async open({ tabId } = {}) {
      const url = chrome.runtime.getURL(paths.get(tabId) ?? defaultPath);
      // Look the panel up by URL so this survives service worker restarts.
      const existing = (await chrome.tabs.query({})).find((t) => t.url === url);
      if (existing) {
        await chrome.tabs.update(existing.id, { active: true });
        await chrome.windows.update(existing.windowId, { focused: true });
        return;
      }
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.create({ url, windowId: tab.windowId, index: tab.index + 1, active: true });
    },
  };

  Object.defineProperty(chrome, "sidePanel", { value: sidePanel, writable: true, configurable: true });

  // The extension asks getContexts() for SIDE_PANEL contexts to know whether a
  // panel is already open; answer with our panel tabs instead.
  const ContextType = chrome.runtime.ContextType;
  if (!ContextType.SIDE_PANEL) {
    try {
      ContextType.SIDE_PANEL = "SIDE_PANEL";
    } catch {}
  }
  const getContexts = chrome.runtime.getContexts.bind(chrome.runtime);
  const fakeGetContexts = async (filter = {}) => {
    const types = filter.contextTypes;
    if (!types?.includes("SIDE_PANEL")) return getContexts(filter);
    const rest = types.filter((t) => t !== "SIDE_PANEL");
    const real = rest.length ? await getContexts({ ...filter, contextTypes: rest }) : [];
    const fake = (await getContexts({ ...filter, contextTypes: ["TAB"] }))
      .filter((c) => isPanel(c.documentUrl))
      .map((c) => ({ ...c, contextType: "SIDE_PANEL", tabId: -1 }));
    return [...real, ...fake];
  };
  Object.defineProperty(chrome.runtime, "getContexts", { value: fakeGetContexts, writable: true, configurable: true });

  // A real side panel has no tab, and the service worker only trusts panel
  // senders without one: the panel page itself ("sender is not an extension
  // page") and the claude.ai iframe inside it (get_sidepanel_host_info). Strip
  // the tab from anything running inside our panel tab.
  const asPanel = (sender) => {
    if (!isPanel(sender?.tab?.url)) return sender;
    const { tab, ...rest } = sender;
    return rest;
  };
  const wrapEvent = (event, wrap) => {
    const wrapped = new WeakMap();
    const { addListener, removeListener, hasListener } = event;
    const patchFn = (name, fn) => Object.defineProperty(event, name, { value: fn, writable: true, configurable: true });
    patchFn("addListener", function (cb, ...rest) {
      if (!wrapped.has(cb)) wrapped.set(cb, wrap(cb));
      return addListener.call(this, wrapped.get(cb), ...rest);
    });
    patchFn("removeListener", function (cb) {
      return removeListener.call(this, wrapped.get(cb) ?? cb);
    });
    patchFn("hasListener", function (cb) {
      return hasListener.call(this, wrapped.get(cb) ?? cb);
    });
  };
  // Follow the user: a panel opened for one tab acts on whichever site tab was
  // last active in its window (e.g. the other side of a Split View), instead
  // of staying pinned to the tab it was opened from.
  const FOLLOW_KEY = "__arcFollowedTabs";
  let followed = {}; // windowId -> tabId
  chrome.storage.session
    .get(FOLLOW_KEY)
    .then((r) => (followed = { ...r[FOLLOW_KEY], ...followed }))
    .catch(() => {});
  chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
    try {
      if (isPanel((await chrome.tabs.get(tabId)).url)) return;
    } catch {
      return;
    }
    followed[windowId] = tabId;
    chrome.storage.session.set({ [FOLLOW_KEY]: followed }).catch(() => {});
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    for (const [windowId, id] of Object.entries(followed)) if (id === tabId) delete followed[windowId];
    chrome.storage.session.set({ [FOLLOW_KEY]: followed }).catch(() => {});
  });
  const retarget = (message, sender) => {
    if (message?.type !== "CIC_IFRAME_TOOL_CALL" || !isPanel(sender?.tab?.url)) return message;
    const target = followed[sender.tab.windowId];
    if (target == null || target === message.panelTabId) return message;
    if (!globalThis.__arcJoinTabGroup?.(target, message.tabGroupId)) return message;
    return { ...message, panelTabId: target };
  };

  const withPanelSender = (cb) => (message, sender, sendResponse) =>
    cb(retarget(message, sender), asPanel(sender), sendResponse);
  wrapEvent(chrome.runtime.onMessage, withPanelSender);
  wrapEvent(chrome.runtime.onMessageExternal, withPanelSender);
  wrapEvent(chrome.runtime.onConnect, (cb) => (port) => {
    const sender = asPanel(port.sender);
    if (sender === port.sender) return cb(port);
    try {
      Object.defineProperty(port, "sender", { value: sender, configurable: true });
    } catch {}
    if (port.sender === sender) return cb(port);
    // sender is read-only on this port: hand out a stand-in that inherits
    // everything else from it.
    return cb(
      Object.create(port, {
        sender: { value: sender },
        postMessage: { value: (...args) => port.postMessage(...args) },
        disconnect: { value: () => port.disconnect() },
      }),
    );
  });
}
