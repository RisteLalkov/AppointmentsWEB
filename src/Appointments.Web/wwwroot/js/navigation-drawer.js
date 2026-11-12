(() => {
  "use strict";
  const sidebar = document.querySelector("#sidebar"), toggle = document.querySelector("#menu-toggle");
  if (!sidebar || !toggle) return;
  const backdrop = document.querySelector("#navigation-backdrop"), main = document.querySelector(".main-shell");
  const mobile = matchMedia("(max-width: 650px)");
  let previousFocus, collapsed = false;
  try { collapsed = localStorage.getItem("medtermin.sidebarCollapsed") === "true"; } catch { }
  function desktopLayout() {
    document.body.classList.toggle("sidebar-collapsed", !mobile.matches && collapsed);
    toggle.setAttribute("aria-expanded", String(!mobile.matches && !collapsed));
    sidebar.inert = mobile.matches || collapsed;
  }
  const isOpen = () => sidebar.classList.contains("open");
  function close(restoreFocus = true) {
    const wasOpen = isOpen();
    sidebar.classList.remove("open"); backdrop.hidden = true;
    desktopLayout();
    sidebar.removeAttribute("role"); sidebar.removeAttribute("aria-modal");
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
  toggle.setAttribute("aria-controls", sidebar.id);
  toggle.addEventListener("click", () => {
    if (mobile.matches) { isOpen() ? close() : open(); return; }
    collapsed = !collapsed;
    try { localStorage.setItem("medtermin.sidebarCollapsed", String(collapsed)); } catch { }
    desktopLayout(); window.dispatchEvent(new Event("resize"));
  });
  document.addEventListener("medtermin:close-navigation", () => close(false));
  window.addEventListener("storage", e => {
    if (e.key === "medtermin.sidebarCollapsed") { collapsed = e.newValue === "true"; close(false); window.dispatchEvent(new Event("resize")); }
  });
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
  desktopLayout();
})();
