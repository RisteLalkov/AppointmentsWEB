"use strict";
// Shared by clinic/platform sign-in, registration and account-management forms.
(() => {
  const eye = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const eyeOff = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a20 20 0 0 1-3.1 4M6.2 6.2A22 22 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5-1.1M10 10a3 3 0 0 0 4 4"/></svg>';
  let nextId = 0;
  function enhance(input) {
    if (input.dataset.passwordEnhanced) return;
    input.dataset.passwordEnhanced = "true";
    if (!input.id) {
      do { input.id = "password-field-" + ++nextId; } while (document.querySelectorAll('[id="' + input.id + '"]').length > 1);
    }
    const wrapper = document.createElement("div");
    wrapper.className = "password-control";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "password-visibility-toggle";
    button.setAttribute("aria-controls", input.id);
    function render() {
      const visible = input.type === "text";
      const action = visible ? "Сокриј лозинка" : "Прикажи лозинка";
      const label = input.labels?.[0]?.textContent.trim();
      button.setAttribute("aria-label", action + (label ? ": " + label : ""));
      button.setAttribute("aria-pressed", String(visible));
      button.title = action;
      button.disabled = input.disabled;
      button.innerHTML = visible ? eyeOff : eye;
    }
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", () => {
      if (input.disabled) return;
      const start = input.selectionStart, end = input.selectionEnd;
      input.type = input.type === "password" ? "text" : "password";
      render();
      if (document.activeElement === input && start != null) input.setSelectionRange(start, end);
    });
    input.before(wrapper);
    wrapper.append(input, button);
    // No value is copied into attributes, storage, messages or logs.
    render();
    input.addEventListener("password:hide", () => { input.type = "password"; render(); });
  }
  function scan(root) {
    if (root instanceof HTMLInputElement && root.type === "password") enhance(root);
    root.querySelectorAll?.('input[type="password"]').forEach(enhance);
  }
  function hide(root) {
    root.querySelectorAll('input[data-password-enhanced]').forEach(input => input.dispatchEvent(new Event("password:hide")));
  }
  scan(document);
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) scan(node);
    }
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("submit", event => hide(event.target), true);
  document.addEventListener("reset", event => hide(event.target), true);
  window.addEventListener("pageshow", () => hide(document));
})();
