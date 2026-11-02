// Explicit literal translation; interpolated clinic/user data is never searched or replaced.
(() => {
  "use strict";
  const locale = document.documentElement.lang === "en" ? "en" : "mk";
  const catalogue = locale === "en" ? (window.MedTerminEnglish || {}) : {};
  const has = key => Object.prototype.hasOwnProperty.call(catalogue, key);
  function translate(source) {
    const key = source.trim();
    return has(key) ? source.slice(0, source.length - source.trimStart().length) + catalogue[key] + source.slice(source.trimEnd().length) : source;
  }
  function t(source, ...values) {
    const result = translate(source);
    return values.length ? result.replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index]) : match) : result;
  }
  function literal(source) {
    return locale === "en" ? source.replace(/[\p{Script=Cyrillic}][^<>"'\n]*/gu, fragment => {
      const key = fragment.trim();
      if (!has(key)) return fragment;
      const escaped = catalogue[key].replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
      return fragment.slice(0, fragment.length - fragment.trimStart().length) + escaped + fragment.slice(fragment.trimEnd().length);
    }) : source;
  }
  function html(strings, ...values) {
    if (typeof strings === "string") return literal(strings);
    // Static template fragments may contain markup; caller-owned values retain their escaping.
    return strings.reduce((result, part, index) => result + literal(part) + (index < values.length ? values[index] : ""), "");
  }
  window.MedTerminI18n = Object.freeze({ t, html, locale });
})();
