// Keep native calendars and ISO form/API values, with a locale-independent day-first field.
(() => {
  "use strict";
  const tr = window.MedTerminI18n.t;
  const controls = new WeakMap();
  let serial = 0;
  function display(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
  }
  function parse(text) {
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text.trim());
    if (!match || match[3] === "0000") return "";
    const iso = `${match[3]}-${match[2]}-${match[1]}`;
    const date = new Date(iso + "T12:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : "";
  }
  function enhance(source) {
    if (controls.has(source)) return;
    const wrapper = document.createElement("span"), visible = document.createElement("input"), glyph = document.createElement("span");
    wrapper.className = "localized-date";
    visible.type = "text"; visible.className = "localized-date-display";
    visible.id = (source.id || `date-${++serial}`) + "-display";
    visible.placeholder = "DD.MM.YYYY"; visible.maxLength = 10; visible.inputMode = "numeric";
    visible.autocomplete = "off"; visible.spellcheck = false;
    for (const name of ["aria-label", "aria-labelledby", "aria-describedby"]) {
      if (source.hasAttribute(name)) visible.setAttribute(name, source.getAttribute(name));
    }
    // Labels describe the editable date; the retained date input opens the native calendar.
    for (const label of [...(source.labels || [])]) if (label.htmlFor === source.id) label.htmlFor = visible.id;
    source.before(wrapper); wrapper.append(visible, source, glyph);
    source.classList.add("localized-date-native"); source.setAttribute("aria-label", tr("Отвори календар"));
    source.removeAttribute("aria-labelledby");
    glyph.className = "localized-date-icon"; glyph.setAttribute("aria-hidden", "true");
    glyph.innerHTML = window.MedTerminIcons.icon("calendar-days");
    let writing = false, committed = source.value;
    function constraints() {
      visible.disabled = source.disabled; visible.readOnly = source.readOnly;
      visible.required = source.required;
    }
    function validate() {
      constraints();
      const text = visible.value.trim(), iso = parse(text);
      const error = !text ? (source.required ? tr("Пополнете го ова задолжително поле.") : "")
        : !iso ? tr("Внесете важечки датум во формат ДД.ММ.ГГГГ.")
        : source.min && iso < source.min ? tr("Изберете датум на или по {0}.", display(source.min))
        : source.max && iso > source.max ? tr("Изберете датум на или пред {0}.", display(source.max)) : "";
      visible.setCustomValidity(error); source.setCustomValidity(error);
      visible.setAttribute("aria-invalid", String(!!error && !!text));
      return { iso, error };
    }
    function sync() {
      if (writing) return;
      committed = source.value;
      visible.value = display(source.value); validate();
    }
    function edit(commit = false) {
      const { iso, error } = validate(), previous = source.value;
      writing = true;
      source.value = iso;
      if (previous !== iso) source.dispatchEvent(new Event("input", { bubbles: true }));
      // A change may rebuild its owning screen. Notify only after a completed valid entry,
      // while still clearing the submitted ISO value immediately for invalid/partial text.
      if (commit && !error && committed !== iso) {
        committed = iso;
        source.dispatchEvent(new Event("change", { bubbles: true }));
      }
      writing = false;
    }
    visible.addEventListener("input", () => {
      // Phone numeric keyboards need no punctuation key: 10112026 becomes 10.11.2026.
      if (visible.selectionStart === visible.value.length && /^[\d.]+$/.test(visible.value)) {
        const before = visible.value.slice(0, visible.selectionStart).replace(/\D/g, "").length;
        const digits = visible.value.replace(/\D/g, "").slice(0, 8);
        const formatted = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join(".");
        if (formatted !== visible.value) {
          visible.value = formatted;
          let cursor = 0, consumed = 0;
          while (cursor < formatted.length && consumed < before) if (/\d/.test(formatted[cursor++])) consumed++;
          visible.setSelectionRange(cursor, cursor);
        }
      }
      edit();
    });
    visible.addEventListener("change", () => edit(true));
    visible.addEventListener("blur", () => { edit(true); if (visible.isConnected && !wrapper.contains(document.activeElement) && visible.value.trim() && !visible.validity.valid) visible.reportValidity(); });
    source.addEventListener("input", sync); source.addEventListener("change", sync);
    source.addEventListener("invalid", event => { event.preventDefault(); visible.focus(); visible.reportValidity(); });
    source.addEventListener("click", () => { if (!source.disabled && !source.readOnly) { try { source.showPicker?.(); } catch { /* Native indicator remains usable. */ } } });
    source.addEventListener("keydown", event => {
      if (["Enter", " ", "ArrowDown"].includes(event.key) && source.showPicker && !source.readOnly) { event.preventDefault(); try { source.showPicker(); } catch {} }
    });
    controls.set(source, { sync, validate, commit: () => edit(true), visible });
    sync();
  }
  function scan(root) {
    if (root.matches?.("input[type=date]")) enhance(root);
    root.querySelectorAll?.("input[type=date]").forEach(enhance);
  }
  scan(document);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") controls.get(record.target)?.sync();
      else record.addedNodes.forEach(scan);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["min", "max", "required", "disabled", "readonly", "value"] });
  // Resets restore the original ISO value; browser back/forward may restore fields independently.
  document.addEventListener("reset", event => queueMicrotask(() => event.target.querySelectorAll("input[type=date]").forEach(s => controls.get(s)?.sync())));
  window.addEventListener("pageshow", () => document.querySelectorAll("input[type=date]").forEach(s => controls.get(s)?.sync()));
  // Also used by the booking dialog, whose review button is outside a form.
  window.MedTerminDates = Object.freeze({ validate(root) {
    for (const source of root.querySelectorAll("input[type=date]")) {
      const control = controls.get(source);
      if (!source.disabled && control?.validate().error) { control.visible.reportValidity(); control.visible.focus(); return false; }
      if (!source.disabled) control?.commit();
    }
    return true;
  } });
})();
