// ISO form/API values and day-first editing. Booking alone uses an availability calendar.
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
  let openedCalendar;
  const isoDay = d => d.toISOString().slice(0, 10);
  function attachAvailability(source, provider) {
    if (!source) return;
    enhance(source);
    const control = controls.get(source);
    if (control.calendar) { control.calendar.provider = provider; return; }
    const wrapper = source.parentElement;
    const button = document.createElement("button"), panel = document.createElement("div");
    button.type = "button"; button.className = "availability-calendar-open";
    button.setAttribute("aria-label", tr("Отвори календар")); button.setAttribute("aria-haspopup", "dialog"); button.setAttribute("aria-expanded", "false");
    button.innerHTML = window.MedTerminIcons.icon("calendar-days");
    panel.className = "availability-calendar"; panel.hidden = true; panel.id = (source.id || "date") + "-calendar";
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", tr("Изберете датум")); button.setAttribute("aria-controls", panel.id);
    wrapper.append(button, panel); wrapper.classList.add("has-availability-calendar"); source.tabIndex = -1;
    let month, generation = 0;
    const calendar = control.calendar = { provider, close() { panel.hidden = true; button.setAttribute("aria-expanded", "false"); generation++; if (openedCalendar === calendar) openedCalendar = null; }, wrapper };
    function select(date) {
      calendar.close(); source.value = date;
      source.dispatchEvent(new Event("input", {bubbles:true})); source.dispatchEvent(new Event("change", {bubbles:true}));
      control.visible.focus();
    }
    async function render(focusDate) {
      const request = ++generation;
      const first = isoDay(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)));
      const last = isoDay(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)));
      const from = first < source.min ? source.min : first, to = last > source.max ? source.max : last;
      panel.replaceChildren();
      const header = document.createElement("div"); header.className = "availability-calendar-header";
      const prev = document.createElement("button"), next = document.createElement("button"), title = document.createElement("strong");
      for (const [el, direction, label] of [[prev,-1,"Претходен месец"],[next,1,"Следен месец"]]) {
        el.type="button"; el.className="icon-button"; el.setAttribute("aria-label",tr(label)); el.innerHTML=window.MedTerminIcons.icon(direction<0?"chevron-left":"chevron-right");
        el.addEventListener("click", () => { month = new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+direction,1)); render(); });
      }
      prev.disabled = first <= source.min; next.disabled = last >= source.max;
      const monthNames = ["јануари","февруари","март","април","мај","јуни","јули","август","септември","октомври","ноември","декември"];
      title.textContent = window.MedTerminI18n.locale === "en" ? new Intl.DateTimeFormat("en-GB", {month:"long",year:"numeric",timeZone:"UTC"}).format(month) : `${monthNames[month.getUTCMonth()]} ${month.getUTCFullYear()}`;
      header.append(prev,title,next); panel.append(header);
      const grid = document.createElement("div"); grid.className="availability-calendar-grid"; grid.setAttribute("role","group"); grid.setAttribute("aria-label",title.textContent);
      const names = window.MedTerminI18n.locale === "en" ? ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] : ["пон","вто","сре","чет","пет","саб","нед"];
      for (const name of names) { const label=document.createElement("span"); label.className="availability-weekday";label.textContent=name;grid.append(label); }
      const offset = (new Date(first+"T12:00Z").getUTCDay()+6)%7;
      for(let i=0;i<offset;i++) { const blank=document.createElement("span");blank.setAttribute("aria-hidden","true");grid.append(blank); }
      for(let i=1;i<=Number(last.slice(-2));i++) {
        const date=first.slice(0,8)+String(i).padStart(2,"0"), day=document.createElement("button");
        day.type="button";day.textContent=String(i);day.dataset.date=date;day.className="availability-day";day.disabled=date<source.min||date>source.max;
        day.setAttribute("aria-pressed",String(date===source.value));day.setAttribute("aria-label",display(date));
        if(date===source.min)day.setAttribute("aria-current","date");
        day.addEventListener("click",()=>select(date));
        day.addEventListener("keydown",event=>{
          const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];
          if(delta===undefined)return;event.preventDefault();const target=new Date(date+"T12:00Z");target.setUTCDate(target.getUTCDate()+delta);const iso=isoDay(target);
          if(iso<source.min||iso>source.max)return;
          const match=panel.querySelector(`[data-date="${iso}"]`);
          if(match)match.focus();else{month=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth(),1));render(iso);}
        });grid.append(day);
      }
      panel.append(grid);
      const status=document.createElement("p");status.className="availability-calendar-status";status.setAttribute("role","status");status.textContent=tr("Се проверуваат слободните термини…");panel.append(status);
      const legend=document.createElement("div");legend.className="availability-calendar-legend";
      for(const [kind,label] of [["available","Има слободни термини"],["unavailable","Нема слободни термини"]]) { const item=document.createElement("span");item.className=kind;item.textContent=tr(label);legend.append(item); }panel.append(legend);
      const focusTarget = panel.querySelector(`[data-date="${focusDate || source.value}"]:not(:disabled)`) || panel.querySelector(".availability-day:not(:disabled)") || next;
      focusTarget.focus({preventScroll:true});
      try {
        const days = from <= to ? await calendar.provider(from,to) : [];
        if(request!==generation||!source.isConnected||panel.hidden)return;
        const counts=new Map(days.map(d=>[d.date,d.count]));
        panel.querySelectorAll(".availability-day:not(:disabled)").forEach(day=>{
          if(!counts.has(day.dataset.date))return;
          const available=counts.get(day.dataset.date)>0;day.classList.add(available?"available":"unavailable");
          day.setAttribute("aria-label",display(day.dataset.date)+" · "+tr(available?"Има слободни термини":"Нема слободни термини"));
        });
        status.textContent=tr("Достапноста повторно се проверува при закажување.");
      }catch(error){if(request===generation&&!panel.hidden)status.textContent=tr("Достапноста не може да се вчита. Обидете се повторно.");}
    }
    button.addEventListener("click",()=>{
      if(!panel.hidden){calendar.close();return;}
      openedCalendar?.close();openedCalendar=calendar;panel.hidden=false;button.setAttribute("aria-expanded","true");
      const value=source.value||source.min;month=new Date(value.slice(0,7)+"-01T12:00Z");render();
    });
    wrapper.addEventListener("keydown",event=>{if(event.key==="Escape"&&!panel.hidden){event.preventDefault();event.stopPropagation();calendar.close();button.focus();}});
    control.visible.addEventListener("input",()=>calendar.close());
  }
  document.addEventListener("click",event=>{if(openedCalendar&&!event.composedPath().includes(openedCalendar.wrapper))openedCalendar.close();});
  document.addEventListener("focusin",event=>{if(openedCalendar&&!event.composedPath().includes(openedCalendar.wrapper))openedCalendar.close();});
  document.addEventListener("close",()=>openedCalendar?.close(),true);

  // Also used by the booking dialog, whose review button is outside a form.
  window.MedTerminDates = Object.freeze({ availability: attachAvailability, validate(root) {
    for (const source of root.querySelectorAll("input[type=date]")) {
      const control = controls.get(source);
      if (!source.disabled && control?.validate().error) { control.visible.reportValidity(); control.visible.focus(); return false; }
      if (!source.disabled) control?.commit();
    }
    return true;
  } });
})();
