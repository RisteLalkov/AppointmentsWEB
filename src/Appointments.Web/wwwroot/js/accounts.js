(() => {
  "use strict";
  const notice = document.querySelector(".success-notice");
  if (!notice) return;
  // The result stays visible and receives focus, including after a redirect with a list anchor.
  window.addEventListener("pageshow", () => notice.focus());
})();
