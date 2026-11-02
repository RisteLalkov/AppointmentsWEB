// Bundled Lucide SVG paths keep icons consistent without a font or third-party request.
window.MedTerminIcons = Object.freeze({ icon(name) {
  if (!/^[a-z0-9-]+$/.test(name)) return "";
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="/icons/interface.svg#${name}"></use></svg>`;
}});
