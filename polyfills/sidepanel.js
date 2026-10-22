// Side panel shims for the service worker. globalThis.__shimMode is set by
// shim-mode.js (written by build.sh):
//
// "arc"   Arc exposes a sidePanel object whose open() silently does nothing.
//         Replace it: the panel opens as a regular tab right after the site's
//         tab, ready for Arc's Split View, and everything running inside that
//         tab is treated as the side panel.
// "crest" The native side panel works. Make it one global panel per window
//         that stays open across tabs, instead of one panel per tab.
//
// In both modes the panel follows the user: its tool calls act on the site tab
// last active in its window instead of the tab it was opened from.
{
  const mode = globalThis.__shimMode ?? "arc";
  const panelUrl = chrome.runtime.getURL("sidepanel.html");
  const isPanel = (url) => !!url?.startsWith(panelUrl);

  if (mode === "arc") {
    const paths = new Map(); // tabId -> panel path
    let defaultPath = "sidepanel.html";

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

    // The extension asks getContexts() for SIDE_PANEL contexts to know whether
    // a panel is already open; answer with our panel tabs instead.
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
  } else {
    // The extension sets a per-tab panel path ("sidepanel.html?tabId=N") on
    // every click and then opens the panel for that tab. Make the panel global
    // with a fixed path instead: the same path never reloads an open panel (so
    // the chat survives), and panel.js works out the tab when the panel loads.
    // Both calls stay synchronous: open() must run within the click.
    const native = chrome.sidePanel;
    const setOptions = native.setOptions.bind(native);
    Object.defineProperty(native, "setOptions", {
      value: (options = {}) => {
        if (options.tabId == null) return setOptions(options);
        const { tabId, path, ...rest } = options;
        return setOptions({ ...rest, path: "sidepanel.html", enabled: true });
      },
      writable: true,
      configurable: true,
    });
  }

  // A real side panel has no tab, and the service worker only trusts panel
  // senders without one: the panel page itself ("sender is not an extension
  // page") and the claude.ai iframe inside it (get_sidepanel_host_info). In
  // Arc, strip the tab from anything running inside our panel tab.
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
  // last active in its window, instead of staying pinned to the tab it was
  // opened from.
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
    joinShown(windowId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    for (const [windowId, id] of Object.entries(followed)) if (id === tabId) delete followed[windowId];
    chrome.storage.session.set({ [FOLLOW_KEY]: followed }).catch(() => {});
  });

  // Split view: other site tabs shown next to the followed one are part of
  // what the user sees, so Claude gets them too. Browsers don't report custom
  // split views (Crest leaves splitViewId at -1), but a tab on screen has a
  // visible document even when it isn't the active tab. A narrower-than-window
  // active tab is only the hint to go and check.
  const SPLIT_KEY = "__shimSplitTabs";
  let split = {}; // windowId -> [tabId] of other visible site tabs
  chrome.storage.session
    .get(SPLIT_KEY)
    .then((r) => (split = { ...r[SPLIT_KEY], ...split }))
    .catch(() => {});
  const isSite = (url) => /^https?:/.test(url ?? "");
  const isVisible = async (tabId) => {
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.visibilityState });
      return r?.result === "visible";
    } catch {
      return false;
    }
  };
  const refreshSplit = async (windowId) => {
    let partners = [];
    try {
      const [win, tabs] = await Promise.all([chrome.windows.get(windowId), chrome.tabs.query({ windowId })]);
      const active = tabs.find((t) => t.active);
      const narrow = (t) => t.width && win.width && t.width < win.width * 0.7;
      if (active && isSite(active.url) && narrow(active)) {
        const candidates = tabs.filter((t) => !t.active && isSite(t.url) && narrow(t));
        const visible = await Promise.all(candidates.map((t) => isVisible(t.id)));
        partners = candidates.filter((_, i) => visible[i]).map((t) => t.id);
      }
    } catch {}
    if (JSON.stringify(split[windowId] ?? []) === JSON.stringify(partners)) return;
    if (partners.length) split[windowId] = partners;
    else delete split[windowId];
    chrome.storage.session.set({ [SPLIT_KEY]: split }).catch(() => {});
    joinShown(windowId);
  };
  chrome.tabs.onActivated.addListener(({ windowId }) => refreshSplit(windowId));
  // A covered window reports its pages as hidden; look again when it's back.
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) refreshSplit(windowId);
  });
  chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    const windowId = removeInfo?.windowId;
    if (split[windowId]?.includes(tabId)) refreshSplit(windowId);
  });
  // Claude's tab group for each window's panel, learned when the panel starts
  // (CIC_IFRAME_BRIDGE_INIT) and from its tool calls. With it, the tabs on
  // screen join the group as soon as they change, so Claude already sees them
  // in its tab context before its first action.
  const GROUP_KEY = "__shimPanelGroups";
  let groups = {}; // windowId -> tabGroupId
  chrome.storage.session
    .get(GROUP_KEY)
    .then((r) => (groups = { ...r[GROUP_KEY], ...groups }))
    .catch(() => {});
  const rememberGroup = (windowId, groupId) => {
    if (windowId == null || !Number.isInteger(groupId) || groups[windowId] === groupId) return;
    groups[windowId] = groupId;
    chrome.storage.session.set({ [GROUP_KEY]: groups }).catch(() => {});
    joinShown(windowId);
  };
  function joinShown(windowId) {
    const groupId = groups[windowId];
    if (groupId == null) return;
    for (const tabId of [followed[windowId], ...(split[windowId] ?? [])]) {
      if (tabId != null) globalThis.__arcJoinTabGroup?.(tabId, groupId);
    }
  }

  const PANEL_MESSAGES = ["CIC_IFRAME_TOOL_CALL", "CIC_IFRAME_BRIDGE_INIT"];
  const fromPanel = (message, sender) =>
    PANEL_MESSAGES.includes(message?.type) && sender?.id === chrome.runtime.id && isPanel(sender.url);
  // A panel tab (Arc) has a window; a native side panel (Crest) has no tab,
  // so panel.js sends its window along.
  const panelWindow = (message, sender) => sender.tab?.windowId ?? message.__shimWindowId;

  const retarget = (message, sender) => {
    if (!fromPanel(message, sender)) return message;
    const { __shimWindowId, ...clean } = message;
    if (clean.type !== "CIC_IFRAME_TOOL_CALL") return clean;
    const windowId = panelWindow(message, sender);
    rememberGroup(windowId, clean.tabGroupId);
    // Tabs beside it in a split view join the group too, so Claude can act on
    // them when it names them; unnamed actions go to the followed tab.
    for (const tabId of split[windowId] ?? []) globalThis.__arcJoinTabGroup?.(tabId, clean.tabGroupId);
    const target = followed[windowId];
    if (target == null || target === clean.panelTabId) return clean;
    if (!globalThis.__arcJoinTabGroup?.(target, clean.tabGroupId)) return clean;
    return { ...clean, panelTabId: target };
  };
  // The bridge-init reply carries the panel's new group.
  const watchReply = (message, sender, sendResponse) => {
    if (!fromPanel(message, sender) || message.type !== "CIC_IFRAME_BRIDGE_INIT") return sendResponse;
    const windowId = panelWindow(message, sender);
    return (reply) => {
      if (reply?.ok) rememberGroup(windowId, reply.tabGroupId);
      return sendResponse(reply);
    };
  };

  const withPanelSender = (cb) => (message, sender, sendResponse) =>
    cb(retarget(message, sender), asPanel(sender), watchReply(message, sender, sendResponse));
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
