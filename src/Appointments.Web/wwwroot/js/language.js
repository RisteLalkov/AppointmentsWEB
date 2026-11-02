(() => {
  "use strict";
  const dirty = new WeakSet(), revisions = new WeakMap();
  function changed(event) {
    const form = event.target.form || event.target.closest?.("form");
    if (form) { dirty.add(form); revisions.set(form, (revisions.get(form) || 0) + 1); }
  }
  document.addEventListener("input", changed);
  document.addEventListener("change", changed);
  document.addEventListener("reset", event => dirty.delete(event.target));
  // Only clear a saved form if the user has not edited it while its request was in flight.
  window.MedTerminFormState = Object.freeze({
    revision: form => revisions.get(form) || 0,
    saved(form, revision) { if ((revisions.get(form) || 0) === revision) dirty.delete(form); }
  });
  document.addEventListener("submit", event => {
    const form = event.target;
    if (!form.matches("[data-language-form]")) return;
    const hasUnsavedInput = [...document.forms].some(other => other !== form && !other.matches("[data-language-form]") && dirty.has(other));
    if (hasUnsavedInput && !window.confirm(window.MedTerminI18n.t("Промената на јазик ќе ја вчита страницата одново. Незачуваните внесени податоци ќе се изгубат. Продолжи?"))) {
      event.preventDefault(); return;
    }
    form.elements.returnUrl.value = location.pathname + location.search + location.hash;
  });
})();
