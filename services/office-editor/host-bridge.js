(() => {
  "use strict";

  const extensionId = "org.spellbook.editor";
  let requested = false;
  let attempts = 0;
  let timer;
  const rootClass = "spellbook-extension-bridge-active";
  const panelSelector =
    '.extension-panel[data-extension-id="org.spellbook.editor"]';

  function synchronizeBridgeVisibility() {
    const active = Boolean(document.querySelector(panelSelector));
    const changed =
      document.documentElement.classList.contains(rootClass) !== active;
    document.documentElement.classList.toggle(rootClass, active);
    if (changed)
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }

  new MutationObserver(synchronizeBridgeVisibility).observe(
    document.documentElement,
    { childList: true, subtree: true },
  );
  synchronizeBridgeVisibility();

  function openExtension() {
    if (!requested) return;
    const control = globalThis.app?.map?._extensions?.[extensionId];
    if (control) {
      attempts = 0;
      if (!control._panel) control.toggle();
      synchronizeBridgeVisibility();
      return;
    }
    if (attempts++ < 120) timer = setTimeout(openExtension, 250);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const expectedOrigin = globalThis.app?.map?.wopi?.PostMessageOrigin;
    if (expectedOrigin && event.origin !== expectedOrigin) return;
    if (event.data?.type !== "spellbook.open-extension") return;
    requested = true;
    clearTimeout(timer);
    openExtension();
  });
})();
