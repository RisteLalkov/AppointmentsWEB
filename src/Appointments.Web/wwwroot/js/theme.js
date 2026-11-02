// Apply before styles paint; preferences belong to this browser, not a clinic/account.
(() => {
  "use strict";
  const key = "medtermin.theme";
  const allowed = new Set(["default", "dark", "vibrant"]);
  const normalize = value => allowed.has(value) ? value : "default";
  function apply(value) {
    const theme = normalize(value);
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll("[data-theme-select]").forEach(select => { select.value = theme; });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = { default: "#176c60", dark: "#354b4e", vibrant: "#faf6ef" }[theme];
  }
  let initial = "default";
  try { initial = localStorage.getItem(key); } catch { /* Storage may be disabled. */ }
  apply(initial);
  function initialize() {
    apply(document.documentElement.dataset.theme);
    document.querySelectorAll("[data-theme-picker]").forEach(picker => { picker.hidden = false; });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
  document.addEventListener("change", event => {
    if (!event.target.matches("[data-theme-select]")) return;
    const theme = normalize(event.target.value);
    apply(theme);
    try { localStorage.setItem(key, theme); } catch { /* Switching still works for this page. */ }
  });
  window.addEventListener("storage", event => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
