// Native modal semantics provide focus containment and Escape support on desktop and phones.
(() => {
  "use strict";
  const trigger = document.getElementById("account-menu-button");
  const dialog = document.getElementById("account-settings-dialog");
  if (!trigger || !dialog) return;
  trigger.addEventListener("click", () => {
    if (dialog.open) return;
    document.getElementById("sidebar")?.classList.remove("open");
    document.getElementById("menu-toggle")?.setAttribute("aria-expanded", "false");
    dialog.showModal();
    trigger.setAttribute("aria-expanded", "true");
  });
  dialog.querySelector("[data-account-settings-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    trigger.setAttribute("aria-expanded", "false");
    trigger.focus({ preventScroll: true });
  });
  const outside = event => {
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  };
  // Ignore drags that start inside the panel and end on the backdrop.
  let startedOutside = false;
  dialog.addEventListener("pointerdown", event => { startedOutside = event.target === dialog && outside(event); });
  dialog.addEventListener("click", event => {
    if (startedOutside && event.target === dialog && outside(event)) dialog.close();
    startedOutside = false;
  });
})();
