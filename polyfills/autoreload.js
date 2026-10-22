// Unpacked extensions are read from disk, but Arc only picks up a changed
// manifest or a consistent set of files after a reload. build.sh writes a new
// build-id.txt on every build; when the service worker starts and finds one it
// hasn't run before, it reloads the extension once.
(async () => {
  const KEY = "__arcBuildId";
  try {
    const id = (await (await fetch(chrome.runtime.getURL("build-id.txt"), { cache: "no-store" })).text()).trim();
    const { [KEY]: seen } = await chrome.storage.local.get(KEY);
    if (seen === id) return;
    await chrome.storage.local.set({ [KEY]: id });
    if (seen !== undefined) chrome.runtime.reload();
  } catch {}
})();
