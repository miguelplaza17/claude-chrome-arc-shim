// Arc exposes chrome.tabs.group / chrome.tabGroups but never resolves them, so
// emulate tab groups in memory. State lives in chrome.storage.session so the
// service worker and the extension pages share the same groups.
// This build is only for Arc, so it always applies.
(() => {
  // Plain assignment may be ignored on extension API objects; force it.
  const patch = (obj, name, fn) =>
    Object.defineProperty(obj, name, { value: fn, writable: true, configurable: true });

  const NONE = -1;
  const KEY = "__arcTabGroups";
  const tabs = chrome.tabs;
  const real = { get: tabs.get.bind(tabs), query: tabs.query.bind(tabs), create: tabs.create.bind(tabs) };

  // { nextId, groups: {id: group}, members: {tabId: groupId} }
  let state = { nextId: 1000 + Math.floor(Math.random() * 1e6), groups: {}, members: {} };
  const ready = chrome.storage.session
    .get(KEY)
    .then((r) => r[KEY] && (state = r[KEY]))
    .catch(() => {});
  chrome.storage.session.onChanged.addListener((changes) => {
    if (changes[KEY]?.newValue) state = changes[KEY].newValue;
  });
  const save = () => chrome.storage.session.set({ [KEY]: state });

  const groupOf = (tabId) => state.members[tabId] ?? NONE;
  const decorate = (tab) => {
    if (tab && tab.id != null) tab.groupId = groupOf(tab.id);
    return tab;
  };
  const prune = () => {
    const used = new Set(Object.values(state.members));
    for (const id of Object.keys(state.groups)) if (!used.has(Number(id))) delete state.groups[id];
  };
  const missing = (id) => new Error(`No group with id: ${id}.`);

  patch(tabs, "get", async (tabId) => {
    await ready;
    return decorate(await real.get(tabId));
  });

  patch(tabs, "query", async (info = {}) => {
    await ready;
    const { groupId, ...rest } = info;
    const result = (await real.query(rest)).map(decorate);
    return groupId === undefined ? result : result.filter((t) => t.groupId === groupId);
  });

  patch(tabs, "create", async (props) => decorate(await real.create(props)));

  patch(tabs, "group", async ({ tabIds, groupId, createProperties } = {}) => {
    await ready;
    const ids = [].concat(tabIds);
    if (groupId == null) {
      const first = await real.get(ids[0]);
      groupId = state.nextId++;
      state.groups[groupId] = {
        id: groupId,
        windowId: createProperties?.windowId ?? first.windowId,
        title: "",
        color: "grey",
        collapsed: false,
      };
    } else if (!state.groups[groupId]) {
      throw missing(groupId);
    }
    for (const id of ids) state.members[id] = groupId;
    prune();
    await save();
    return groupId;
  });

  patch(tabs, "ungroup", async (tabIds) => {
    await ready;
    for (const id of [].concat(tabIds)) delete state.members[id];
    prune();
    await save();
  });

  const tg = chrome.tabGroups;
  patch(tg, "get", async (groupId) => {
    await ready;
    const g = state.groups[groupId];
    if (!g) throw missing(groupId);
    return { ...g };
  });

  patch(tg, "query", async (filter = {}) => {
    await ready;
    return Object.values(state.groups)
      .filter((g) => Object.entries(filter).every(([k, v]) => g[k] === v))
      .map((g) => ({ ...g }));
  });

  patch(tg, "update", async (groupId, props = {}) => {
    await ready;
    const g = state.groups[groupId];
    if (!g) throw missing(groupId);
    Object.assign(g, props);
    await save();
    return { ...g };
  });

  patch(tg, "move", async (groupId) => tg.get(groupId));

  // Synchronous join for sidepanel-polyfill.js, which must retarget a message
  // before the extension's own listener sees it. A long-lived panel can
  // outlive its group (it is pruned when its last tab closes), so recreate it
  // under the same id. Returns false for a missing or invalid group id.
  globalThis.__arcJoinTabGroup = (tabId, groupId) => {
    if (!Number.isInteger(groupId) || groupId < 0) return false;
    state.groups[groupId] ??= { id: groupId, windowId: NONE, title: "Claude", color: "orange", collapsed: false };
    if (state.members[tabId] !== groupId) {
      state.members[tabId] = groupId;
      prune();
      save();
    }
    return true;
  };

  // Only the service worker cleans up, so pages don't race it.
  if (typeof window === "undefined") {
    tabs.onRemoved.addListener(async (tabId) => {
      await ready;
      if (!(tabId in state.members)) return;
      delete state.members[tabId];
      prune();
      await save();
    });
  }
})();
