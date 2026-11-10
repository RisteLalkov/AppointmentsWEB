(() => {
  "use strict";
  const sidebar = document.querySelector("#sidebar"), toggle = document.querySelector("#menu-toggle");
  if (!sidebar || !toggle) return;
  const backdrop = document.querySelector("#navigation-backdrop"), main = document.querySelector(".main-shell");
  const mobile = matchMedia("(max-width: 650px)");
  let previousFocus;
  const isOpen = () => sidebar.classList.contains("open");
  function close(restoreFocus = true) {
    const wasOpen = isOpen();
    sidebar.classList.remove("open"); backdrop.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    sidebar.removeAttribute("role"); sidebar.removeAttribute("aria-modal");
    sidebar.inert = mobile.matches;
    main.inert = false; document.body.classList.remove("navigation-open");
    if (wasOpen && restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  function open() {
    if (!mobile.matches) return;
    previousFocus = document.activeElement;
    sidebar.inert = false;
    sidebar.classList.add("open"); backdrop.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    sidebar.setAttribute("role", "dialog"); sidebar.setAttribute("aria-modal", "true");
    main.inert = true; document.body.classList.add("navigation-open");
    document.querySelector("#close-navigation").focus({ preventScroll: true });
  }
  toggle.addEventListener("click", () => isOpen() ? close() : open());
  document.querySelector("#close-navigation").addEventListener("click", () => close());
  backdrop.addEventListener("click", () => close());
  sidebar.addEventListener("click", event => {
    if (event.target.closest("a[href], button[data-page], button[data-nav]")) {
      close(false);
      document.querySelector("#main-content").focus({ preventScroll: true });
    }
  });
  document.addEventListener("keydown", event => {
    if (!isOpen() || !mobile.matches) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    if (event.key === "Tab") {
      const stops = [...sidebar.querySelectorAll("a[href],button,summary,[tabindex='0']")].filter(e => !e.disabled && e.getClientRects().length);
      const first = stops[0], last = stops.at(-1);
      if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }, true);
  mobile.addEventListener("change", () => close(false));
  window.addEventListener("hashchange", () => close(false));
  sidebar.inert = mobile.matches;
})();
