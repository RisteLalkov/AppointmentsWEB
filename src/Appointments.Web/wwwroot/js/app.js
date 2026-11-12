(() => {
"use strict";
const { t: tr, html, locale } = window.MedTerminI18n;
const icon = window.MedTerminIcons.icon;
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const compareRecords = (a,b) => a.name.localeCompare(b.name,locale === "en" ? "en" : "mk",{sensitivity:"base"}) || a.id.localeCompare(b.id);
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const dayLabels = locale === "en" ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] : [tr("Недела"), tr("Понеделник"), tr("Вторник"), tr("Среда"), tr("Четврток"), tr("Петок"), tr("Сабота")];
  const statuses = [
    "Scheduled",
    "Confirmed",
    "Completed",
    "Cancelled",
    "NoShow",
  ];
  const statusLabel = (s) =>
    ({ Scheduled: tr("Чека потврда"), Confirmed: tr("Потврден"), Completed: tr("Завршен"), Cancelled: tr("Откажан"), NoShow: tr("Не се појавил") })[s] || tr("Непознат статус");
  let state,
    page = "overview",
    calendar,
    doctorFilter = "",
    calendarView = innerWidth < 650 ? "timeGridDay" : "timeGridWeek",
    calendarDate;
  let listTab = "upcoming",
    search = "",
    specialty = "",
    statusFilter = "",
    booking,
    slotRequest = 0,
    refreshInFlight = false;
  let toastTimer, lastFocus;
  let patientFocusId = "";
  let patientRequest = 0, patientProfile, patientProfileId = "", patientFilters;
  let doctorService = "", nextSlotRequest = 0, nextSlotTimer;
  let doctorAvailabilityRequest = 0, doctorAvailabilityResults;
  const workspaceRequests = new Map();
  let calendarRequest = 0;
  let calendarSpecialty = "", calendarService = "", calendarRange, reportRequest = 0, reportFilters;
  const serviceOptions = selected => html`<option value="">Сите услуги / прегледи</option><option value="unassigned" ${selected === "unassigned" ? "selected" : ""}>Без заведена услуга</option>${[...state.services, ...state.doctors.filter(d => d.isService)].map(d => `<option value="${d.id}" ${selected === d.id ? "selected" : ""}>${escape(d.name)}</option>`).join("")}`;
  const specialtyOptions = selected => html`<option value="">Сите специјалности</option>${[...new Set(state.doctors.map(d => d.specialty))].sort().map(v => `<option value="${escape(v)}" ${selected === v ? "selected" : ""}>${escape(v)}</option>`).join("")}`;
  const serviceKey = a => a.serviceId || (doctor(a.doctorId)?.isService ? a.doctorId : "unassigned");
  const servicesFor = id => state.services.filter(s => s.enabled && state.doctorServices.some(x => x.doctorId === id && x.serviceId === s.id));
  const calendarDoctors = () => ownDoctors().filter(d => (!calendarSpecialty || d.specialty === calendarSpecialty) && (!calendarService || (calendarService === "unassigned" && !d.isService) || d.id === calendarService || state.doctorServices.some(x => x.doctorId === d.id && x.serviceId === calendarService) || state.calendarDoctorServices?.some(x => x.doctorId === d.id && x.serviceId === calendarService) || state.appointments.some(a => a.doctorId === d.id && serviceKey(a) === calendarService)));
  const bookingDuration = b => b.moveId ? Math.round((new Date(state.appointments.find(a => a.id === b.moveId).end) - new Date(state.appointments.find(a => a.id === b.moveId).start)) / 60000) : state.services.find(s => s.id === b.serviceId)?.durationMinutes || doctor(b.doctorId).durationMinutes;

  // randomUUID is absent on HTTP intranet origins; getRandomValues remains available.
  function requestId() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  const app = $("#app"),
    dialog = $("#main-dialog");
  const isPatient = () => state.actor.role === "Patient";
  const isDoctor = () => state.actor.role === "Doctor";
  const isAdmin = () => state.actor.role === "Administrator";
  const ownDoctors = () =>
    state.doctors.filter((d) => !isDoctor() || d.id === state.actor.doctorId);
  const doctor = (id) => state.doctors.find((d) => d.id === id);
  const patient = (id) => state.patients.find((p) => p.id === id);
  const patientCode = p => p ? (p.number > 0 ? `PT-${String(p.number).padStart(6, "0")}` : `ID: ${p.id}`) : "";
  const patientLabel = p => p ? [p.name, patientCode(p), p.email, p.phone].filter(Boolean).join(" · ") : tr("Пациент");
  const patientNumber = p => p ? `<small class="patient-number">${escape(tr("Број на пациент"))}: ${escape(patientCode(p))}</small>` : "";
  const initials = (name) =>
    name
      .replace(/^(Др\.|Проф\.|Др\.|user-)\s*/g, "")
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0])
      .join("");
  const avatar = (name, index = 0, extra = "") =>
    `<span class="avatar tone-${(Number.isFinite(index) ? index : 0) % 5} ${extra}" aria-hidden="true">${escape(initials(name))}</span>`;
  const badge = (status) =>
    `<span class="badge ${escape(status)}">${escape(statusLabel(status))}</span>`;
  const empty = (title, text) =>
    html`<div class="empty-state"><span class="empty-icon" aria-hidden="true">${icon("clock")}</span><h3>${escape(title)}</h3><p>${escape(text)}</p></div>`;
  let wallFormatter, wallZone;
  const wall = (instant) => {
    if (!wallFormatter || wallZone !== state.timeZone) {
      wallZone = state.timeZone;
      wallFormatter = new Intl.DateTimeFormat("sv-SE", {
      timeZone: state.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      });
    }
    const parts = wallFormatter.formatToParts(new Date(instant));
    const p = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  };
  // Some browsers omit Macedonian from their bundled Intl/ICU data and silently
  // fall back to English. Explicit labels keep presentation Macedonian everywhere.
  const monthNames = [tr("јануари"), tr("февруари"), tr("март"), tr("април"), tr("мај"), tr("јуни"), tr("јули"), tr("август"), tr("септември"), tr("октомври"), tr("ноември"), tr("декември")];
  const shortMonths = [tr("јан."), tr("фев."), tr("мар."), tr("апр."), tr("мај"), tr("јун."), tr("јул."), tr("авг."), tr("септ."), tr("окт."), tr("ноем."), tr("дек.")];
  const shortDays = [tr("нед."), tr("пон."), tr("вто."), tr("сре."), tr("чет."), tr("пет."), tr("саб.")];
  const formatDate = (date, options = { day: "numeric", month: "short", year: "numeric" }) => {
    const value = new Date(date.slice(0, 10) + "T12:00:00Z");
    const day = value.getUTCDate(), month = value.getUTCMonth(), year = value.getUTCFullYear();
    const parts = [];
    if (options.day) parts.push(options.day === "2-digit" ? String(day).padStart(2, "0") : String(day));
    if (options.month) parts.push(options.month === "long" ? monthNames[month] : options.month === "short" ? shortMonths[month] : String(month + 1).padStart(options.month === "2-digit" ? 2 : 1, "0"));
    if (options.year) parts.push(String(year));
    const numeric = ["numeric", "2-digit"].includes(options.month);
    const text = parts.join(numeric ? "." : " ") + (numeric && !options.year ? "." : "");
    const weekday = options.weekday === "long" ? (locale === "en" ? dayLabels[value.getUTCDay()] : dayLabels[value.getUTCDay()].toLowerCase()) : shortDays[value.getUTCDay()];
    return options.weekday ? weekday + (text ? ", " + text : "") : text;
  };
  const addDays = (date, n) => {
    const d = new Date(date + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const monday = (date) => {
    const d = new Date(date + "T12:00:00Z");
    return addDays(date, -((d.getUTCDay() + 6) % 7));
  };
  const timeOf = (instant) => wall(instant).slice(11, 16);
  const dayOf = (instant) => wall(instant).slice(0, 10);
  const upcoming = (a) =>
    new Date(a.start) > new Date() &&
    ["Scheduled", "Confirmed"].includes(a.status);
  const heading = (
    title,
    subtitle,
    action = "",
    eyebrow = "",
    overviewDate = false,
  ) =>
    `<div class="page-heading"><div>${eyebrow ? `<span class="eyebrow">${escape(eyebrow)}</span>` : ""}<h1>${escape(title)}</h1><p${overviewDate ? ' class="overview-date"' : ''}>${overviewDate ? html`<span class="overview-date-chip"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/></svg><time datetime="${escape(state.today)}">${escape(subtitle)}</time></span>` : escape(subtitle)}</p></div>${action}</div>`;
  const bookButton = (label) =>
    html`<button class="btn primary" data-action="book"><span aria-hidden="true">${icon("plus")}</span> ${escape(label || tr("Нов термин"))}</button>`;
  const doctorOptions = (selected = "", all = false, bookable = false) =>
    `${all ? html("<option value=\"\">Сите лекари</option>") : ""}${ownDoctors().filter(d => !bookable || (d.enabled !== false && !patientBookingBlocked(d)) || d.id === selected)
      .map(
        (d) =>
          `<option value="${d.id}" ${d.id === selected ? "selected" : ""}>${escape(d.name)}</option>`,
      )
      .join("")}`;
  function toast(message, error = false) {
    const el = $("#toast");
    clearTimeout(toastTimer);
    el.textContent = message;
    el.className = "toast show" + (error ? " error" : "");
    toastTimer = setTimeout(() => el.classList.remove("show"), 5000);
  }
  async function api(path, data) {
    const response = await fetch("/data/" + path, {
      method: data === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "X-Workspace-Clinic": document.querySelector('meta[name="careline-clinic"]')?.content || "",
        ...(data === undefined ? {} : {
          "Content-Type": "application/json",
          "X-CSRF-TOKEN": $("#csrf input").value,
        }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (response.status === 401) {
      location.href = "/Account/Login";
      throw new Error(tr("Вашата сесија заврши. Најавете се повторно."));
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(
        tr("Серверот не можеше да го изврши барањето. Обидете се повторно."),
      );
    }
    if (!response.ok)
      throw Object.assign(new Error(result.error || tr("Проверете го формуларот и обидете се повторно.")), { status: response.status });
    return result;
  }
  function rememberSaved(collection, record) {
    const index = state[collection].findIndex(item => item.id === record.id);
    if (index >= 0) state[collection][index] = record; else state[collection].push(record);
  }
  // Bounded caches support selected records without retaining every visited history page.
  function mergeRecords(current, incoming) {
    const entries = new Map(current.map(item => [item.id, item]));
    for (const item of incoming) { entries.delete(item.id); entries.set(item.id,item); }
    return [...entries.values()].slice(-1500);
  }
  function rememberPage(result) {
    if (result.patients) state.patients = mergeRecords(state.patients,result.patients);
    if (result.items) state.appointments = mergeRecords(state.appointments,result.items);
  }
  function pagingState(kind, filter) {
    let paging = recordPages.get(kind);
    if (!paging) { paging = {page:1,size:12,filter};recordPages.set(kind,paging); }
    if (paging.filter !== filter) { paging.page=1;paging.filter=filter; }
    return paging;
  }
  function workspaceQuery(kind, filter, values = {}) {
    const paging=pagingState(kind,filter), query=new URLSearchParams();
    query.set("skip",String((paging.page-1)*paging.size));query.set("take",String(paging.size));
    for (const [key,value] of Object.entries(values)) if(value !== "" && value != null) query.set(key,String(value));
    return query.toString();
  }
  async function workspacePage(kind, container, path, filter, values) {
    const request=(workspaceRequests.get(kind)||0)+1;workspaceRequests.set(kind,request);
    container.setAttribute("aria-busy","true");
    try {
      const result=await api(path+"?"+workspaceQuery(kind,filter,values));
      if(workspaceRequests.get(kind)!==request || !container.isConnected) return null;
      const paging=recordPages.get(kind),pages=Math.max(1,Math.ceil(result.total/paging.size));
      if(paging.page>pages) { paging.page=pages;return workspacePage(kind,container,path,filter,values); }
      return result;
    } catch(error) {
      if(workspaceRequests.get(kind)===request && container.isConnected) container.innerHTML=`<div class="inline-error" role="alert">${escape(error.message)}</div><button class="btn secondary" data-retry-page="${kind}">${escape(tr("Обиди се повторно"))}</button>`;
      return null;
    } finally {
      if(workspaceRequests.get(kind)===request && container.isConnected) container.removeAttribute("aria-busy");
    }
  }
  document.addEventListener("click",event=>{
    const retry=event.target.closest("[data-retry-page]");if(retry)renderRecordPage(retry.dataset.retryPage);
  });
  async function refreshAfterSave() {
    try { await load(false); return true; }
    catch { toast(tr("Промените се зачувани, но освежувањето не успеа. Освежете подоцна."), true); return false; }
  }
  async function load(render = true) {
    const next = await api("bootstrap");
    if (next.windowed && state?.actor.id === next.actor.id) {
      for (const collection of ["patients", "appointments"]) next[collection] = mergeRecords(state[collection], next[collection]);
    }
    state = next;
    state.specialties ||= []; state.services ||= []; state.doctorServices ||= [];
    // Database collection order is undefined; show a conventional Monday–Sunday week.
    state.doctors.forEach(d => d.workingPeriods.sort((a,b) =>
      (days.indexOf(a.day) + 6) % 7 - (days.indexOf(b.day) + 6) % 7 || a.start.localeCompare(b.start)));
    if (isDoctor()) doctorFilter = state.actor.doctorId;
    if (render) {
      renderPage();
      const url = new URL(location.href), selected = url.searchParams.get("book"), appointment = url.searchParams.get("appointment");
      if (appointment && !selected) {
        url.searchParams.delete("appointment"); history.replaceState(null, "", url.pathname + url.search + url.hash);
        if (state.windowed || state.appointments.some(a => a.id === appointment)) details(appointment);
      }
      if (selected) {
        const date = url.searchParams.get("date"), time = url.searchParams.get("time"), service = url.searchParams.get("serviceId");
        for (const key of ["book", "date", "time", "serviceId"]) url.searchParams.delete(key);
        history.replaceState(null, "", url.pathname + url.search + url.hash);
        if (ownDoctors().some(d => d.id === selected && d.enabled !== false)) openBooking(selected, /^\d{4}-\d{2}-\d{2}$/.test(date || "") && date >= state.today && date <= addDays(state.today,180) ? date : undefined, /^\d{2}:\d{2}$/.test(time || "") ? time : undefined, undefined, undefined, service);
        else toast(tr("Избраниот лекар не е достапен за вашата сметка."), true);
      }
    }
  }
  function navigate(next) {
    search = "";
    specialty = "";
    statusFilter = "";
    listService = ""; listPatient = ""; listFrom = ""; listTo = "";
    location.hash = next;
    if (page === next) renderPage();
  }
  function renderPage() {
    detailRequest++;
    doctorAvailabilityRequest++;
    reportRequest++;
    patientRequest++;
    calendarRequest++;
    if (calendar) {
      calendar.destroy();
      calendar = null;
    }
    page = location.hash.slice(1) || "overview";
    if (page.startsWith("catalogue/")) { const section = page.split("/")[1]; catalogueTab = ["doctors", "specialties", "services"].includes(section) ? section : "doctors"; page = "catalogue"; }
    if (page.startsWith("patient/")) page = "profile";
    const allowed = isPatient()
      ? ["overview", "doctors", "appointments", "profile"]
      : isDoctor()
        ? ["overview", "calendar", "appointments", "patients", "availability", "profile", "doctors"]
        : [
            "overview",
            "calendar",
            "appointments",
            "patients",
            "profile",
            "availability",
            "doctors",
            "reports",
            "catalogue",
          ];
    if (!allowed.includes(page)) page = "overview";
    const navigationPage = page === "profile" && !isPatient() ? "patients" : page === "availability" ? "doctors" : page === "catalogue" ? (catalogueTab === "doctors" ? "doctors" : "catalogue/" + catalogueTab) : page;
    $$(".nav-group").forEach(group => {
      const active = [...group.querySelectorAll("[data-page]")].some(item => item.dataset.page === navigationPage);
      group.classList.toggle("active", active);
      if (active) group.open = true;
    });
    $$(".nav-item").forEach((n) => {
      n.classList.toggle("active", n.dataset.page === navigationPage);
      n.setAttribute(
        "aria-current",
        n.dataset.page === navigationPage ? "page" : "false",
      );
    });
    $("#page-label").textContent = {
      catalogue: tr("Управување"),
      reports: tr("Извештаи"),
      overview: tr("Преглед"),
      calendar: tr("Календар"),
      doctors: isPatient() ? tr("Пронајди лекар") : tr("Лекари"),
      appointments: tr("Термини"),
      patients: tr("Пациенти"),
      profile: isPatient() ? tr("Мој профил") : tr("Профил на пациент"),
      availability: tr("Достапност"),
    }[page];
    $("#zone-label").textContent = state.timeZone;
    ({
      catalogue: renderCatalogue,
      reports: renderReports,
      overview: renderOverview,
      doctors: renderDoctors,
      appointments: renderAppointments,
      calendar: renderCalendar,
      patients: renderPatients,
      profile: renderPatientProfile,
      availability: renderAvailability,
    })[page]();
  }
  function appointmentRow(a) {
    const d = doctor(a.doctorId),
      p = patient(a.patientId);
    const name = isPatient() ? d.name : p?.name || tr("Пациент");
    return html`<button class="appointment-row" data-detail="${a.id}">${avatar(name, Number(d.id.slice(1)))}<span class="row-info"><strong>${escape(name)}</strong><small>${escape(isPatient() ? d.specialty : patientCode(p) + " · " + d.name)}</small></span><span class="row-time">${timeOf(a.start)}<small>${formatDate(dayOf(a.start), { day: "numeric", month: "short" })}</small></span>${badge(a.status)}<span class="muted" aria-hidden="true">${icon("arrow-up-right")}</span></button>`;
  }
  function renderOverview() {
    const future = state.appointments.filter(upcoming).sort((a,b)=>new Date(a.start)-new Date(b.start));
    const today = state.appointments.filter(
      (a) => dayOf(a.start) === state.today && a.status !== "Cancelled",
    );
    const pending = state.appointments.filter((a) => a.status === "Scheduled");
    const firstName = state.actor.name.split(" ")[0];
    const stats = isPatient()
      ? [
          [
            tr("Претстојни прегледи"),
            state.overview?.upcomingCount ?? future.length,
            tr("Добро планирање за поголем спокој"),
            "clock",
          ],
          [
            tr("Лекари и услуги"),
            state.doctors.length,
            tr("Грижа од различни специјалности"),
            "stethoscope",
          ],
          [
            tr("Чека потврда"),
            state.overview?.pendingCount ?? pending.length,
            tr("Терминот е резервиран и чека потврда"),
            "circle-help",
          ],
          [
            tr("Претходни прегледи"),
            state.overview?.closedCount ?? state.appointments.filter((a) =>
              ["Completed", "NoShow"].includes(a.status),
            ).length,
            tr("Историја на вашите термини"),
            "arrow-up-right",
          ],
        ]
      : [
          [
            tr("Денешни термини"),
            state.overview?.todayCount ?? today.length,
            tr("Вашиот ден, добро организиран"),
            "clock",
          ],
          [
            tr("Претстојни прегледи"),
            state.overview?.upcomingCount ?? future.length,
            tr("Следните закажани прегледи"),
            "calendar-days",
          ],
          [
            tr("Чека потврда"),
            state.overview?.pendingCount ?? pending.length,
            tr("Подготвено за ваша проверка"),
            "circle-help",
          ],
          [
            isDoctor() ? tr("Неделно работно време") : tr("Лекари и услуги"),
            isDoctor()
              ? Math.round(
                  Array.from({length:7},(_,i)=>periodsOn(doctor(state.actor.doctorId),addDays(monday(state.today),i))).flat().reduce(
                    (sum, p) =>
                      sum +
                      (Number(p.end.slice(0, 2)) * 60 +
                        Number(p.end.slice(3, 5)) -
                        Number(p.start.slice(0, 2)) * 60 -
                        Number(p.start.slice(3, 5))) /
                        60,
                    0,
                  ),
                )
              : state.doctors.length,
            isDoctor()
              ? tr("Според вашиот работен распоред")
              : tr("Заеднички список на лекари"),
            "stethoscope",
          ],
        ];
    const week = monday(state.today);
    const counts = state.overview?.weekCounts || Array.from(
      { length: 7 },
      (_, i) =>
        state.appointments.filter(
          (a) =>
            dayOf(a.start) === addDays(week, i) && a.status !== "Cancelled",
        ).length,
    );
    const max = Math.max(...counts, 1);
    app.innerHTML =
      heading(
        html`Здраво, ${firstName}.`,
        `${formatDate(state.today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`,
        bookButton(isPatient() ? tr("Закажи преглед") : tr("Нов термин")),
        "",
        true,
      ) +
      (isPatient() ? html`<section class="hero-banner"><div><h2>Одвојте време за себе.<br /><em>Чекор кон подобро здравје.</em></h2><p>Пронајдете го соодветниот специјалист и термин што ви одговара. Сите детали ќе бидат на едно место.</p><button class="btn primary" data-nav="doctors">Пронајди лекар <span aria-hidden="true">${icon("arrow-up-right")}</span></button></div><div class="hero-visual" aria-hidden="true"><span class="hero-plus"><img src="/images/company-mark.svg" width="100" height="100" alt="" /></span><span class="hero-tag">Вашето здравје. Вашето темпо.</span></div></section>` : "") +
      html`<section class="stats-grid" aria-label="Преглед на термините">${stats.map(([label, value, note, symbol]) => `<div class="stat-card"><span class="stat-label">${label}</span><span class="stat-symbol" aria-hidden="true">${icon(symbol)}</span><strong class="stat-value">${value}</strong><div class="stat-note">${note}</div></div>`).join("")}</section>
        <div class="overview-grid"><section class="card"><div class="card-head"><h3>${isPatient() ? tr("Вашите следни термини") : tr("Следни термини")}</h3><button class="section-link" data-nav="appointments">Прикажи ги сите ${icon("arrow-up-right")}</button></div>${future.length ? future.slice(0, 6).map(appointmentRow).join("") : empty(tr("Нема претстојни термини"), tr("Немате претстојни термини. Изберете лекар за следниот преглед."))}</section><div><section class="card"><div class="card-head"><h3>Преглед на неделата</h3><span class="muted" style="font-size:0.8125rem">${formatDate(week, { day: "numeric", month: "short" })}</span></div><div class="card-body"><div class="week-chart" aria-label="Број на термини по денови">${counts.map((n, i) => `<div class="chart-col ${addDays(week, i) === state.today ? "current" : ""}"><span class="chart-count">${n}</span><div class="chart-bar" style="height:${Math.max(3, (n / max) * 105)}px"></div><small>${[tr("пон."), tr("вто."), tr("сре."), tr("чет."), tr("пет."), tr("саб."), tr("нед.")][i]}</small></div>`).join("")}</div><div class="week-chart-caption">${counts.reduce((a, b) => a + b, 0)} термини · од понеделник до недела</div></div></section><section class="card" style="margin-top:20px"><div class="card-head"><h3>Брз пристап</h3></div><div class="quick-list"><button data-nav="${isPatient() ? "doctors" : "calendar"}"><span>${isPatient() ? tr("Разгледајте ги можностите за преглед") : tr("Отворете го календарот")}<small>${isPatient() ? tr("Пронајдете специјалист за следниот преглед") : tr("Дневен, неделен и месечен приказ")}</small></span>${icon("arrow-up-right")}</button><button data-nav="${isPatient() ? "appointments" : "availability"}"><span>${isPatient() ? tr("Управувајте со вашите термини") : tr("Работно време и отсуства")}<small>${isPatient() ? tr("Презакажете или откажете претстоен преглед") : tr("Ажурирајте ја вашата достапност")}</small></span>${icon("arrow-up-right")}</button></div></section></div></div>`;
  }
  function filteredDoctors() {
    return ownDoctors().filter(
      (d) =>
        (!isPatient() || d.enabled !== false) &&
        (!specialty || d.specialty === specialty) &&
        (!doctorService || servicesFor(d.id).some(s => s.id === doctorService)) &&
        (!search ||
          `${d.name} ${d.specialty} ${servicesFor(d.id).map(s => s.name).join(" ")}`
            .toLocaleLowerCase()
            .includes(search.toLocaleLowerCase())),
    ).sort(compareRecords);
  }
  const recordViews = {};
  function recordView(kind, fallback = "cards") {
    if (!recordViews[kind]) {
      try { recordViews[kind] = localStorage.getItem("termino.view." + kind); } catch { /* Optional preference. */ }
    }
    return ["cards", "list"].includes(recordViews[kind]) ? recordViews[kind] : fallback;
  }
  function viewSwitch(kind, fallback = "cards") {
    const selected = recordView(kind, fallback);
    return html`<div class="view-switch" role="group" aria-label="Приказ">${[["list", tr("Листа"), "list"], ["cards", tr("Картички"), "layout-grid"]].map(([value, label, iconName]) => `<button type="button" data-records-view="${value}" data-records-kind="${kind}" aria-pressed="${selected === value}" class="${selected === value ? "active" : ""}">${icon(iconName)}${label}</button>`).join("")}</div>`;
  }
  const recordPages = new Map();
  function paged(kind, rows, filter = "", total = null) {
    const paging = pagingState(kind,filter), count = total ?? rows.length;
    const pages = Math.max(1,Math.ceil(count/paging.size));
    paging.page = Math.max(1,Math.min(paging.page,pages));
    const start = (paging.page-1)*paging.size;
    const button = (number,label,disabled=false) => `<button type="button" class="btn secondary small" data-pagination="${kind}" data-page-number="${number}" ${disabled ? "disabled" : ""} aria-label="${escape(label)}">${escape(label)}</button>`;
    let controls = "";
    if (count > 12 || paging.size !== 12) {
      const numbers = [...new Set([1,pages,...Array.from({length:5},(_,i)=>paging.page+i-2).filter(n=>n>=1&&n<=pages)])].sort((a,b)=>a-b);
      controls = `<nav class="records-pagination" data-pagination-nav="${kind}" aria-label="${escape(tr("Страници со резултати"))}" tabindex="-1"><span role="status">${escape(tr("Прикажани {0}–{1} од {2}",count ? start+1 : 0,Math.min(start+paging.size,count),count))}</span><div class="records-page-buttons">${button(paging.page-1,tr("Претходна"),paging.page===1)}${numbers.map((n,i)=>(i && n>numbers[i-1]+1 ? '<span aria-hidden="true">…</span>' : '')+`<button type="button" class="btn secondary small" data-pagination="${kind}" data-page-number="${n}" aria-label="${escape(tr("Страница {0}",n))}" ${n===paging.page ? 'aria-current="page"' : ''}>${n}</button>`).join("")}${button(paging.page+1,tr("Следна"),paging.page===pages)}</div><label>${escape(tr("По страница"))}<select data-page-size="${kind}">${[12,24,48].map(n=>`<option ${n===paging.size ? 'selected' : ''}>${n}</option>`).join("")}</select></label></nav>`;
    }
    return {items:total === null ? rows.slice(start,start+paging.size) : rows,controls};
  }
  const doctorPage = () => paged("doctors",filteredDoctors(),JSON.stringify([search,specialty,doctorService]));
  const currentDoctorPage = () => doctorPage().items;
  function revealRecord(kind, rows, id, filter = "") {
    const size = recordPages.get(kind)?.size || 12;
    recordPages.set(kind,{page:Math.floor(Math.max(0,rows.findIndex(item => item.id === id))/size)+1,size,filter});
  }
  function renderRecordPage(kind) {
    if (kind === "doctors") return doctorResults();
    if (kind === "patients") return patientResults();
    if (kind === "appointments") return appointmentResults();
    if (kind === "patient-history") return patientAppointmentResults();
    return renderCatalogue();
  }
  document.addEventListener("change", async e => {
    const kind=e.target.dataset.pageSize, paging=recordPages.get(kind);
    if (!paging || ![12,24,48].includes(Number(e.target.value))) return;
    paging.size=Number(e.target.value);paging.page=1;await renderRecordPage(kind);
    document.querySelector(`[data-page-size="${kind}"]`)?.focus();
  });
  const recordActionIcons = { profile: "user-round", book: "calendar-check", hours: "clock", edit: "pencil" };
  function recordAction(action, id, label, iconName, variant = "secondary", description = label) {
    return `<button type="button" class="record-action record-action-${variant}" data-${action}="${escape(id)}" title="${escape(description)}" aria-label="${escape(description)}">${icon(recordActionIcons[iconName])}<span>${escape(label)}</span></button>`;
  }

  const byAgreement = d => !d.workingPeriods.length;
  const patientBookingBlocked = d => isPatient() && (d.staffOnly || byAgreement(d));
  function doctorActions(d) {
    if (patientBookingBlocked(d)) return recordAction("profile", d.id, tr("Види профил"), "profile") + `<button type="button" class="record-action record-action-primary" disabled aria-describedby="doctor-contact-${escape(d.id)}" title="${escape(tr("Контактирајте го лекарот или рецепцијата."))}">${icon("calendar-check")}<span>${escape(tr("Пронајди термин"))}</span></button>`;
    return recordAction("profile", d.id, tr("Види профил"), "profile") +
      recordAction("book", d.id, tr("Пронајди термин"), "book", "primary");
  }
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !event.target.closest(".doctor-menu")) return;
    const menu = event.target.closest(".doctor-menu"); menu.open = false; menu.querySelector("summary").focus();
  });
  function doctorMenu(d) {
    if (isPatient()) return "";
    return html`<details class="doctor-menu"><summary aria-label="Постапки за ${escape(d.name)}" title="Повеќе постапки">${icon("ellipsis")}</summary><div class="doctor-menu-items">${recordAction("availability", d.id, tr("Достапност"), "hours", "secondary", tr("Достапност и работно време"))}${isAdmin() ? recordAction("doctor-edit", d.id, tr("Измени"), "edit") : ""}</div></details>`;
  }

  function renderDoctors() {
    app.innerHTML =
      heading(
        isPatient() ? tr("Соодветна грижа за вас.") : tr("Лекари"),
        tr("Разгледајте ги специјалистите и нивните работни распореди."),
        isAdmin() ? html("<button class=\"btn primary\" id=\"catalogue-add\" data-action=\"add-doctor\"><svg class=\"ui-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><use href=\"/icons/interface.svg#plus\"></use></svg> Додај лекар</button>") : "",
        "",
      ) +
      html`<div class="toolbar"><div class="search-field"><label class="visually-hidden" for="doctor-search">Пребарај лекари</label><input id="doctor-search" placeholder="Име на лекар, специјалност или услуга…" value="${escape(search)}" /></div><label class="visually-hidden" for="specialty">Специјалност</label><select id="specialty"><option value="">Сите специјалности</option>${[
        ...new Set(ownDoctors().map((d) => d.specialty)),
      ]
        .sort()
        .map(
          (s) =>
            `<option ${s === specialty ? "selected" : ""}>${escape(s)}</option>`,
        )
        .join("")}</select><label class="visually-hidden" for="doctor-service-filter">Услуга / преглед</label><select id="doctor-service-filter"><option value="">Сите услуги / прегледи</option>${state.services.filter(s => s.enabled).map(s => `<option value="${s.id}" ${doctorService === s.id ? "selected" : ""}>${escape(s.name)}</option>`).join("")}</select></div><details class="card doctor-availability-search" id="doctor-availability-search"><summary>${icon("calendar-check")} <span>Пребарај слободни термини<span class="availability-search-caption">Според избраната специјалност и услуга, кај сите соодветни лекари.</span></span>${icon("chevron-down")}</summary><div class="availability-search-body"><form id="doctor-availability-form"><label for="doctor-availability-date">Изберете датум<input type="date" id="doctor-availability-date" value="${state.today}" min="${state.today}" max="${addDays(state.today,180)}" required></label><button class="btn primary" type="submit">Пребарај термини ${icon("search")}</button></form><div id="doctor-availability-results" aria-live="polite"><p class="muted">Изберете датум и пребарајте слободни термини кај соодветните лекари.</p></div></div></details><div id="doctor-results"></div>`;
    $("#doctor-search").addEventListener("input", (e) => {
      search = e.target.value;
      invalidateDoctorAvailability();
      doctorResults();
    });
    $("#specialty").addEventListener("change", (e) => {
      specialty = e.target.value;
      invalidateDoctorAvailability();
      doctorResults();
    });
    $("#doctor-service-filter").addEventListener("change", e => { doctorService = e.target.value; invalidateDoctorAvailability(); doctorResults(); });
    searchableBookingSelect($("#doctor-service-filter"), tr("Пребарајте услуга…"));
    $("#doctor-availability-form").addEventListener("submit", searchDoctorAvailability);
    $("#doctor-availability-date").addEventListener("change", invalidateDoctorAvailability);
    $("#doctor-availability-results").addEventListener("click", e => {
      const more = e.target.closest('[data-more-availability]');
      if (more && doctorAvailabilityResults) { doctorAvailabilityResults.visible += 12; renderDoctorAvailability(); return; }
      const choice = e.target.closest('[data-available-choice]');
      const row = choice && doctorAvailabilityResults?.rows[Number(choice.dataset.availableChoice)];
      if (row?.service && !servicesFor(row.doctor.id).some(service => service.id === row.service.id)) {
        invalidateDoctorAvailability(); toast(tr("Изберете достапна услуга за лекарот."),true); return;
      }
      if (row) openBooking(row.doctor.id,row.slot.date,row.slot.time.slice(0,5),undefined,undefined,row.service?.id);
    });
    doctorResults();
  }
  function invalidateDoctorAvailability() {
    doctorAvailabilityRequest++; doctorAvailabilityResults = null;
    const results = $("#doctor-availability-results"), button = $("#doctor-availability-form button");
    if (results) { results.removeAttribute("aria-busy"); results.innerHTML = `<p class="muted">${escape(tr("Филтрите се променети. Пребарајте повторно."))}</p>`; }
    if (button) button.disabled = false;
  }
  async function searchDoctorAvailability(event) {
    event.preventDefault(); const form = event.currentTarget, target = $("#doctor-availability-results"), button = form.querySelector('button');
    if (!window.MedTerminDates.validate(form) || !form.reportValidity() || button.disabled) return;
    const date = $("#doctor-availability-date").value, request = ++doctorAvailabilityRequest;
    const formRevision = window.MedTerminFormState?.revision(form);
    const current = () => request === doctorAvailabilityRequest && page === "doctors" && target.isConnected;
    const tasks = filteredDoctors().filter(d => d.enabled !== false && !patientBookingBlocked(d)).flatMap(d => {
      const services = servicesFor(d.id).filter(v => !doctorService || v.id === doctorService);
      if (!services.length && !doctorService && !state.doctorServices.some(v => v.doctorId === d.id)) return [{doctor:d,service:null}];
      return services.map(service => ({doctor:d,service}));
    });
    doctorAvailabilityResults = null; button.disabled = true; target.setAttribute("aria-busy","true");
    let cursor = 0, finished = 0; const rows = [], errors = [];
    const worker = async () => {
      while (cursor < tasks.length && current()) {
        const task = tasks[cursor++], query = new URLSearchParams({doctorId:task.doctor.id,date});
        if (task.service) query.set("serviceId",task.service.id);
        try {
          const slots = await api("slots?"+query);
          for (const slot of slots) rows.push({...task,slot});
        } catch(error) { errors.push(error.message); }
        finished++;
        if (current()) target.textContent = tr("Проверени услуги: {0} од {1}.",finished,tasks.length);
      }
    };
    target.textContent = tr("Се проверуваат слободните термини…");
    await Promise.all(Array.from({length:Math.min(4,tasks.length)},worker));
    if (!current()) return;
    rows.sort((a,b) => new Date(a.slot.start)-new Date(b.slot.start) || compareRecords(a.doctor,b.doctor) || (a.service?.name||"").localeCompare(b.service?.name||"",locale));
    if (!errors.length) window.MedTerminFormState?.saved(form,formRevision);
    doctorAvailabilityResults = {rows,visible:12,date,errors}; target.removeAttribute("aria-busy"); button.disabled = false;
    renderDoctorAvailability();
  }
  function renderDoctorAvailability() {
    const result = doctorAvailabilityResults, target = $("#doctor-availability-results"); if (!result || !target) return;
    const warning = result.errors.length ? `<div class="inline-error" role="alert">${escape(tr("Дел од достапноста не можеше да се провери. Пребарајте повторно."))} ${escape(result.errors[0])}</div>` : "";
    target.innerHTML = warning + (result.rows.length ? `<p class="results-count">${escape(tr("Слободни термини: {0}",result.rows.length))}</p><div class="availability-search-list">${result.rows.slice(0,result.visible).map((r,i) => `<button type="button" class="availability-search-choice" data-available-choice="${i}"><strong>${escape(r.slot.time.slice(0,5))}</strong><span><b>${escape(r.doctor.name)}</b><small>${escape(r.service?.name || tr("Преглед"))} · ${escape(r.doctor.specialty)}</small></span>${icon("arrow-up-right")}</button>`).join("")}</div>${result.visible < result.rows.length ? `<button class="btn secondary small" type="button" data-more-availability>${escape(tr("Прикажи повеќе термини"))}</button>` : ""}` : result.errors.length ? "" : `<p class="inline-note">${escape(tr("Нема слободни термини за избраните филтри и датум. Променете ги филтрите или датумот; за термин по договор контактирајте ја рецепцијата."))}</p>`);
  }
  // This legacy sentinel is application metadata, not a translated record value.
  const fundingLabel = d => !d.funding || d.funding === "Не е наведено"
    ? tr("Не е наведен начин на финансирање") : d.funding;
  function visitDurationLabel(d) {
    const offered = servicesFor(d.id).filter(s => !doctorService || s.id === doctorService);
    if (!offered.length) return state.doctorServices.some(link => link.doctorId === d.id) ? tr("Нема активна услуга за овој лекар.") : html`Стандарден преглед · ${d.durationMinutes} мин.`;
    const values = offered.map(s => s.durationMinutes), from = Math.min(...values), to = Math.max(...values);
    return `${from === to ? from : from + "–" + to} ${tr("мин.")}`;
  }
  function doctorResults() {
    const all = filteredDoctors(), {items:list,controls} = doctorPage();
    const status = d => d.enabled === false ? tr("Неактивен") : d.staffOnly ? tr("Закажување преку рецепција") : d.workingPeriods.length ? tr("Утврдено работно време") : tr("По договор");
    const cards = `<div class="doctor-grid">${list.map((d, i) => html`<article class="card doctor-card"><div class="doctor-card-top">${avatar(d.name, i)}<span class="badge">${status(d)}</span>${doctorMenu(d)}</div><h3>${escape(d.name)}</h3><div class="specialty">${escape(d.specialty)}</div><div class="doctor-card-meta"><span>${icon("clock")} ${d.durationMinutes} ${tr("мин.")}</span><span>${escape(fundingLabel(d))}</span></div><div class="doctor-next-slot" data-next-doctor="${d.id}" aria-live="polite">${byAgreement(d) || patientBookingBlocked(d) ? `<span id="doctor-contact-${escape(d.id)}">${escape(tr("Контактирајте го лекарот или рецепцијата."))}</span>` : tr("Се проверува првиот слободен термин…")}</div><div class="doctor-card-actions doctor-actions">${doctorActions(d)}</div></article>`).join("")}</div>`;
    const table = html`<section class="card table-wrap records-table" tabindex="0" aria-label="Листа со постапки"><table><thead><tr><th>Лекар / профил</th><th>Специјалност</th><th>Достапност</th><th>Постапки</th></tr></thead><tbody>${list.map(d => html`<tr><td><div class="doctor-list-heading"><strong>${escape(d.name)}</strong>${doctorMenu(d)}</div><small>${d.durationMinutes} ${tr("мин.")} · ${escape(fundingLabel(d))}</small></td><td>${escape(d.specialty)}${d.subspecialty ? `<small>${escape(d.subspecialty)}</small>` : ""}</td><td><span class="badge">${status(d)}</span><div class="doctor-next-slot" data-next-doctor="${d.id}" aria-live="polite">${byAgreement(d) || patientBookingBlocked(d) ? `<span id="doctor-contact-${escape(d.id)}">${escape(tr("Контактирајте го лекарот или рецепцијата."))}</span>` : tr("Се проверува првиот слободен термин…")}</div></td><td><div class="record-actions doctor-actions">${doctorActions(d)}</div></td></tr>`).join("")}</tbody></table></section>`;
    $("#doctor-results").innerHTML = html`<div class="records-heading"><p class="results-count">${all.length} лекари и услуги</p>${viewSwitch("doctors")}</div>` + (list.length ? recordView("doctors") === "list" ? table : cards : empty(tr("Не се пронајдени лекари"), tr("Обидете се со друго име или специјалност."))) + controls;
    refreshFirstSlots();
  }
  function refreshFirstSlots() {
    if (page !== "doctors" || !$("#doctor-results")) return;
    clearTimeout(nextSlotTimer);
    const list = currentDoctorPage().filter(d => !byAgreement(d) && !patientBookingBlocked(d)), request = ++nextSlotRequest;
    if (list.length) nextSlotTimer = setTimeout(() => loadFirstSlots(list, request), 140);
  }
  async function loadFirstSlots(list, request) {
    if (request !== nextSlotRequest || page !== "doctors") return;
    try {
      for (let start = 0; start < list.length; start += 100) {
        const result = await api(`availability/next?doctorIds=${encodeURIComponent(list.slice(start, start + 100).map(d => d.id).join(","))}&from=${state.today}&serviceId=${encodeURIComponent(doctorService)}`);
        if (request !== nextSlotRequest || page !== "doctors") return;
        for (const item of result) {
          const el = $$("[data-next-doctor]").find(e => e.dataset.nextDoctor === item.doctorId);
          if (!el) continue;
          const focused = el.contains(document.activeElement), selectedService = state.services.find(s => s.id === item.serviceId);
          el.innerHTML = item.slot ? `<span>${escape(tr("Прв слободен термин"))}</span><button type="button" class="next-slot-button">${escape(formatDate(item.slot.date, {day:"numeric",month:"short",weekday:"short"}))} · ${item.slot.time.slice(0,5)} ${icon("arrow-up-right")}</button>${selectedService ? `<small>${escape(selectedService.name)}</small>` : ""}`
            : `<span>${escape(item.reason === "ReceptionOnly" ? tr("За термин контактирајте ја рецепцијата.") : item.reason === "Inactive" ? tr("Неактивен лекар") : item.reason === "NoActiveServices" ? tr("Нема активна услуга за овој лекар.") : tr("Нема слободни термини во следните 180 дена. Проверете со лекарот за термин по договор."))}</span>`;
          el.querySelector("button")?.addEventListener("click", () => openBooking(item.doctorId, item.slot.date, item.slot.time.slice(0,5), undefined, undefined, item.serviceId));
          if (focused) { const target = el.querySelector("button") || el; if (target === el) el.tabIndex = -1; target.focus({preventScroll:true}); }
        }
      }
    } catch (e) {
      if (request !== nextSlotRequest || page !== "doctors") return;
      const requested = new Set(list.map(d => d.id));
      $$("[data-next-doctor]").filter(el => requested.has(el.dataset.nextDoctor)).forEach(el => { el.textContent = tr("Достапноста не може да се вчита. Обидете се повторно."); });
    }
  }
  function periodsOn(d, date) {
    const dated = d.workingPeriods.filter(p => p.validFrom && p.validFrom <= date && p.validTo >= date);
    return (dated.length ? dated : d.workingPeriods.filter(p => !p.validFrom)).filter(p => p.day === days[new Date(date + "T12:00:00Z").getUTCDay()]);
  }
  function scheduleList(d, fromDate = state.today) {
    const start = monday(fromDate);
    return d.workingPeriods.length
      ? `<p class="filter-description">${formatDate(start)} – ${formatDate(addDays(start, 6))}</p><ul class="schedule-summary">${[1, 2, 3, 4, 5, 6, 0]
          .map((i) => {
            const date = addDays(start, (i + 6) % 7);
            const periods = periodsOn(d, date);
            return `<li><span>${dayLabels[i]}</span><strong>${periods.length ? periods.map((p) => p.start.slice(0, 5) + " – " + p.end.slice(0, 5)).join(", ") : "—"}</strong></li>`;
          })
          .join("")}</ul>`
      : html`<div class="inline-note warning">Не е наведено точно работно време. Рецепцијата или лекарот треба да договорат термин и да додадат период на достапност.</div>`;
  }
  function openDialog(title, content, eyebrow = tr("МЕДТЕРМИН")) {
    detailRequest++;
    lastFocus = document.activeElement;
    $("#dialog-title").textContent = title;
    $("#dialog-eyebrow").textContent = eyebrow;
    $("#dialog-eyebrow").hidden = !eyebrow;
    $("#dialog-content").innerHTML = content;
    if (!dialog.open) dialog.showModal();
  }
  function closeDialog() {
    detailRequest++;
    dialog.close();
    booking = null;
    slotRequest++;
    lastFocus?.focus();
    refreshFirstSlots();
  }
  function profile(id) {
    const d = doctor(id);
    openDialog(
      isPatient() ? tr("Запознајте го вашиот лекар") : tr("Профил на лекар"),
      html`<div class="profile-header">${avatar(d.name, Number(id.slice(1)), "lg")}<div><h3>${escape(d.name)}</h3><p>${escape(d.specialty)}</p></div></div><div class="form-row"><div><label>Времетраење на прегледот</label><p>${escape(visitDurationLabel(d))}</p></div><div><label>Начин на закажување</label><p style="font-size:0.9375rem">${d.staffOnly ? tr("Преку рецепција") : d.requiresConfirmation ? tr("Онлајн, со потврда од персоналот") : tr("Онлајн закажување")}</p></div></div>${d.subspecialty ? html`<p class="inline-note">Субспецијалност: ${escape(d.subspecialty)}</p>` : ""}<h3>Услуги и прегледи</h3>${servicesFor(d.id).length ? `<ul class="schedule-summary">${servicesFor(d.id).map(x => html`<li><span>${escape(x.name)}</span><strong>${x.durationMinutes} мин.</strong></li>`).join("")}</ul>` : html("<p class=\"inline-note\">Засега нема заведени активни услуги за овој профил.</p>")}<h3>Работен распоред</h3>${scheduleList(d)}<div class="dialog-actions">${d.enabled === false ? html("<span class=\"inline-note\">Лекарот е неактивен за нови закажувања.</span>") : patientBookingBlocked(d) ? html`<span class="inline-note">Контактирајте го лекарот или рецепцијата.</span><button class="btn primary" disabled>Пронајди термин</button>` : html`<button class="btn primary" data-book="${d.id}">Пронајди термин ${icon("arrow-up-right")}</button>`}</div>`,
      tr("ПРОФИЛ НА ЛЕКАР"),
    );
  }
  function renderAppointments() {
    app.innerHTML =
      heading(
        isPatient() ? tr("Вашите термини.") : tr("Термини"),
        tr("Следете ги претстојните и претходните прегледи."),
        bookButton(),
      ) +
      html`<div class="chip-tabs" role="group" aria-label="Период на термините">${["upcoming", "previous", "all"].map((t) => `<button data-list-tab="${t}" class="${listTab === t ? "active" : ""}" aria-pressed="${listTab === t}">${({ upcoming: tr("Претстојни"), previous: tr("Претходни"), all: tr("Сите") })[t]}</button>`).join("")}</div><section class="card workspace-filters appointment-filters"><div class="card-head"><div><h3>Филтри на термините</h3><p class="filter-description">Филтрите се комбинираат во избраниот приказ. Датумите ги вклучуваат двата дена.</p></div><button class="btn secondary small" id="clear-appointment-filters">Исчисти</button></div><div class="card-body"><div class="report-filter-grid"><label>Пребарај<input id="appointment-search" placeholder="Име на лекар или пациент…" value="${escape(search)}"></label>${isAdmin() ? html`<label>Лекар<select id="list-doctor">${doctorOptions(doctorFilter, true)}</select></label>` : ""}${!isPatient() ? html`<label>Пациент<select id="list-patient"><option value="">Сите пациенти</option>${state.patients.filter(p => isAdmin() || state.appointments.some(a => a.patientId === p.id)).map(p => `<option value="${p.id}" ${listPatient === p.id ? "selected" : ""}>${escape(patientLabel(p))}</option>`).join("")}</select></label>` : ""}<label>Статус<select id="status-filter"><option value="">Сите статуси</option>${statuses.map(status => `<option value="${status}" ${statusFilter === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}</select></label><label>Услуга<select id="list-service">${serviceOptions(listService)}</select></label><label>Од датум<input id="list-from" type="date" value="${listFrom}"></label><label>До датум<input id="list-to" type="date" value="${listTo}"></label></div><div id="appointment-filter-error" class="filter-error" role="alert"></div></div></section><div id="appointment-results"></div>`;
    $("#list-patient")?.addEventListener("change", e => { listPatient = e.target.value; appointmentResults(); });
    $("#list-from").onchange = e => { listFrom = e.target.value; appointmentResults(); };
    $("#list-to").onchange = e => { listTo = e.target.value; appointmentResults(); };
    $("#clear-appointment-filters").onclick = () => {
      search = ""; statusFilter = ""; listService = ""; listPatient = ""; listFrom = ""; listTo = "";
      doctorFilter = isDoctor() ? state.actor.doctorId : ""; renderAppointments();
    };
    $("#list-service").onchange = e => { listService = e.target.value; appointmentResults(); };
    $("#appointment-search").addEventListener("input", (e) => {
      search = e.target.value;
      appointmentResults();
    });
    $("#status-filter").addEventListener("change", (e) => {
      statusFilter = e.target.value;
      appointmentResults();
    });
    $("#list-doctor")?.addEventListener("change", (e) => {
      doctorFilter = e.target.value;
      appointmentResults();
    });
    if(state.windowed)searchableBookingSelect($("#list-patient"),tr("Пребарајте пациент…"));
    appointmentResults();
  }
  async function appointmentResults() {
    const invalid = listFrom && listTo && listFrom > listTo;
    $("#appointment-filter-error").textContent = invalid ? tr("Почетниот датум не смее да биде по крајниот датум.") : "";
    if (invalid) { $("#appointment-results").innerHTML = ""; return; }
    const filter = JSON.stringify([listTab,listService,listPatient,listFrom,listTo,statusFilter,search,doctorFilter]);
    let total = null, list;
    if (state.windowed) {
      const result = await workspacePage("appointments",$("#appointment-results"),"workspace/appointments",filter,
        {period:listTab,serviceId:listService,patientId:listPatient,from:listFrom,to:listTo,status:statusFilter,search,doctorId:doctorFilter});
      if (!result) return;
      rememberPage(result);list=result.items;total=result.total;
    } else list = state.appointments
      .filter(
        (a) =>
          (listTab === "all" ||
            (listTab === "upcoming" ? upcoming(a) : !upcoming(a))) &&
          (!doctorFilter || a.doctorId === doctorFilter) &&
          (!listService || serviceKey(a) === listService) &&
          (!listPatient || a.patientId === listPatient) &&
          (!listFrom || dayOf(a.start) >= listFrom) &&
          (!listTo || dayOf(a.start) <= listTo) &&
          (!statusFilter || a.status === statusFilter) &&
          (!search ||
            `${doctor(a.doctorId)?.name} ${patientLabel(patient(a.patientId))}`
              .toLocaleLowerCase()
              .includes(search.toLocaleLowerCase())),
      )
      .sort((a, b) =>
        listTab === "previous"
          ? new Date(b.start) - new Date(a.start) || a.id.localeCompare(b.id)
          : new Date(a.start) - new Date(b.start) || a.id.localeCompare(b.id),
      );
    const {items,controls} = paged("appointments",list,filter,total);
    $("#appointment-results").innerHTML =
      html`<p class="results-count">${total ?? list.length} термини</p><section class="card table-wrap">${
        list.length
          ? html`<table><thead><tr><th>${isPatient() ? tr("Лекар") : tr("Пациент")}</th>${isPatient() ? "" : html("<th>Лекар</th>")}<th>Датум и време</th><th>Статус</th><th><span class="visually-hidden">Постапки</span></th></tr></thead><tbody>${items
              .map((a) => {
                const d = doctor(a.doctorId),
                  p = patient(a.patientId),
                  name = isPatient() ? d.name : p?.name || tr("Пациент");
                return html`<tr><td><div class="table-person">${avatar(name, Number(d.id.slice(1)))}<span><strong>${escape(name)}</strong><small>${escape(isPatient() ? d.specialty : patientCode(p))}</small></span></div></td>${isPatient() ? "" : `<td>${escape(d.name)}</td>`}<td class="table-date"><strong>${formatDate(dayOf(a.start))}</strong><small>${timeOf(a.start)} – ${timeOf(a.end)}</small></td><td>${badge(a.status)}</td><td><button class="table-action" data-detail="${a.id}">Детали ${icon("arrow-up-right")}</button></td></tr>`;
              })
              .join("")}</tbody></table>`
          : empty(
              tr("Засега нема термини"),
              tr("Обидете се со друг филтер или закажете нов термин."),
            )
      }</section>` + controls;
  }
  let detailRequest = 0;
  async function details(id, committed = false) {
    if (state.windowed && !committed) {
      const request = ++detailRequest;
      try {
        const result=await api("workspace/appointments/"+encodeURIComponent(id));
        if(request!==detailRequest) return;
        state.appointments=mergeRecords(state.appointments,[result.appointment]);
        state.patients=mergeRecords(state.patients,[result.patient]);
      } catch(error) { if(request===detailRequest)toast(error.message,true);return; }
    }
    const a = state.appointments.find((a) => a.id === id);
    if (!a) {
      toast(tr("Овој термин повеќе не е достапен."), true);
      return;
    }
    const d = doctor(a.doctorId),
      p = patient(a.patientId);
    const future = upcoming(a);
    const overduePending = a.status === "Scheduled" && new Date(a.start) <= new Date();
    const resolvePending = !isPatient() && overduePending;
    const complete =
      !isPatient() && ["Confirmed", "Scheduled"].includes(a.status) && new Date(a.end) <= new Date();
    openDialog(
      tr("Детали за терминот"),
      html`<div class="booking-context">${avatar(d.name, Number(d.id.slice(1)))}<div><strong>${escape(d.name)}</strong><small>${escape(d.specialty)}</small></div></div>${badge(a.status)}<dl class="detail-list"><div><dt>Пациент</dt><dd>${escape(p?.name || tr("Пациент"))}${patientNumber(p)}</dd></div><div><dt>Датум</dt><dd>${formatDate(dayOf(a.start), { weekday: "short", day: "numeric", month: "long", year: "numeric" })}</dd></div><div><dt>Време</dt><dd>${timeOf(a.start)} – ${timeOf(a.end)}</dd></div><div><dt>Услуга</dt><dd>${escape(a.serviceName || tr("Без заведена услуга"))}</dd></div><div><dt>Број на резервација</dt><dd>CL-${a.id.slice(0, 8).toUpperCase()}</dd></div><div><dt>Времетраење</dt><dd>${Math.round((new Date(a.end) - new Date(a.start)) / 60000)} минути</dd></div></dl>${a.status === "Scheduled" ? `<div class="inline-note warning">${overduePending ? (isPatient() ? tr("Времето за потврда е изминато. Контактирајте ја рецепцијата за исходот на терминот.") : tr("Времето за потврда е изминато. Евидентирајте откажување, или по крајот на терминот означете завршен преглед / недоаѓање. Исходот се запишува во историјата.")) : tr("Терминот е резервиран и чека потврда од персоналот. Не е испратено известување.")}</div>` : ""}<section class="appointment-history"><div class="history-heading"><h3>Историја на терминот</h3></div><div id="appointment-history" aria-live="polite"></div></section><div id="detail-error"></div><div class="dialog-actions">${future || resolvePending ? html`<button class="btn danger" data-status="Cancelled" data-id="${id}">Откажи преглед</button>${future && (!isPatient() || !d.staffOnly) ? html`<button class="btn secondary" data-move="${id}">Презакажи</button>` : ""}` : ""}${!isPatient() && future && a.status === "Scheduled" ? html`<button class="btn primary" data-status="Confirmed" data-id="${id}">Потврди преглед</button>` : ""}${complete ? html`<button class="btn secondary" data-status="NoShow" data-id="${id}">Означи недоаѓање</button><button class="btn primary" data-status="Completed" data-id="${id}">Заврши преглед</button>` : ""}${!future && !complete && !resolvePending ? html("<button class=\"btn secondary\" data-action=\"close\">Затвори</button>") : ""}</div>`,
      tr("ТЕРМИН · CL-") + a.id.slice(0, 8).toUpperCase(),
    );
    loadAppointmentHistory(id);
  }
  async function loadAppointmentHistory(id) {
    const target = $("#appointment-history");
    if (!target) return;
    target.innerHTML = html("<div class=\"loading-state\" role=\"status\"><span class=\"spinner\"></span> Се вчитува историјата…</div>");
    try {
      const result = await api(`appointments/${encodeURIComponent(id)}/history`);
      if ($("#appointment-history") !== target || !dialog.open) return;
      const role = value => ({ Administrator: tr("Рецепција / администратор"), Doctor: tr("Лекар"), Patient: tr("Пациент") })[value] || tr("Корисник");
      const range = (start, end) => `${formatDate(dayOf(start), { day: "numeric", month: "short", year: "numeric" })} · ${timeOf(start)}–${timeOf(end)}`;
      const title = h => h.kind === "Created" ? tr("Креиран термин") : h.kind === "Rescheduled" ? tr("Презакажан термин") : h.afterStatus === "Cancelled" ? html`Откажан термин · ${role(h.actorRole)}` : html`Статус: ${statusLabel(h.afterStatus)}`;
      target.innerHTML = `${!result.hasCreationRecord ? html("<p class=\"inline-note\">Овој термин е креиран пред воведувањето на деталната историја. Претходните промени и нивните автори не се реконструирани.</p>") : ""}
        ${result.currentVersion !== state.appointments.find(a => a.id === id)?.version ? html("<p class=\"inline-note warning\">Терминот е променет во друга сесија. <button class=\"link-button\" id=\"refresh-history-detail\">Освежи детали</button></p>") : ""}
        ${result.entries.length ? html`<ol class="history-timeline" tabindex="0" aria-label="Промени на терминот, од најнова до најстара">${result.entries.map(h => `<li><div class="history-event-head"><strong>${escape(title(h))}</strong><span class="muted">#${h.appointmentVersion}</span></div><p class="history-author">${escape(h.actorName)} · ${escape(role(h.actorRole))}</p><time datetime="${escape(h.occurredAt)}">${escape(formatDate(dayOf(h.occurredAt), { day: "numeric", month: "short", year: "numeric" }))} · ${escape(timeOf(h.occurredAt))}</time><dl class="history-changes">${h.beforeStart ? html`<div><dt>Претходно</dt><dd>${escape(range(h.beforeStart, h.beforeEnd))}<br>${escape(statusLabel(h.beforeStatus))}</dd></div>` : ""}<div><dt>${h.beforeStart ? tr("Потоа") : tr("Закажано")}</dt><dd>${escape(range(h.afterStart, h.afterEnd))}<br>${escape(statusLabel(h.afterStatus))}</dd></div></dl></li>`).join("")}</ol>` : html("<p class=\"muted\">Сè уште нема детално запишани промени за овој термин.</p>")}`;
      $("#refresh-history-detail")?.addEventListener("click", async () => {
        try { await load(false); if ($("#appointment-history") === target && dialog.open) details(id); }
        catch (e) { toast(e.message, true); }
      });
    } catch (e) {
      if ($("#appointment-history") !== target || !dialog.open) return;
      target.innerHTML = html`<p class="inline-error" role="alert">${escape(e.message)}</p><button class="btn secondary small" id="retry-history">Обиди се повторно</button>`;
      $("#retry-history").onclick = () => loadAppointmentHistory(id);
    }
  }
  async function confirmAction(message, label = tr("Потврди")) {
    return new Promise((resolve) => {
      const d = $("#confirm-dialog");
      $("#confirm-message").textContent = message;
      $("#confirm-yes").textContent = label;
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        d.close();
        resolve(v);
      };
      $("#confirm-no").onclick = () => finish(false);
      $("#confirm-yes").onclick = () => finish(true);
      d.oncancel = (e) => {
        e.preventDefault();
        finish(false);
      };
      d.showModal();
    });
  }
  async function changeStatus(id, status, button) {
    const a = state.appointments.find((a) => a.id === id);
    if (
      !(await confirmAction(
        status === "Cancelled"
          ? tr("Дали сакате да го откажете прегледот и да го ослободите терминот?")
          : html`Промени го статусот на овој термин во “${statusLabel(status)}”?`,
        status === "Cancelled" ? tr("Откажи термин") : tr("Ажурирај статус"),
      ))
    )
      return;
    const origin = $("#detail-error");
    button.disabled = true;
    try {
      const saved = await api(`appointments/${id}/status`, { status, version: a.version }); rememberSaved("appointments", saved);
      const refreshed = await refreshAfterSave();
      if (!origin?.isConnected || !dialog.open) return;
      renderPage();
      details(id, true);
      if (refreshed) toast(
        status === "Cancelled"
          ? tr("Прегледот е откажан. Терминот е повторно достапен.")
          : tr("Терминот е ажуриран."),
      );
    } catch (e) {
      if (!origin?.isConnected || !dialog.open) return;
      origin.innerHTML =
        `<div class="inline-error" role="alert">${escape(e.message)}</div>`;
      button.disabled = false;
    }
  }
  async function openBooking(doctorId, date, time, moveId, patientId, serviceId) {
    const a = moveId ? state.appointments.find((a) => a.id === moveId) : null;
    const selected =
      doctorId ||
      a?.doctorId ||
      (isDoctor() ? state.actor.doctorId : doctorFilter) ||
      ownDoctors().find(
        (d) => d.enabled !== false && d.workingPeriods.length && (!isPatient() || !d.staffOnly),
      )?.id ||
      ownDoctors()[0]?.id;
    if (!selected || !doctor(selected)?.enabled) { toast(tr("Изберете активен лекар."), true); return; }
    if (patientBookingBlocked(doctor(selected))) {
      profile(selected);
      $("#dialog-content").insertAdjacentHTML(
        "afterbegin",
        html("<div class=\"inline-note warning\">Закажувањето е преку рецепција. Контактирајте ја рецепцијата за овој преглед. Не е испратена порака.</div>"),
      );
      return;
    }
    booking = {
      doctorId: selected,
      doctorChosen: !!(doctorId || a || isDoctor() || doctorFilter),
      serviceFirst: false,
      serviceId: a?.serviceId || (!moveId && (servicesFor(selected).find(s => s.id === (serviceId || calendarService))?.id || servicesFor(selected)[0]?.id)) || "",
      date: date || (a ? dayOf(a.start) : state.today),
      time: time || "",
      moveId,
      patientId:
        a?.patientId || patientId || (isPatient() ? state.actor.patientId : ""),
      requestId: requestId(),
      version: a?.version,
    };
    bookingForm();
    await loadSlots();
  }
  // Enhance existing selects so booking IDs/change handlers remain authoritative.
  // Typed text is never treated as a doctor, service or patient ID.
  function searchableBookingSelect(select, placeholder) {
    if (!select) return;
    const wrapper = document.createElement("div");
    wrapper.className = "booking-combobox";
    const input = document.createElement("input");
    input.id = select.id + "-input";
    input.type = "text";
    input.placeholder = placeholder;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-haspopup", "listbox");
    input.setAttribute("aria-expanded", "false");
    input.disabled = select.disabled;
    const list = document.createElement("div");
    list.id = select.id + "-list";
    list.className = "booking-combobox-list";
    list.setAttribute("role", "listbox");
    list.hidden = true;
    input.setAttribute("aria-controls", list.id);
    const label = document.querySelector(`label[for="${select.id}"]`);
    if (label) { label.htmlFor = input.id; list.setAttribute("aria-label", label.textContent); }
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "booking-combobox-toggle";
    toggle.tabIndex = -1;
    toggle.disabled = input.disabled;
    toggle.setAttribute("aria-label", tr("Прикажи опции: ") + (label?.textContent || tr("Избор")));
    toggle.setAttribute("aria-controls", list.id);
    toggle.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 9 6 6 6-6"/></svg>';
    const status = document.createElement("span");
    status.className = "visually-hidden";
    status.setAttribute("role", "status");
    select.before(wrapper);
    wrapper.append(input, toggle, list, status);
    select.hidden = true;
    let matches = [], active = -1, searchRequest = 0, searchTimer, remoteMatches = new Set();
    const remotePatients = state.windowed && ["booking-patient","list-patient"].includes(select.id) && !select.disabled;
    const selectedText = () => select.selectedOptions[0]?.textContent || "";
    const normalize = text => text.normalize("NFKC").toLocaleLowerCase("mk-MK").trim();
    function sync() {
      input.value = select.value ? selectedText() : "";
      if (!select.value) input.placeholder = select.disabled ? selectedText() || placeholder : placeholder;
      input.setCustomValidity("");
      delete input.dataset.selectionPending;
    }
    function close() {
      searchRequest++;clearTimeout(searchTimer);
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }
    function highlight(index) {
      active = index;
      [...list.children].forEach((element, i) => element.classList.toggle("highlighted", i === active));
      const option = list.children[active];
      if (option && matches.length) {
        input.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView?.({ block: "nearest" });
      } else input.removeAttribute("aria-activedescendant");
    }
    function render(query = "", loaded = false) {
      if (input.disabled) return;
      if (remotePatients && !loaded) {
        const request=++searchRequest;clearTimeout(searchTimer);matches=[];active=-1;
        list.replaceChildren();list.hidden=false;input.setAttribute("aria-expanded","true");
        list.setAttribute("aria-busy","true");
        searchTimer=setTimeout(async()=>{
          try {
            const scopedDoctor=select.id==="list-patient" && isDoctor() ? state.actor.doctorId : "";
            const result=await api("workspace/patients?take=30&search="+encodeURIComponent(query)+"&doctorId="+encodeURIComponent(scopedDoctor));
            if(request!==searchRequest || !input.isConnected)return;
            state.patients=mergeRecords(state.patients,result.items);
            remoteMatches=new Set(result.items.map(p=>p.id));
            const value=select.value,old=select.selectedOptions[0]?.cloneNode(true),empty=select.options[0]?.cloneNode(true);
            select.replaceChildren();if(empty?.value==="")select.append(empty);
            for(const p of result.items)select.add(new Option([p.name,patientCode(p)].join(" · "),p.id));
            if(value && ![...select.options].some(o=>o.value===value) && old)select.append(old);
            select.value=value;render(query,true);
          } catch(error) {
            if(request!==searchRequest || !input.isConnected)return;
            const note=document.createElement("div");note.className="booking-combobox-empty";note.textContent=error.message;
            list.replaceChildren(note);status.textContent=error.message;
          } finally { if(request===searchRequest)list.removeAttribute("aria-busy"); }
        },120);
        return;
      }
      matches = [...select.options].filter(option => !option.disabled && (remotePatients && loaded ? remoteMatches.has(option.value) || !query && !option.value : normalize(option.textContent).includes(normalize(query))));
      list.replaceChildren();
      matches.forEach((option, index) => {
        const item = document.createElement("div");
        item.id = select.id + "-option-" + index;
        item.className = "booking-combobox-option";
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(option.value === select.value));
        item.textContent = option.textContent;
        item.addEventListener("click", () => choose(index));
        list.append(item);
      });
      if (!matches.length) {
        const empty = document.createElement("div");
        empty.className = "booking-combobox-empty";
        empty.textContent = tr("Нема резултати. Обидете се со друго име.");
        list.append(empty);
      }
      // Overlay the form so closing a search cannot move the button being clicked.
      // Flip upward when the field is near the bottom of the scrollable dialog.
      const bounds = input.getBoundingClientRect();
      const modal = dialog.open && dialog.contains(input) ? dialog.getBoundingClientRect() : {top:0,bottom:innerHeight};
      const viewportBottom = window.visualViewport ? window.visualViewport.offsetTop + window.visualViewport.height : innerHeight;
      const below = Math.min(viewportBottom, modal.bottom) - bounds.bottom - 12;
      const above = bounds.top - Math.max(0, modal.top) - 12;
      const upwards = below < 160 && above > below;
      list.classList.toggle("opens-up", upwards);
      list.style.maxHeight = Math.max(90, Math.min(220, upwards ? above : below)) + "px";
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      status.textContent = matches.length ? html`${matches.length} опции` : tr("Нема резултати.");
      highlight(matches.length ? Math.max(0, matches.findIndex(option => option.value === select.value)) : -1);
    }
    function choose(index) {
      const option = matches[index];
      if (!option || input.disabled) return;
      const changed = select.value !== option.value;
      select.value = option.value;
      sync(); close();
      if (changed || (["booking-doctor", "booking-service"].includes(select.id) && !booking?.doctorChosen)) select.dispatchEvent(new Event("change", { bubbles: true }));
      // Doctor/service changes rebuild the dialog. Restore focus without reopening.
      const current = document.getElementById(input.id);
      if (current && current !== input) {
        current.dataset.quietFocus = "true";
        current.focus({ preventScroll: true });
        delete current.dataset.quietFocus;
      }
    }
    input.addEventListener("focus", () => {
      if (!input.dataset.quietFocus) { input.select(); render(); }
    });
    input.addEventListener("click", () => { if (list.hidden) render(input.dataset.selectionPending === "true" ? input.value : ""); });
    input.addEventListener("input", () => {
      // The shared validation translator clears custom validity on input events.
      // Track pending choices separately so only actual options can be submitted.
      input.dataset.selectionPending = String(input.value !== (select.value ? selectedText() : ""));
      input.setCustomValidity(input.dataset.selectionPending === "true" ? tr("Изберете опција од листата пред да продолжите.") : "");
      render(input.value);
    });
    input.addEventListener("keydown", event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (list.hidden) render(input.dataset.selectionPending === "true" ? input.value : "");
        else if (matches.length) highlight((active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
      } else if ((event.key === "Home" || event.key === "End") && !list.hidden) {
        event.preventDefault(); highlight(event.key === "Home" ? 0 : matches.length - 1);
      } else if (event.key === "Enter" && !list.hidden) {
        event.preventDefault(); choose(active);
      } else if (event.key === "Escape" && (!list.hidden || input.dataset.selectionPending === "true")) {
        event.preventDefault(); event.stopPropagation(); sync(); close();
      } else if (event.key === "Tab") close();
    });
    list.addEventListener("mousedown", event => event.preventDefault());
    toggle.addEventListener("mousedown", event => event.preventDefault());
    toggle.addEventListener("click", () => {
      const opening = list.hidden;
      input.focus();
      if (opening) render(); else close();
    });
    wrapper.addEventListener("focusout", () => {
      queueMicrotask(() => { if (!wrapper.contains(document.activeElement)) close(); });
    });
    select.addEventListener("change", sync);
    sync();
  }

  function bookingForm() {
    const b = booking,
      d = doctor(b.doctorId);
    const offeredServices = !b.doctorChosen || b.serviceFirst ? state.services.filter(s => s.enabled && ownDoctors().some(x => x.enabled !== false && !patientBookingBlocked(x) && servicesFor(x.id).some(v => v.id === s.id))) : servicesFor(d.id);
    openDialog(
      b.moveId ? tr("Презакажи термин") : isPatient() ? tr("Одвојте време за вашето здравје") : tr("Нов термин"),
      html`<div class="steps"><span class="step active">01 · Лекар и термин</span><span class="step">02 · Проверка</span><span class="step">03 · Закажано</span></div><div class="field"><label for="booking-doctor">Лекар</label><select id="booking-doctor" ${b.moveId || isDoctor() ? "disabled" : ""}>${ownDoctors().filter(x => (x.enabled !== false || x.id === b.doctorId) && (!patientBookingBlocked(x) || x.id === b.doctorId) && (!b.serviceFirst || !b.serviceId || servicesFor(x.id).some(s => s.id === b.serviceId))).map(x => `<option value="${x.id}" ${x.id === b.doctorId ? "selected" : ""}>${escape(x.name)}</option>`).join("")}</select></div>${b.moveId ? html`<div class="inline-note">Услуга: ${escape(state.appointments.find(a => a.id === b.moveId)?.serviceName || tr("Без заведена услуга"))}</div>` : html`<div class="field"><label for="booking-service">Услуга / преглед</label><select id="booking-service" ${offeredServices.length ? "" : "disabled"}>${offeredServices.length && !b.serviceId ? html("<option value=\"\" disabled selected>Изберете услуга</option>") : ""}${offeredServices.length ? offeredServices.map(x => html`<option value="${x.id}" ${x.id === b.serviceId ? "selected" : ""}>${escape(x.name)} · ${x.durationMinutes} мин.</option>`).join("") : html("<option value=\"\">Нема заведена достапна услуга</option>")}</select></div>`}${d.requiresConfirmation && !b.agreedTime ? html`<div class="inline-note warning">${d.staffOnly ? tr("Преку рецепција") : d.requiresConfirmation ? tr("Онлајн, со потврда од персоналот") : tr("Онлајн закажување")} · Потребна е потврда од персоналот.</div>` : ""}<div class="form-row" style="margin-top:17px"><div class="field"><label for="booking-date">Изберете датум</label><input type="date" id="booking-date" value="${b.date}" min="${state.today}" max="${addDays(state.today, 180)}" required></div><div class="field"><label>Времетраење на прегледот</label><div class="inline-note">${bookingDuration(b)} минути</div></div></div>${!isPatient() ? html`<div class="field"><label for="booking-patient">Пациент</label><select id="booking-patient" ${b.moveId ? "disabled" : ""}><option value="">Изберете пациент</option>${state.patients.map((p) => `<option value="${p.id}" ${p.id === b.patientId ? "selected" : ""}>${escape([p.name, patientCode(p)].filter(Boolean).join(" · "))}</option>`).join("")}</select>${b.moveId ? "" : html("<button class=\"link-button\" style=\"font-size:0.875rem;margin-top:8px\" id=\"new-patient-from-booking\"><svg class=\"ui-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><use href=\"/icons/interface.svg#plus\"></use></svg> Додај пациент</button>")}</div>` : ""}${isAdmin() && !b.moveId ? html`<section class="agreed-booking"><label class="catalogue-toggle"><input id="booking-agreed" type="checkbox" ${b.agreedTime ? "checked" : ""}> Термин договорен со лекар</label><div id="agreed-time-field" ${b.agreedTime ? "" : "hidden"}><label for="booking-agreed-time">Договорено време</label><input id="booking-agreed-time" type="time" step="60" value="${b.agreedTime ? b.time || "" : ""}"><p>Изберете време што лекарот го одобрил. Преклопувања и отсуства не се дозволени.</p></div></section>` : ""}<div class="slots-label"><strong>Слободни термини</strong><span id="slot-count"></span></div><div id="booking-slots" aria-live="polite"></div><div id="booking-error"></div><div class="dialog-actions"><button class="btn secondary" data-action="close">Назад</button><button class="btn primary" id="review-booking">Провери го терминот ${icon("arrow-up-right")}</button></div>`,
      isPatient() ? tr("ЗАКАЖЕТЕ ТЕРМИН") : "",
    );
    $("#booking-doctor").addEventListener("change", async (e) => {
      b.doctorId = e.target.value;
      b.doctorChosen = true;
      b.serviceId = b.serviceFirst && servicesFor(b.doctorId).some(s => s.id === b.serviceId) ? b.serviceId : servicesFor(b.doctorId)[0]?.id || "";
      b.time = ""; b.agreedTime = false;
      bookingForm();
      await loadSlots();
    });
    $("#booking-service")?.addEventListener("change", async e => {
      b.serviceId = e.target.value;
      if (!b.doctorChosen || b.serviceFirst) {
        b.serviceFirst = true;
        if (!servicesFor(b.doctorId).some(s => s.id === b.serviceId)) b.doctorId = ownDoctors().find(x => x.enabled !== false && servicesFor(x.id).some(s => s.id === b.serviceId))?.id;
      }
      b.time = ""; b.agreedTime = false; bookingForm(); await loadSlots();
    });
    $("#booking-date").addEventListener("change", async (e) => {
      b.date = e.target.value;
      b.time = "";
      if ($("#booking-agreed-time")) $("#booking-agreed-time").value = "";
      await loadSlots();
    });
    $("#booking-patient")?.addEventListener(
      "change",
      (e) => { b.patientId = e.target.value; loadSlots(); },
    );
    $("#new-patient-from-booking")?.addEventListener("click", () =>
      addPatientForm({ ...b }),
    );
    window.MedTerminDates?.availability($("#booking-date"), (from, to) => api(`availability/days?doctorId=${encodeURIComponent(b.doctorId)}&from=${from}&to=${to}&serviceId=${encodeURIComponent(b.serviceId || "")}&patientId=${encodeURIComponent(b.patientId || "")}&excludeId=${encodeURIComponent(b.moveId || "")}`));
    searchableBookingSelect($("#booking-doctor"), tr("Пребарајте лекар…"));
    searchableBookingSelect($("#booking-service"), tr("Пребарајте услуга…"));
    searchableBookingSelect($("#booking-patient"), tr("Пребарајте пациент…"));
    $("#booking-agreed")?.addEventListener("change", e => {
      b.agreedTime = e.target.checked; b.time = ""; bookingForm(); loadSlots();
    });
    $("#booking-agreed-time")?.addEventListener("input", e => {
      b.time = e.target.value; $("#booking-error").innerHTML = "";
    });
    $("#review-booking").addEventListener("click", reviewBooking);
  }
  async function loadSlots() {
    const request = ++slotRequest,
      b = booking;
    const container = $("#booking-slots");
    if (!container || !b) return;
    if (b.agreedTime && isAdmin() && !b.moveId) {
      slotRequest++; b.slots = []; $("#slot-count").textContent = tr("Договорен термин");
      container.innerHTML = html("<p class=\"inline-note\">Терминот ќе биде потврден. Достапноста повторно се проверува при зачувување.</p>");
      $("#review-booking").disabled = false; return;
    }
    container.innerHTML =
      html("<div class=\"loading-state\" style=\"padding:25px\"><span class=\"spinner\"></span> Се проверуваат слободните термини…</div>");
    $("#review-booking").disabled = true;
    try {
      if (!b.date) throw new Error(tr("Изберете датум за приказ на слободните термини."));
      const slots = await api(
        `slots?doctorId=${encodeURIComponent(b.doctorId)}&serviceId=${encodeURIComponent(b.serviceId || "")}&date=${b.date}&patientId=${encodeURIComponent(b.patientId || "")}${b.moveId ? "&excludeId=" + b.moveId : ""}`,
      );
      if (request !== slotRequest || booking !== b) return;
      b.slots = slots;
      $("#slot-count").textContent = html`${slots.length} слободни`;
      if (!slots.some((s) => s.time.slice(0, 5) === b.time)) b.time = "";
      container.innerHTML = slots.length
        ? `<div class="slots">${slots.map((s) => `<button class="slot ${s.time.slice(0, 5) === b.time ? "selected" : ""}" aria-pressed="${s.time.slice(0, 5) === b.time}" data-time="${s.time.slice(0, 5)}">${s.time.slice(0, 5)}</button>`).join("")}</div>`
        : empty(
            tr("Нема слободни термини на овој датум"),
            isAdmin() && !b.moveId ? tr("Изберете друг ден или вклучете „Термин договорен со лекар“ ако лекарот веќе одобрил конкретно време.") : tr("Изберете друг ден. Достапноста ги зема предвид работното време, закажаните прегледи и отсуствата."),
          );
      $$("[data-time]", container).forEach((btn) =>
        btn.addEventListener("click", () => {
          b.time = btn.dataset.time;
          $$("[data-time]", container).forEach((x) => {
            x.classList.toggle("selected", x === btn);
            x.setAttribute("aria-pressed", String(x === btn));
          });
          $("#booking-error").innerHTML = "";
        }),
      );
      $("#review-booking").disabled = !slots.length;
    } catch (e) {
      if (request !== slotRequest || booking !== b || !container.isConnected || !dialog.open) return;
      container.innerHTML = html`<div class="inline-error" role="alert">${escape(e.message)}</div><button class="btn secondary small" id="retry-slots">Обиди се повторно</button>`;
      $("#retry-slots", container)?.addEventListener("click", loadSlots);
    }
  }
  function reviewBooking() {
    if (window.MedTerminDates && !window.MedTerminDates.validate(dialog)) return;
    const invalid = $$(".booking-combobox input").find(input => !input.disabled && input.dataset.selectionPending === "true");
    if (invalid) {
      $("#booking-error").innerHTML = html("<div class=\"inline-error\" role=\"alert\">Изберете лекар, услуга или пациент од соодветната листа пред да продолжите.</div>");
      invalid.setCustomValidity(tr("Изберете опција од листата пред да продолжите."));
      invalid.focus(); invalid.reportValidity(); return;
    }
    const b = booking,
      d = doctor(b.doctorId);
    if (b.agreedTime && (!$("#booking-date").checkValidity() || !$("#booking-agreed-time").value || !$("#booking-agreed-time").checkValidity())) {
      $("#booking-error").innerHTML = html("<div class=\"inline-error\" role=\"alert\">Изберете важечки датум и договорено време.</div>"); return;
    }
    if (!b.time || !b.patientId) {
      $("#booking-error").innerHTML =
        html("<div class=\"inline-error\" role=\"alert\">Изберете слободен термин и пациент пред да продолжите.</div>");
      return;
    }
    openDialog(
      tr("Последна проверка."),
      html`<div class="steps"><span class="step">01 · Лекар и термин</span><span class="step active">02 · Проверка</span><span class="step">03 · Закажано</span></div><div class="booking-context">${avatar(d.name)}<div><strong>${escape(d.name)}</strong><small>${escape(d.specialty)}</small></div></div><dl class="detail-list"><div><dt>Пациент</dt><dd>${escape(patient(b.patientId)?.name)}${patientNumber(patient(b.patientId))}</dd></div><div><dt>Датум</dt><dd>${formatDate(b.date, { weekday: "short", day: "numeric", month: "long" })}</dd></div><div><dt>Услуга</dt><dd>${escape(b.moveId ? state.appointments.find(a => a.id === b.moveId)?.serviceName || tr("Без заведена услуга") : state.services.find(x => x.id === b.serviceId)?.name || tr("Без заведена услуга"))}</dd></div><div><dt>Време</dt><dd>${b.time} · ${bookingDuration(b)} минути</dd></div></dl><div class="inline-note ${d.requiresConfirmation && !b.agreedTime ? "warning" : ""}">${b.agreedTime ? tr("Терминот е договорен со лекар и ќе биде веднаш потврден.") : d.requiresConfirmation ? tr("Избраниот термин ќе биде резервиран до потврда од персоналот.") : tr("Вашиот термин ќе биде веднаш потврден.")} Не се испраќа е-пошта или SMS.</div><div id="booking-error"></div><div class="dialog-actions"><button class="btn secondary" id="booking-back">Назад</button><button class="btn primary" id="submit-booking">${b.moveId ? tr("Потврди нов термин") : tr("Потврди термин")} ${icon("check")}</button></div>`,
      tr("ПРОВЕРЕТЕ ГО ВАШИОТ ПРЕГЛЕД"),
    );
    $("#booking-back").addEventListener("click", async () => {
      bookingForm();
      await loadSlots();
    });
    $("#submit-booking").addEventListener("click", submitBooking);
  }
  async function submitBooking() {
    const b = booking,
      button = $("#submit-booking");
    const active = () => booking === b && dialog.open && button.isConnected;
    button.disabled = true;
    $("#booking-back").disabled = true;
    try {
      const a = await api(
        b.moveId ? `appointments/${b.moveId}/move` : "appointments",
        b.moveId
          ? { date: b.date, time: b.time, version: b.version }
          : {
              doctorId: b.doctorId,
              patientId: b.patientId,
              date: b.date,
              time: b.time,
              durationMinutes: bookingDuration(b),
              serviceId: b.serviceId || null,
              requestId: b.requestId,
              agreedTime: b.agreedTime === true,
            },
      );
      // A successful mutation is committed even when a later read is unavailable.
      rememberSaved("appointments", a);
      let refreshError = "";
      try { await load(false); } catch (error) { refreshError = error.message; }
      if (!active()) { refreshFirstSlots(); toast(tr("Терминот е зачуван. Освежете за најновите податоци.")); return; }
      renderPage();
      booking = null;
      openDialog(
        a.status === "Scheduled" ? tr("Вашиот термин е резервиран.") : tr("Сè е подготвено."),
        html`${refreshError ? `<p class="inline-note warning" role="status">${escape(tr("Терминот е зачуван, но освежувањето не успеа. Обидете се повторно подоцна."))}</p>` : ""}<div class="success-view"><div class="success-mark">${icon("check")}</div><h3>${a.status === "Scheduled" ? tr("Чека потврда") : tr("Терминот е потврден")}</h3><p>${escape(doctor(a.doctorId).name)}<br>${formatDate(dayOf(a.start), { weekday: "long", day: "numeric", month: "long" })} во <strong>${timeOf(a.start)}</strong></p>${badge(a.status)}<p style="margin-top:18px">Број на резервација <strong>CL-${a.id.slice(0, 8).toUpperCase()}</strong><br>Не е испратена е-пошта или SMS.</p></div><div class="dialog-actions"><button class="btn secondary" data-action="close">Готово</button><button class="btn primary" data-detail="${a.id}">Види термин ${icon("arrow-up-right")}</button></div>`,
        tr("ПОВЕЌЕ СПОКОЈ ВО СЕКОЈДНЕВИЕТО"),
      );
      toast(
        b.moveId
          ? tr("Терминот е презакажан.")
          : tr("Терминот е зачуван и видлив во сите соодветни работни простори."),
      );
    } catch (e) {
      if (!active()) return;
      $("#booking-error").innerHTML =
        `<div class="inline-error" role="alert">${escape(e.message)}</div>${b.moveId && e.status === 409 ? `<button type="button" class="btn secondary small" id="reload-booking">${escape(tr("Вчитај ја тековната состојба"))}</button>` : ""}`;
      button.disabled = false;
      $("#booking-back").disabled = false;
      $("#reload-booking")?.addEventListener("click", async event => {
        const reload = event.currentTarget; reload.disabled = true;
        try {
          await load(false);
          if (!active()) return;
          const current = state.appointments.find(visit => visit.id === b.moveId);
          if (!current) { closeDialog(); toast(tr("Терминот не е пронајден или немате пристап до него."), true); return; }
          const currentDoctor = doctor(current.doctorId);
          const editable = currentDoctor?.enabled !== false && (!isPatient() || !currentDoctor?.staffOnly)
            && ["Scheduled", "Confirmed"].includes(current.status) && new Date(current.start) > new Date(state.utcNow);
          if (!editable) { closeDialog(); renderPage(); details(current.id); return; }
          await openBooking(current.doctorId, dayOf(current.start), timeOf(current.start), current.id);
        } catch (error) { if (active()) { toast(error.message, true); reload.disabled = false; } }
      });
    }
  }
  function renderCalendar() {
    if (isDoctor()) { calendarSpecialty = ""; calendarService = ""; doctorFilter = state.actor.doctorId; }
    const matchingDoctors = calendarDoctors();
    if (doctorFilter && !matchingDoctors.some(d => d.id === doctorFilter)) doctorFilter = "";
    calendarRange ||= { from: state.today, to: addDays(state.today, 6) };
    const calendarDoctorOptions = html`<option value="">Сите соодветни лекари / услуги</option>${matchingDoctors.map(d => `<option value="${d.id}" ${d.id === doctorFilter ? "selected" : ""}>${escape(d.name)}</option>`).join("")}`;
    // Replacing the selected provider also replaces the calendar's listeners.
    if (calendar) {
      calendar.destroy();
      calendar = null;
    }
    app.innerHTML =
      heading(
        tr("Календар"),
        tr("Кликнете на слободно време за закажување. Отворете преглед за да ги видите деталите."),
        bookButton(),
        "",
      ) +
      html`<section class="card workspace-filters"><div class="card-head"><div><h3>Филтри на календарот</h3><p class="filter-description">Изберете лекар и прегледајте ги термините што ви се потребни.</p></div><button class="btn secondary small" id="refresh-calendar">${icon("refresh-cw")} Освежи</button></div><div class="card-body"><div class="calendar-filter-grid">${isAdmin() ? html`<label>Лекар<select id="calendar-doctor">${calendarDoctorOptions}</select></label><label>Специјалност<select id="calendar-specialty">${specialtyOptions(calendarSpecialty)}</select></label><label>Услуга<select id="calendar-service">${serviceOptions(calendarService)}</select></label>` : html`<div class="filter-provider"><span>Вашиот календар</span><strong>${escape(doctor(doctorFilter).name)}</strong></div>`}<label>Статус<select id="calendar-status"><option value="">Сите статуси</option>${statuses.map((s) => `<option value="${s}" ${s === statusFilter ? "selected" : ""}>${statusLabel(s)}</option>`).join("")}</select></label></div><form id="calendar-range-form" class="calendar-range"><label>Од<input type="date" id="calendar-from" value="${calendarRange.from}" required></label><label>До<input type="date" id="calendar-to" value="${calendarRange.to}" required></label><button class="btn secondary small" type="submit">Прикажи период</button><span class="filter-hint">До 31 ден · ${matchingDoctors.length} профили</span><span id="calendar-range-error" role="alert"></span></form></div></section><div class="calendar-layout"><section class="card calendar-panel ${calendarView === "timeGridRange" ? "custom-range" : ""}" style="--range-width:${Math.max(1, (new Date(calendarRange.to) - new Date(calendarRange.from)) / 86400000 + 1) * 110}px"><div class="calendar-top"><div class="calendar-nav"><button class="icon-button" id="calendar-prev" aria-label="Претходен период">${icon("chevron-left")}</button><button class="icon-button" id="calendar-next" aria-label="Следен период">${icon("chevron-right")}</button><h2 id="calendar-title"></h2><button class="btn secondary small" id="calendar-today">Денес</button></div><div class="calendar-views" role="group" aria-label="Приказ на календарот">${[
        ["timeGridDay", tr("Ден")],
        ["timeGridWeek", tr("Недела")],
        ["dayGridMonth", tr("Месец")],
        ["timeGridRange", tr("Период")],
      ]
        .map(
          ([v, l]) =>
            `<button data-calendar-view="${v}" class="${calendarView === v ? "active" : ""}">${l}</button>`,
        )
        .join(
          "",
        )}</div></div><div id="calendar-loading" class="calendar-load" aria-live="polite"></div><div class="calendar-scroll" tabindex="0" role="region" aria-label="Термини и достапност по датуми."><div id="calendar"></div></div><div class="calendar-legend"><span><i class="legend-available"></i>Достапно</span><span><i class="legend-confirmed"></i>Потврден</span><span><i class="legend-pending"></i>Чека потврда</span><span><i class="legend-unavailable"></i>Недостапно</span><span><i class="legend-completed"></i>Завршен</span><span><i class="legend-cancelled"></i>Откажан</span><span><i class="legend-noshow"></i>Не се појави</span><span><i class="legend-off-hours"></i>Неработно време</span></div><p class="mobile-calendar-note">Користете дневен приказ за повеќе простор. Секој термин е достапен и преку тастатура во списокот со термини.</p></section><details class="card calendar-context"><summary><span class="schedule-icon" aria-hidden="true">${icon("clock")}</span><span><strong>Работно време и информации за избраниот лекар</strong><small>Неделен распоред и управување со достапноста</small></span><span class="disclosure-chevron" aria-hidden="true">${icon("chevron-down")}</span></summary><aside class="calendar-aside" id="calendar-aside"></aside></details></div>`;
    $("#calendar-doctor")?.addEventListener("change", (e) => {
      doctorFilter = e.target.value;
      calendarDate = calendar.getDate().toISOString().slice(0, 10);
      renderCalendar();
    });
    for (const id of ["calendar-specialty", "calendar-service"]) {
      $("#" + id)?.addEventListener("change", e => {
        if (id === "calendar-specialty") calendarSpecialty = e.target.value;
        else calendarService = e.target.value;
        doctorFilter = "";
        calendarDate = calendar.getDate().toISOString().slice(0, 10);
        renderCalendar();
      });
    }
    $("#calendar-range-form").onsubmit = e => {
      e.preventDefault();
      const from = $("#calendar-from").value, to = $("#calendar-to").value;
      const length = (new Date(to) - new Date(from)) / 86400000;
      if (!from || !to || !Number.isFinite(length) || length < 0 || length > 30) {
        $("#calendar-range-error").textContent = tr("Изберете период од 1 до 31 ден."); return;
      }
      calendarRange = { from, to }; calendarView = "timeGridRange"; calendarDate = from; renderCalendar();
    };
    $("#calendar-status").addEventListener("change", (e) => {
      statusFilter = e.target.value;
      calendar.refetchEvents();
    });
    const selected = doctor(doctorFilter);
    $("#calendar-aside").innerHTML = selected
      ? html`<section class="card"><div class="card-head"><h3>Избраниот лекар</h3></div><div class="card-body">${avatar(selected.name, Number(selected.id.slice(1)))}<h4>${escape(selected.name)}</h4><p>${escape(selected.specialty)}</p><div class="divider"></div><label>Неделно работно време</label><div id="calendar-work-hours">${scheduleList(selected, calendarDate || state.today)}</div><button class="btn secondary small wide" data-nav="availability">Управувај со достапноста ${icon("arrow-up-right")}</button></div></section>`
      : html`<section class="card"><div class="card-head"><h3>Заеднички календар</h3></div><div class="card-body"><p>Прегледајте ги термините на сите лекари или изберете еден лекар за неговите слободни термини и работен распоред.</p><button class="btn primary small wide" data-action="book">${icon("plus")} Нов термин</button></div></section>`;
    if (!window.FullCalendar) {
      $("#calendar").innerHTML = empty(
        tr("Календарот не можеше да се вчита"),
        tr("Освежете ја страницата. Може да закажувате и да управувате со прегледите во делот Термини."),
      );
      return;
    }
    calendar = new FullCalendar.Calendar($("#calendar"), {
      locale: {
        code: locale,
        week: { dow: 1, doy: 7 },
        buttonText: { prev: tr("Претходно"), next: tr("Следно"), today: tr("Денес"), year: tr("Година"), month: tr("Месец"), week: tr("Недела"), day: tr("Ден"), list: tr("Список") },
        buttonHints: { prev: tr("Претходен период"), next: tr("Следен период"), today: tr("Тековен период") },
        weekText: tr("Сед."),
        weekTextLong: tr("Недела"),
        allDayText: tr("Цел ден"),
        moreLinkText: n => html`уште ${n}`,
        moreLinkHint: n => html`Прикажи уште ${n} термини`,
        noEventsText: tr("Нема термини за прикажување"),
        closeHint: tr("Затвори"),
        timeHint: tr("Време"),
        eventHint: tr("Термин"),
        navLinkHint: tr("Отвори го датумот"),
        viewHint: tr("Приказ на календарот")
      },
      titleFormat: info => {
        const start = info.start.marker.toISOString();
        const end = info.end?.marker.toISOString();
        return end && end.slice(0, 10) !== start.slice(0, 10)
          ? `${formatDate(start, { day: "numeric", month: "short", year: start.slice(0, 4) !== end.slice(0, 4) ? "numeric" : undefined })} – ${formatDate(end)}`
          : formatDate(start, { day: "numeric", month: "long", year: "numeric" });
      },
      views: {
        timeGridRange: { type: "timeGrid", duration: { days: 7 } },
        dayGridMonth: { titleFormat: info => formatDate(info.date.marker.toISOString(), { month: "long", year: "numeric" }) }
      },
      dayHeaderContent: info => formatDate(info.date.toISOString(), info.view.type === "dayGridMonth"
        ? { weekday: "short" } : { weekday: "short", day: "numeric", month: "2-digit" }),
      dayPopoverFormat: info => formatDate(info.date.marker.toISOString(), { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
      initialView: calendarView === "timeGridRange" ? "timeGridWeek" : calendarView,
      initialDate: calendarDate || state.today,
      headerToolbar: false,
      firstDay: 1,
      timeZone: "UTC",
      allDaySlot: false,
      height: Math.max(innerWidth < 650 ? 540 : 660, Math.min(900, innerHeight - 220)),
      slotMinTime: "00:00:00",
      slotMaxTime: "24:00:00",
      scrollTime: "08:00:00",
      slotDuration: "00:30:00",
      snapDuration: "00:05:00",
      dayMaxEvents: 3,
      weekends: true,
      nowIndicator: true,
      now: () => wall(new Date()),
      eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
      slotLabelFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
      businessHours: false,
      editable: true,
      eventDurationEditable: false,
      eventStartEditable: true,
      eventResizableFromStart: false,
      datesSet(info) {
        requestAnimationFrame(() => {
          $$("#calendar .fc-timegrid-col[role=gridcell]").forEach(el=>{
            el.tabIndex=0;
          });
        });
        $("#calendar-title").textContent = info.view.title;
        calendarDate = info.view.currentStart.toISOString().slice(0, 10);
        const hours = $("#calendar-work-hours"); if (hours && doctorFilter) hours.innerHTML = scheduleList(doctor(doctorFilter), calendarDate);
      },
      dateClick(info) {
        if (!matchingDoctors.length) { toast(tr("Нема профили за избраните филтри."), true); return; }
        const date = info.dateStr.slice(0, 10);
        openBooking(
          doctorFilter || matchingDoctors[0]?.id,
          date,
          info.allDay ? "" : info.dateStr.slice(11, 16),
        );
      },
      eventClick(info) {
        if (info.event.extendedProps.appointmentId)
          details(info.event.extendedProps.appointmentId);
      },
      eventDrop: async (info) => {
        const a = state.appointments.find((a) => a.id === info.event.id) || {id:info.event.id,version:info.event.extendedProps.version};
        const moved = info.event.start.toISOString();
        if (
          !(await confirmAction(
            html`Презакажи го овој термин за ${formatDate(moved.slice(0, 10))} во ${moved.slice(11, 16)}?`,
            tr("Презакажи термин"),
          ))
        ) {
          info.revert();
          return;
        }
        try {
          await api(`appointments/${a.id}/move`, {
            date: moved.slice(0, 10),
            time: moved.slice(11, 16),
            version: a.version,
          });
          await load(false);
          calendar?.refetchEvents();
          toast(tr("Терминот е презакажан."));
        } catch (e) {
          info.revert();
          toast(e.message, true);
        }
      },
      events: async (info, success, failure) => {
        if (page !== "calendar") { success([]); return; }
        $("#calendar-loading").textContent =
          tr("Се освежуваат закажаните и слободните термини…");
        try {
          const request=++calendarRequest;
          let visits=state.appointments;
          const calendarPatients=new Map(state.patients.map(p=>[p.id,p]));
          if(state.windowed) {
            visits=[];
            const query=new URLSearchParams({from:info.startStr.slice(0,10),to:addDays(info.endStr.slice(0,10),-1),take:"500",overlap:"true"});
            if(doctorFilter)query.set("doctorId",doctorFilter);if(calendarService)query.set("serviceId",calendarService);if(statusFilter)query.set("status",statusFilter);
            for(let skip=0;;skip+=500) {
              query.set("skip",String(skip));const result=await api("workspace/appointments?"+query);
              if(request!==calendarRequest || page!=="calendar") { success([]);return; }
              rememberPage(result);visits.push(...result.items);
              for(const p of result.patients)calendarPatients.set(p.id,p);
              if(visits.length>=result.total || !result.items.length)break;
              // Ask the user to narrow exceptionally large calendar views instead of hanging the browser.
              if(visits.length>=5000)throw new Error(tr("Изберете лекар и прегледајте ги термините што ви се потребни."));
            }
          }
          let events = visits
            .filter(
              (a) =>
                matchingDoctors.some(d => d.id === a.doctorId) &&
                (!calendarService || serviceKey(a) === calendarService) &&
                (!doctorFilter || a.doctorId === doctorFilter) &&
                (!statusFilter || a.status === statusFilter),
            )
            .map((a) => ({
              id: a.id,
              title: `${calendarPatients.get(a.patientId)?.name || tr("Пациент")}${!doctorFilter ? " · " + doctor(a.doctorId).name : ""}`,
              start: wall(a.start),
              end: wall(a.end),
              classNames: [a.status],
              editable: upcoming(a),
              extendedProps: { appointmentId: a.id, version:a.version },
            }));
          if (doctorFilter) {
            const exceptions = await api("exceptions?doctorId=" + doctorFilter);
            const start = info.startStr.slice(0, 10),
              end = info.endStr.slice(0, 10);
            const dates = [];
            const minute = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
            const stamp = (date, value) => value === 1440 ? addDays(date, 1) + "T00:00:00" : date + "T" + String(Math.floor(value / 60)).padStart(2,"0") + ":" + String(value % 60).padStart(2,"0") + ":00";
            for (let date = start; date < end; date = addDays(date, 1)) {
              const hours = [...periodsOn(doctor(doctorFilter), date), ...exceptions.filter(e => e.date === date && e.isAvailable)]
                .map(p => [minute(p.start),minute(p.end)]).sort((a,b)=>a[0]-b[0]);
              let cursor = 0;
              for (const [from,to] of [...hours, [1440,1440]]) {
                if (from > cursor) events.push({start:stamp(date,cursor),end:stamp(date,from),display:"background",classNames:["calendar-off-hours"],editable:false});
                cursor = Math.max(cursor,to);
              }
              if (date >= state.today && date <= addDays(state.today, 180))
                dates.push(date);
            }
            const selectedService = state.services.find(s => s.id === calendarService);
            const availableServices = servicesFor(doctorFilter).filter(s => !selectedService || s.id === selectedService.id);
            const hasAssignments = state.doctorServices.some(x => x.doctorId === doctorFilter);
            const lists = await Promise.all(dates.map(async date => {
              if (doctor(doctorFilter).enabled === false) return [];
              if (availableServices.length) return (await Promise.all(availableServices.map(s =>
                api(`slots?doctorId=${doctorFilter}&date=${date}&serviceId=${s.id}`)))).flat();
              // Retired/unassigned services still show their saved appointments, but no new slots.
              if (selectedService || hasAssignments) return [];
              return api(`slots?doctorId=${doctorFilter}&date=${date}`);
            }));
            events.push(
              ...lists.flat().map((s) => ({
                start: `${s.date}T${s.time}`,
                end: wall(s.end),
                display: "background",
                classNames: ["calendar-available"],
                editable: false,
              })),
            );
            events.push(
              ...exceptions
                .filter((e) => !e.isAvailable)
                .map((e) => ({
                  start: `${e.date}T${e.start}`,
                  end: `${e.date}T${e.end}`,
                  display: "background",
                  classNames: ["calendar-unavailable"],
                  title: tr("Недостапно"),
                  editable: false,
                })),
            );
          }
          if(request!==calendarRequest || page!=="calendar") { success([]);return; }
          success(events);
          if ($("#calendar-loading"))
            $("#calendar-loading").textContent = doctorFilter
              ? html`Ажурирана достапност · Изберете време означено како достапно или кликнете Нов термин.`
              : html`Изберете лекар за приказ на слободните термини.`;
        } catch (e) {
          failure(e);
          if ($("#calendar-loading"))
            $("#calendar-loading").textContent =
              tr("Освежувањето не успеа. Кликнете Освежи за повторен обид.");
          if (page === "calendar") toast(e.message, true);
        }
      },
    });
    calendar.render();
    if (calendarView === "timeGridRange") calendar.changeView("timeGridRange", { start: calendarRange.from, end: addDays(calendarRange.to, 1) });
    const shiftRange = n => {
      const days = (new Date(calendarRange.to) - new Date(calendarRange.from)) / 86400000 + 1;
      calendarRange = { from: addDays(calendarRange.from, n * days), to: addDays(calendarRange.to, n * days) };
      renderCalendar();
    };
    $("#calendar-prev").onclick = () => calendarView === "timeGridRange" ? shiftRange(-1) : calendar.prev();
    $("#calendar-next").onclick = () => calendarView === "timeGridRange" ? shiftRange(1) : calendar.next();
    $("#calendar-today").onclick = () => {
      if (calendarView === "timeGridRange") { calendarRange = { from: state.today, to: addDays(state.today, 6) }; renderCalendar(); }
      else calendar.gotoDate(state.today);
    };
    $$("[data-calendar-view]").forEach(
      (b) =>
        (b.onclick = () => {
          calendarView = b.dataset.calendarView;
          $(".calendar-panel").classList.toggle("custom-range", calendarView === "timeGridRange");
          if (calendarView === "timeGridRange") calendar.changeView(calendarView, { start: calendarRange.from, end: addDays(calendarRange.to, 1) });
          else calendar.changeView(calendarView);
          calendar.updateSize();
          $$("[data-calendar-view]").forEach((x) =>
            x.classList.toggle("active", x === b),
          );
        }),
    );
    $("#refresh-calendar").onclick = async (e) => {
      e.target.disabled = true;
      try {
        await load(false);
        calendar?.refetchEvents();
      } catch (err) {
        toast(err.message, true);
      } finally {
        e.target.disabled = false;
      }
    };
  }
  let catalogueTab = "doctors", catalogueSearch = "", listService = "", listPatient = "", listFrom = "", listTo = "";
  function renderCatalogue() {
    if (catalogueTab === "doctors") { renderDoctors(); return; }
    const hasStatus = catalogueTab !== "specialties";
    const kinds = { doctors: tr("Лекари"), patients: tr("Пациенти"), specialties: tr("Специјалности"), services: tr("Услуги") };
    const items = state[catalogueTab].filter(x => `${x.name} ${x.specialty || ""}`.toLocaleLowerCase().includes(catalogueSearch.toLocaleLowerCase())).sort(compareRecords);
    const {items:visible,controls} = paged("catalogue-"+catalogueTab,items,catalogueSearch);
    app.innerHTML = heading(tr("Управување со клиниката."), tr("Уредувајте ги податоците на клиниката."), html("<button class=\"btn primary\" id=\"catalogue-add\"><svg class=\"ui-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><use href=\"/icons/interface.svg#plus\"></use></svg> Додај запис</button>"), "") +
      html`<section class="card workspace-filters"><div class="card-head"><h3>${kinds[catalogueTab]}</h3><div class="records-heading"><span class="muted">${items.length} записи</span></div></div><div class="card-body"><label for="catalogue-search">Пребарај по име</label><input id="catalogue-search" value="${escape(catalogueSearch)}" placeholder="Пребарај по назив…"></div></section>
      ${hasStatus ? html`<p class="inline-note">Деактивирањето спречува нови закажувања. Постоечките термини и историјата се задржуваат. Работното време се уредува преку Лекари ${icon("arrow-right")} Достапност; сметките за најава во Сметки и пристап.</p>` : ""}
      <section class="card table-wrap"><table><thead><tr><th>Назив</th><th>Информации</th>${hasStatus ? html`<th>Статус</th>` : ""}<th>Постапки</th></tr></thead><tbody>${visible.map(x => html`<tr><td><strong>${escape(x.name)}</strong>${x.isService ? html("<small class=\"catalogue-subtext\">Увезен услужен профил</small>") : ""}</td><td>${escape(catalogueTab === "doctors" ? x.specialty + (x.subspecialty ? " · " + x.subspecialty : "") : catalogueTab === "services" ? html`${state.specialties.find(s => s.id === x.specialtyId)?.name || ""} · ${x.durationMinutes} минути · ${state.doctorServices.filter(a => a.serviceId === x.id).length} профили` : html`${state.doctors.filter(d => d.specialtyId === x.id).length} лекари / профили`)}</td>${hasStatus ? `<td><span class="badge ${x.enabled === false ? "Cancelled" : "Confirmed"}">${x.enabled === false ? tr("Неактивен") : tr("Активен")}</span></td>` : ""}<td><button class="table-action" data-catalogue-edit="${x.id}">Измени ${icon("arrow-up-right")}</button>${catalogueTab === "doctors" ? html`<button class="table-action" data-catalogue-schedule="${x.id}">Работно време ${icon("arrow-up-right")}</button>` : ""}</td></tr>`).join("") || html`<tr><td colspan="${hasStatus ? 4 : 3}">Нема соодветни записи.</td></tr>`}</tbody></table></section>` + controls;
    $("#catalogue-add").onclick = () => editCatalogue();
    $("#catalogue-search").onchange = e => { catalogueSearch = e.target.value; renderCatalogue(); };
    $$("[data-catalogue-edit]").forEach(b => b.onclick = () => editCatalogue(b.dataset.catalogueEdit));
    $$("[data-catalogue-schedule]").forEach(b => b.onclick = () => { doctorFilter = b.dataset.catalogueSchedule; navigate("availability"); });
  }
  function editCatalogue(id) {
    const kind = catalogueTab, item = state[kind].find(x => x.id === id);
    const specialties = state.specialties.map(s => `<option value="${s.id}" ${s.id === item?.specialtyId ? "selected" : ""}>${escape(s.name)}</option>`).join("");
    openDialog(item ? tr("Измени запис") : tr("Додај во каталогот"), html`<form id="catalogue-form"><div class="field"><label for="catalogue-name">${kind === "doctors" ? tr("Име и презиме") : tr("Назив")}</label><input id="catalogue-name" name="name" required minlength="2" maxlength="200" value="${escape(item?.name || "")}"></div>
      ${kind !== "specialties" ? html`<div class="field"><label for="catalogue-specialty">Специјалност</label><select id="catalogue-specialty" name="specialtyId" required><option value="">Изберете специјалност</option>${specialties}</select></div>` : ""}
      ${kind === "doctors" ? html`<div class="field"><label for="catalogue-sub">Субспецијалност (незадолжително)</label><input id="catalogue-sub" name="subspecialty" maxlength="200" value="${escape(item?.subspecialty || "")}"></div><p class="inline-note">Нов лекар започнува без работни часови. По зачувување, внесете распоред во Достапност и доделете услуги во каталогот.</p>` : ""}
      ${kind === "doctors" ? html`<label class="catalogue-toggle"><input type="checkbox" id="catalogue-confirmation" name="requiresConfirmation" ${item?.requiresConfirmation ? "checked" : ""}> Потребна е потврда за закажување</label><label class="catalogue-toggle"><input type="checkbox" id="catalogue-staff-only" name="staffOnly" ${item?.staffOnly ? "checked" : ""}> Закажување само преку рецепција</label><p class="field-help">Важи за нови термини и презакажувања. Постоечките статуси не се менуваат.</p>` : ""}
      ${kind === "services" ? html`<div class="field"><label for="catalogue-duration">Траење (минути)</label><input id="catalogue-duration" name="durationMinutes" type="number" required min="10" max="120" step="5" value="${item?.durationMinutes || 30}"></div><fieldset class="catalogue-assignments"><legend>Лекари / профили кои ја извршуваат услугата</legend><div id="service-doctor-choices"></div></fieldset><div id="service-doctor-selected" class="service-doctor-selected"></div><p class="inline-note">Промената на траење важи за нови термини. Веќе закажаните го задржуваат своето траење.</p>` : ""}
      ${kind !== "specialties" ? html`<label class="catalogue-toggle"><input type="checkbox" name="enabled" ${item?.enabled !== false ? "checked" : ""}> Активен за нови закажувања</label>` : ""}
      <div id="catalogue-error" role="alert"></div><div class="dialog-actions"><button class="btn secondary" type="button" data-action="close">Назад</button><button class="btn primary" type="submit">Зачувај</button></div></form>`, tr("УПРАВУВАЊЕ"));
    const assignedDoctors = new Set(state.doctorServices.filter(x => x.serviceId === item?.id).map(x => x.doctorId));
    if (kind === "services") {
      const renderAssignments = () => {
        const field = $("#service-doctor-choices"), selectedSpecialty = $("#catalogue-specialty").value;
        const specialtyName = state.specialties.find(x => x.id === selectedSpecialty)?.name;
        const focused = document.activeElement?.matches('#service-doctor-choices input') ? document.activeElement.value : null;
        const doctors = state.doctors.filter(d => !selectedSpecialty || d.specialtyId === selectedSpecialty || !d.specialtyId && d.specialty === specialtyName)
          .sort((a,b) => Number(assignedDoctors.has(b.id)) - Number(assignedDoctors.has(a.id)) || compareRecords(a,b));
        field.innerHTML = doctors.length ? doctors.map(d => `<label><input type="checkbox" name="doctorIds" value="${escape(d.id)}" ${assignedDoctors.has(d.id) ? "checked" : ""}><span>${escape(d.name)}${d.enabled === false ? escape(tr(" · Неактивен")) : ""}<small>${escape(d.specialty)}</small></span></label>`).join("") : `<p class="muted">${escape(tr("Нема лекари за избраната специјалност."))}</p>`;
        const visibleDoctorIds = new Set(doctors.map(d => d.id));
        const hiddenSelected = state.doctors.filter(d => assignedDoctors.has(d.id) && !visibleDoctorIds.has(d.id)).sort(compareRecords);
        $("#service-doctor-selected").innerHTML = `<strong>${escape(tr("Избрани лекари"))}: ${assignedDoctors.size}</strong>${hiddenSelected.length ? `<p class="muted">${escape(tr("Изборот од другите специјалности се задржува."))}</p>` : ""}<div class="service-doctor-chips">${hiddenSelected.map(d => `<button type="button" class="service-doctor-chip" data-unassign-doctor="${escape(d.id)}" aria-label="${escape(tr("Отстрани лекар: {0}",d.name))}">${escape(d.name)} ${icon("x")}</button>`).join("")}</div>`;
        if (focused) [...field.querySelectorAll('input')].find(x => x.value === focused)?.focus({preventScroll:true});
      };
      $("#catalogue-specialty").addEventListener("change", renderAssignments);
      $("#service-doctor-choices").addEventListener("change", e => {
        if (!e.target.matches('input[name="doctorIds"]')) return;
        if (e.target.checked) assignedDoctors.add(e.target.value); else assignedDoctors.delete(e.target.value);
        renderAssignments();
      });
      $("#service-doctor-selected").addEventListener("click", e => {
        const button = e.target.closest('[data-unassign-doctor]'); if (!button) return;
        assignedDoctors.delete(button.dataset.unassignDoctor); renderAssignments();
        $("#catalogue-specialty").focus();
      });
      renderAssignments();
    }
    $("#catalogue-form").onsubmit = async e => {
      e.preventDefault(); const form = e.target, button = form.querySelector('[type="submit"]'); button.disabled = true;
      try {
        const f = new FormData(form), input = { id: item?.id || null, name: f.get("name"), version: item?.catalogVersion || item?.version || 0 };
        if (kind !== "specialties") Object.assign(input, { specialtyId: f.get("specialtyId"), enabled: f.has("enabled") });
        if (kind === "doctors") { input.subspecialty = f.get("subspecialty"); input.requiresConfirmation = f.has("requiresConfirmation"); input.staffOnly = f.has("staffOnly"); }
        if (kind === "services") {
          for (const choice of form.querySelectorAll('input[name="doctorIds"]')) {
            if (choice.checked) assignedDoctors.add(choice.value); else assignedDoctors.delete(choice.value);
          }
        }
        if (kind === "services") Object.assign(input, { durationMinutes: Number(f.get("durationMinutes")), doctorIds: [...assignedDoctors] });
        const saved = await api("catalogue/" + kind, input); rememberSaved(kind, saved);
        if (kind === "services") state.doctorServices = state.doctorServices.filter(link => link.serviceId !== saved.id).concat(input.doctorIds.map(doctorId => ({doctorId, serviceId:saved.id})));
        const refreshed = await refreshAfterSave();
        if (!form.isConnected || !dialog.open) return;
        if (kind === "doctors") {
          search = specialty = doctorService = "";
          revealRecord("doctors",filteredDoctors(),saved.id,JSON.stringify([search,specialty,doctorService]));
        } else {
          catalogueSearch = "";
          revealRecord("catalogue-"+kind,[...state[kind]].sort(compareRecords),saved.id);
        }
        closeDialog(); renderPage(); if (refreshed) toast(tr("Податоците се зачувани."));
      } catch (err) { if (form.isConnected && dialog.open) { $("#catalogue-error", form).textContent = err.message; button.disabled = false; } }
    };
  }
  function renderReports() {
    if (!isAdmin()) return;
    reportFilters ||= { from: state.today.slice(0, 8) + "01", to: state.today, groupBy: "day", doctorId: "", specialty: "", serviceId: "" };
    const f = reportFilters;
    app.innerHTML = heading(tr("Извештаи и статистика."), tr("Јасен преглед на термините, исходите и искористеноста."), "", "") +
      html`<section class="card workspace-filters report-controls"><div class="card-head"><div><h3>Филтри на извештајот</h3><p class="filter-description">Изберете период и профили за преглед на резултатите.</p></div></div><form id="report-form" class="card-body"><div class="report-filter-grid"><label>Од<input type="date" name="from" value="${f.from}" required></label><label>До<input type="date" name="to" value="${f.to}" required></label><label>Групирање<select name="groupBy">${[["day",tr("По ден")],["week",tr("По недела")],["month",tr("По месец")]].map(([v,l]) => `<option value="${v}" ${v === f.groupBy ? "selected" : ""}>${l}</option>`).join("")}</select></label><label>Лекар / профил<select name="doctorId">${doctorOptions(f.doctorId, true)}</select></label><label>Специјалност<select name="specialty">${specialtyOptions(f.specialty)}</select></label><label>Услуга<select name="serviceId">${serviceOptions(f.serviceId)}</select></label></div><div class="report-presets"><button type="button" class="btn secondary small" data-report-preset="today">Денес</button><button type="button" class="btn secondary small" data-report-preset="week">Оваа недела</button><button type="button" class="btn secondary small" data-report-preset="month">Овој месец</button><button type="button" class="btn secondary small" id="report-reset">Исчисти филтри</button><button class="btn primary small" type="submit">Прикажи извештај ${icon("arrow-up-right")}</button></div></form></section><div id="report-results" aria-live="polite"></div>`;
    const form = $("#report-form");
    form.onsubmit = e => { e.preventDefault(); reportFilters = Object.fromEntries(new FormData(form)); loadReport(); };
    $$("[data-report-preset]").forEach(b => b.onclick = () => {
      const type = b.dataset.reportPreset;
      window.MedTerminDates.setValue(form.elements.from, type === "today" ? state.today : type === "week" ? monday(state.today) : state.today.slice(0,8) + "01");
      window.MedTerminDates.setValue(form.elements.to, type === "week" ? addDays(monday(state.today), 6) : type === "month"
        ? new Date(Date.UTC(Number(state.today.slice(0,4)), Number(state.today.slice(5,7)), 0, 12)).toISOString().slice(0,10) : state.today);
      form.requestSubmit();
    });
    $("#report-reset").onclick = () => { for (const key of ["doctorId", "specialty", "serviceId"]) form.elements[key].value = ""; form.requestSubmit(); };
    loadReport();
  }
  async function loadReport() {
    const request = ++reportRequest, target = $("#report-results");
    target.innerHTML = html("<div class=\"loading-state\" role=\"status\"><span class=\"spinner\"></span> Се подготвува извештајот…</div>");
    try {
      const data = await api("reports?" + new URLSearchParams(reportFilters));
      if (request !== reportRequest || page !== "reports") return;
      const m = data.summary;
      const percent = value => value == null ? "—" : `${value.toFixed(1)}%`;
      const hours = value => (value / 60).toFixed(1);
      const tiles = [
        [tr("Вкупно термини"),m.total,tr("Вклучува и откажани")], [tr("Реализирани"),m.completed,tr("Завршени прегледи")],
        [tr("Потврдени"),m.confirmed,tr("Тековен статус")], [tr("Чекаат потврда"),m.pending,tr("Резервирани термини")],
        [tr("Откажани"),m.cancelled,html`${percent(m.cancellationPercent)} од сите термини`], [tr("Не се појавиле"),m.noShow,html`${percent(m.noShowPercent)} од реализирани + недоаѓања`],
        [tr("Пациенти во периодот"),m.patients,html`${data.registeredPatients} регистрирани вкупно`], [tr("Искористеност ≈"),percent(m.utilizationPercent),html`${hours(m.occupiedMinutes)} / ${hours(m.capacityMinutes)} часа`]
      ];
      const periodLabel = row => data.query.groupBy === "month" ? formatDate(row.key, { month: "long", year: "numeric" }) : (data.query.groupBy === "week" ? tr("Недела од ") : "") + formatDate(row.key);
      const max = Math.max(1, ...data.periods.map(r => r.metrics.total));
      target.innerHTML = html`<p class="results-count">${formatDate(data.query.from)} – ${formatDate(data.query.to)} · Пресметано во ${timeOf(data.generatedAt)}</p><div class="stats-grid report-stats">${tiles.map(([label,value,note]) => `<article class="card stat-card"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong><div class="stat-note">${note}</div></article>`).join("")}</div>
        <details class="report-definitions"><summary>Како се пресметуваат показателите</summary><p>Периодот ги опфаќа двата датума според локалниот почеток на прегледот. Броевите ги користат тековните статуси. „Вкупно“ ги вклучува сите статуси; процентот на откажување е откажани / вкупно. Процентот на недоаѓање е недоаѓања / (реализирани + недоаѓања). Пациентите во периодот се единствени пациенти, вклучувајќи ги и откажаните термини.</p><p>Искористеноста е приближна: зафатени минути / минути достапни за целосни прегледи, според сегашното работно време и зачуваните исклучоци. Се сметаат сите неоткажани термини, вклучувајќи недоаѓања. Не се чуваат историски верзии на распоредот. При нула капацитет се прикажува „—“.</p><p>Услугите се од каталогот; старите услужни профили остануваат посебна група. Старите лекарски термини без услуга се „Без заведена услуга“. Капацитетот по услуга е споделениот капацитет на соодветните лекари и не се собира меѓу услуги. Неделите почнуваат во понеделник. Првиот и последниот збирен период може да бидат делумни.</p></details>
        <p class="inline-note report-caveat">Искористеноста е проценка според сегашниот распоред. ${m.outsideCapacityMinutes ? html`${hours(m.outsideCapacityMinutes)} часа неоткажани термини се надвор од пресметаниот капацитет.` : ""} Капацитетот е споделен меѓу услугите; старите термини без услуга остануваат нераспределени.</p>
        ${m.total ? "" : html("<div class=\"inline-note\">Нема термини за избраните филтри. Капацитетот, ако постои, е прикажан подолу.</div>")}
        <section class="card report-chart-card"><div class="card-head"><h3>Термини низ периодот</h3><span class="muted">Сите статуси</span></div><div class="report-chart" tabindex="0" role="img" aria-label="Број на термини по период; точните вредности се во табелата подолу.">${data.periods.map(r => `<div class="report-bar" title="${escape(periodLabel(r))}: ${r.metrics.total}"><span>${r.metrics.total}</span><i style="height:${Math.max(2, r.metrics.total / max * 120)}px"></i><small>${escape(data.query.groupBy === "day" ? formatDate(r.key, { day: "numeric", month: "short" }) : periodLabel(r))}</small></div>`).join("")}</div></section>
        <section class="card report-table-card"><div class="card-head"><div class="chip-tabs" role="group" aria-label="Разгледај извештај">${[["periods",tr("По период")],["doctors",tr("По лекар / профил")],["specialties",tr("По специјалност")],["services",tr("По услуга")]].map(([key,label]) => `<button data-report-tab="${key}" aria-pressed="${key === "periods"}" class="${key === "periods" ? "active" : ""}">${label}</button>`).join("")}</div><button class="btn secondary small" id="report-export">Преземи CSV</button></div><div class="table-wrap" tabindex="0" id="report-table"></div></section>`;
      let active = "periods";
      const labels = [tr("Група"),tr("Вкупно"),tr("Потврдени"),tr("Реализирани"),tr("Откажани"),tr("Чекаат потврда"),tr("Недоаѓања"),tr("Пациенти"),tr("Капацитет (часа)"),tr("Зафатено (часа)"),tr("Искористеност ≈"),tr("Откажани %"),tr("Недоаѓања %")];
      const rowValues = r => { const v = r.metrics; return [active === "periods" ? periodLabel(r) : r.label,v.total,v.confirmed,v.completed,v.cancelled,v.pending,v.noShow,v.patients,hours(v.capacityMinutes),hours(v.occupiedMinutes),percent(v.utilizationPercent),percent(v.cancellationPercent),percent(v.noShowPercent)]; };
      const table = () => {
        $("#report-table").innerHTML = html`<table><caption class="visually-hidden">Извештај за избраниот период</caption><thead><tr>${labels.map(l => `<th scope="col">${l}</th>`).join("")}</tr></thead><tbody>${data[active].map(r => `<tr>${rowValues(r).map((v,i) => i === 0 ? `<th scope="row">${escape(v)}</th>` : `<td>${escape(v)}</td>`).join("")}</tr>`).join("") || html`<tr><td colspan="13">Нема соодветни профили.</td></tr>`}</tbody></table>`;
      };
      table();
      $$("[data-report-tab]").forEach(b => b.onclick = () => { active = b.dataset.reportTab; $$("[data-report-tab]").forEach(x => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); }); table(); });
      $("#report-export").onclick = () => {
        const safe = value => { let text = String(value); if (/^[=+@\-\t\r]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
        const rows = [[tr("Од"),data.query.from,tr("До"),data.query.to], [tr("Лекар"), data.query.doctorId || tr("Сите"), tr("Специјалност"), data.query.specialty || tr("Сите"), tr("Услуга"), data.query.serviceId || tr("Сите")], [tr("Капацитетот е проценка според сегашниот распоред. Капацитетот по услуга е споделен; историските услуги не се претпоставуваат.")], labels, ...data[active].map(rowValues)];
        const url = URL.createObjectURL(new Blob(["\ufeff" + rows.map(r => r.map(safe).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = html`МедТермин-${active}-${data.query.from}-${data.query.to}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
    } catch (error) {
      if (request === reportRequest && page === "reports") target.innerHTML = html`<div class="inline-error" role="alert">${escape(error.message)}</div><p>Проверете ги филтрите и кликнете „Прикажи извештај“ за повторен обид.</p>`;
    }
  }
  function renderPatients() {
    app.innerHTML =
      heading(
        tr("Пациенти"),
        tr("Пронајдете пациенти и организирајте ги нивните термини."),
        html("<button class=\"btn primary\" data-action=\"add-patient\"><svg class=\"ui-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><use href=\"/icons/interface.svg#plus\"></use></svg> Додај пациент</button>"),
        "",
      ) +
      html`<div class="toolbar"><div class="search-field"><label class="visually-hidden" for="patient-search">Пребарај пациенти</label><input id="patient-search" placeholder="Пребарајте по број, име, е-пошта или телефон…" value="${escape(search)}"></div></div><div class="inline-note" style="margin-bottom:20px">${state.demoMode ? tr("Демо-режим: користете само измислени контактни податоци.") : tr("Контактните податоци служат за закажување. Не внесувајте медицински податоци во овој простор.")}</div><div id="patient-results"></div>`;
    $("#patient-search").oninput = (e) => {
      search = e.target.value;
      patientResults();
    };
    patientResults();
  }
  async function patientResults() {
    let total=null, all;
    if(state.windowed) {
      const result=await workspacePage("patients",$("#patient-results"),"workspace/patients",search,{search,locateId:patientFocusId});
      if(!result)return;
      state.patients=mergeRecords(state.patients,result.items);all=result.items;total=result.total;
      if(result.locatedSkip!=null)recordPages.get("patients").page=Math.floor(result.locatedSkip/recordPages.get("patients").size)+1;
      patientFocusId="";
    } else all = state.patients.filter(p => `${p.name} ${patientCode(p)} ${p.email} ${p.phone}`.toLowerCase().includes(search.toLowerCase())).sort(compareRecords);
    const {items:list,controls} = paged("patients",all,search,total);
    const actions = p => recordAction("patient-profile", p.id, tr("Види профил"), "profile") + recordAction("patient-book", p.id, tr("Закажи"), "book", "primary");
    const cards = `<div class="patient-card-list">${list.map((p,i) => `<article class="card patient-card">${avatar(p.name,i)}<h3>${escape(p.name)}</h3>${patientNumber(p)}<p>${escape(p.email || tr("Не е наведена е-пошта"))}</p><p>${escape(p.phone || tr("Не е наведен телефон"))}</p><span class="badge">${tr("Пациент")}</span><div class="patient-card-actions patient-actions">${actions(p)}</div></article>`).join("")}</div>`;
    const table = html`<section class="card table-wrap records-table" tabindex="0" aria-label="Листа со постапки"><table><thead><tr><th>Број на пациент</th><th>Пациент</th><th>Е-пошта</th><th>Телефон</th><th>Постапки</th></tr></thead><tbody>${list.map(p => `<tr><td><span class="patient-code">${escape(patientCode(p))}</span></td><td><strong>${escape(p.name)}</strong></td><td>${escape(p.email || tr("Не е наведена"))}</td><td>${escape(p.phone || tr("Не е наведен"))}</td><td><div class="record-actions patient-actions">${actions(p)}</div></td></tr>`).join("")}</tbody></table></section>`;
    $("#patient-results").innerHTML = html`<div class="records-heading"><p class="results-count">${total ?? all.length} пациенти</p>${viewSwitch("patients")}</div>` + (list.length ? recordView("patients") === "list" ? table : cards : empty(tr("Нема соодветни пациенти"), tr("Обидете се со друго пребарување или додајте пациент."))) + controls;
  }
  const defaultPatientFilters = () => ({ period: "all", status: "", doctor: "", service: "", from: "", to: "" });
  async function renderPatientProfile(quiet = false) {
    if(quiet===true && state.windowed && patientProfile) { await patientAppointmentResults();return; }
    const request = ++patientRequest;
    patientProfile = null;
    let id;
    try { id = location.hash.startsWith("#patient/") ? decodeURIComponent(location.hash.slice(9)) : state.actor.patientId; } catch { id = null; }
    if (patientProfileId !== id) { patientProfileId = id; patientFilters = defaultPatientFilters(); }
    patientFilters ||= defaultPatientFilters();
    const back = html`<button class="btn secondary small" data-nav="${isPatient() ? "appointments" : "patients"}">${icon("arrow-left")} ${isPatient() ? tr("Мои термини") : tr("Сите пациенти")}</button>`;
    if (quiet !== true) app.innerHTML = heading(tr("Профил на пациент"), tr("Контактни податоци и преглед на термините."), back) + html("<div class=\"loading-state\" role=\"status\"><span class=\"spinner\"></span> Се вчитува профилот…</div>");
    try {
      if (!id) throw new Error(tr("Изберете пациент од списокот."));
      const result = await api(state.windowed ? "workspace/patients/"+encodeURIComponent(id)+"?"+workspaceQuery("patient-history",JSON.stringify([id,patientFilters]),
        {period:patientFilters.period,status:patientFilters.status,doctorId:patientFilters.doctor,serviceId:patientFilters.service,from:patientFilters.from,to:patientFilters.to}) : "patients/" + encodeURIComponent(id));
      if (request !== patientRequest || page !== "profile") return;
      patientProfile = result;
      const p = result.patient;
      state.patients = [...state.patients.filter(x => x.id !== p.id), p];
      state.appointments = state.windowed ? mergeRecords(state.appointments,result.appointments) : [...state.appointments.filter(a => a.patientId !== p.id), ...result.appointments];
      const count = status => result.appointments.filter(a => a.status === status).length;
      const stats = [[tr("Претстојни"), result.counts?.upcoming ?? result.appointments.filter(upcoming).length], [tr("Завршени"), result.counts?.completed ?? count("Completed")], [tr("Откажани"), result.counts?.cancelled ?? count("Cancelled")], [tr("Недоаѓања"), result.counts?.noShow ?? count("NoShow")]];
      app.innerHTML = heading(tr("Профил на пациент"), tr("Контактни податоци и историја на термини."), back, tr("ПРОФИЛ НА ПАЦИЕНТ")) +
        html`<section class="card patient-summary"><div class="patient-summary-main">${avatar(p.name, 0, "lg")}<div><h2>${escape(p.name)}</h2>${patientNumber(p)}<span class="badge">${tr("Пациент")}</span></div><div class="patient-summary-actions">${result.canEdit ? html("<button class=\"btn secondary\" id=\"edit-patient\">Уреди податоци</button>") : ""}<button class="btn primary" data-patient-book="${escape(p.id)}">${icon("plus")} Закажи термин</button></div></div><dl class="patient-contacts"><div><dt>Е-пошта за контакт</dt><dd>${escape(p.email || tr("Не е наведена"))}</dd></div><div><dt>Телефон</dt><dd>${escape(p.phone || tr("Не е наведен"))}</dd></div></dl><p class="filter-description">Контактните податоци се користат за закажување. ${result.canEdit ? tr("Нивното уредување не ја менува сметката или е-поштата за најава.") : tr("За промена на контактните податоци обратете се во рецепција.")}</p></section>` +
        `<p class="results-count">${isDoctor() ? tr("Прикажани се само термините со вас. Контактите се споделени со тимот во оваа клиника.") : tr("Прикажани се термините на пациентот во оваа клиника.")}</p><div class="stats-grid patient-stats">${stats.map(([label, value]) => `<div class="stat-card"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong></div>`).join("")}</div>` +
        html`<section class="card workspace-filters appointment-filters"><div class="card-head"><div><h3>Историја на термини</h3><p class="filter-description">Филтрирајте по период, статус, лекар или услуга. Датумите ги вклучуваат двата дена.</p></div><button class="btn secondary small" id="clear-patient-filters">Исчисти</button></div><div class="card-body"><div class="chip-tabs" role="group" aria-label="Период на термините">${[["all", tr("Сите")], ["upcoming", tr("Претстојни")], ["past", tr("Претходни")]].map(([value, label]) => `<button data-patient-period="${value}" class="${patientFilters.period === value ? "active" : ""}" aria-pressed="${patientFilters.period === value}">${label}</button>`).join("")}</div><div class="report-filter-grid"><label>Статус<select id="profile-status"><option value="">Сите статуси</option>${statuses.map(x => `<option value="${x}" ${patientFilters.status === x ? "selected" : ""}>${statusLabel(x)}</option>`).join("")}</select></label>${!isDoctor() ? html`<label>Лекар<select id="profile-doctor">${doctorOptions(patientFilters.doctor, true)}</select></label>` : ""}<label>Услуга<select id="profile-service">${serviceOptions(patientFilters.service)}</select></label><label>Од датум<input type="date" id="profile-from" value="${escape(patientFilters.from)}"></label><label>До датум<input type="date" id="profile-to" value="${escape(patientFilters.to)}"></label></div><div id="profile-filter-error" class="filter-error" role="alert"></div></div></section><div id="profile-appointments" aria-live="polite"></div>`;
      $("#edit-patient")?.addEventListener("click", editPatientForm);
      for (const key of ["status", "doctor", "service", "from", "to"]) {
        $("#profile-" + key)?.addEventListener("change", e => { patientFilters[key] = e.target.value; patientAppointmentResults(); });
      }
      $$("[data-patient-period]").forEach(button => button.onclick = () => {
        patientFilters.period = button.dataset.patientPeriod;
        $$("[data-patient-period]").forEach(b => { const active = b === button; b.classList.toggle("active", active); b.setAttribute("aria-pressed", String(active)); });
        patientAppointmentResults();
      });
      $("#clear-patient-filters").onclick = () => { patientFilters = defaultPatientFilters(); renderPatientProfile(); };
      patientAppointmentResults(state.windowed ? result : null);
    } catch (error) {
      if (request !== patientRequest || page !== "profile") return;
      app.innerHTML = heading(tr("Профилот не е достапен."), tr("Проверете го изборот на пациент и обидете се повторно."), back) + html`<div class="inline-error" role="alert">${escape(error.message)}</div><button class="btn secondary" id="retry-patient">Обиди се повторно</button>`;
      $("#retry-patient").onclick = renderPatientProfile;
    }
  }
  async function patientAppointmentResults(prefetched = null) {
    if (!patientProfile || !$("#profile-appointments")) return;
    const f = patientFilters, invalid = f.from && f.to && f.from > f.to;
    $("#profile-filter-error").textContent = invalid ? tr("Почетниот датум не смее да биде по крајниот датум.") : "";
    if (invalid) { $("#profile-appointments").innerHTML = ""; return; }
    const filter=JSON.stringify([patientProfile.patient.id,f]);
    let total=null,list;
    if(state.windowed) {
      const result=prefetched || await workspacePage("patient-history",$("#profile-appointments"),"workspace/patients/"+encodeURIComponent(patientProfile.patient.id),filter,
        {period:f.period,status:f.status,doctorId:f.doctor,serviceId:f.service,from:f.from,to:f.to});
      if(!result)return;
      patientProfile.appointments=result.appointments;state.appointments=mergeRecords(state.appointments,result.appointments);
      if(result.counts) $$(".patient-stats .stat-value").forEach((el,i)=>{el.textContent=[result.counts.upcoming,result.counts.completed,result.counts.cancelled,result.counts.noShow][i];});
      list=result.appointments;total=result.total;
    } else list = patientProfile.appointments.filter(a =>
      (f.period === "all" || (f.period === "upcoming" ? upcoming(a) : new Date(a.end) <= new Date())) &&
      (!f.status || a.status === f.status) && (!f.doctor || a.doctorId === f.doctor) &&
      (!f.service || serviceKey(a) === f.service) && (!f.from || dayOf(a.start) >= f.from) && (!f.to || dayOf(a.start) <= f.to)
    ).sort((a, b) => (f.period === "upcoming" ? new Date(a.start) - new Date(b.start) : new Date(b.start) - new Date(a.start)) || a.id.localeCompare(b.id));
    const {items,controls} = paged("patient-history",list,filter,total);
    $("#profile-appointments").innerHTML = html`<p class="results-count">${total ?? list.length} термини</p><section class="card table-wrap">${list.length ? html`<table><thead><tr><th>Лекар / услуга</th><th>Датум и време</th><th>Статус</th><th><span class="visually-hidden">Постапки</span></th></tr></thead><tbody>${items.map(a => html`<tr><td><div class="table-person">${avatar(doctor(a.doctorId)?.name || tr("Лекар"), 0)}<span><strong>${escape(doctor(a.doctorId)?.name || tr("Лекар"))}</strong><small>${escape(a.serviceName || tr("Без заведена услуга"))}</small></span></div></td><td class="table-date"><strong>${formatDate(dayOf(a.start))}</strong><small>${timeOf(a.start)} – ${timeOf(a.end)}</small></td><td>${badge(a.status)}</td><td><button class="table-action" data-detail="${escape(a.id)}" aria-label="Детали за термин на ${escape(formatDate(dayOf(a.start)))} во ${timeOf(a.start)}">Детали ${icon("arrow-up-right")}</button></td></tr>`).join("")}</tbody></table>` : empty(tr("Нема термини во овој приказ"), tr("Променете ги филтрите или закажете нов термин за пациентот."))}</section>` + controls;
  }
  function editPatientForm() {
    if (!patientProfile?.canEdit) return;
    const p = patientProfile.patient;
    openDialog(tr("Уреди податоци за пациентот"), html`<p class="inline-note">Промените важат за контактите во оваа клиника. Сметката и е-поштата за најава остануваат исти.</p><form id="edit-patient-form"><div class="field"><label for="edit-patient-name">Име и презиме</label><input id="edit-patient-name" name="name" required minlength="2" maxlength="80" value="${escape(p.name)}" autocomplete="name"></div><div class="field"><label for="edit-patient-email">Е-пошта за контакт · незадолжително</label><input id="edit-patient-email" name="email" type="email" maxlength="120" value="${escape(p.email)}" autocomplete="email"></div><div class="field"><label for="edit-patient-phone">Телефон</label><input id="edit-patient-phone" name="phone" type="tel" required maxlength="30" value="${escape(p.phone)}" autocomplete="tel"></div><div id="edit-patient-error" role="alert"></div><div class="dialog-actions"><button type="button" class="btn secondary" data-action="close">Откажи</button><button type="submit" class="btn primary">Зачувај промени</button></div></form>`, tr("КОНТАКТНИ ПОДАТОЦИ"));
    $("#edit-patient-form").onsubmit = async e => {
      e.preventDefault();
      const form = e.target, button = $("button[type=submit]", form), errorBox = $("#edit-patient-error", form);
      button.disabled = true; errorBox.textContent = "";
      try {
        const saved = await api("patients/" + encodeURIComponent(p.id), { ...Object.fromEntries(new FormData(form)), version: p.version });
        rememberSaved("patients", saved);
        const refreshed = await refreshAfterSave();
        if (!form.isConnected || !dialog.open) return;
        closeDialog(); renderPage();
        if (refreshed) toast(tr("Податоците за пациентот се зачувани."));
      } catch (error) {
        if (errorBox.isConnected) {
          errorBox.innerHTML = `<div class="inline-error">${escape(error.message)}</div>${error.status === 409 ? html("<button type=\"button\" class=\"btn secondary small\" id=\"reload-patient-contact\">Отфрли ги внесените промени и вчитај ги тековните податоци</button>") : ""}`;
          $("#reload-patient-contact")?.addEventListener("click", () => { closeDialog(); renderPatientProfile(); });
        }
      } finally { button.disabled = false; }
    };
  }
  function addPatientForm(returnBooking) {
    openDialog(
      tr("Додај пациент"),
      html`<p class="muted" style="font-size:0.9375rem">${state.demoMode ? tr("Користете само измислени податоци.") : tr("Овој пациент ќе биде достапен за закажување од медицинскиот тим.")}</p><form id="patient-form"><div class="field"><label for="patient-name">Име и презиме</label><input id="patient-name" name="name" required minlength="2" maxlength="80" placeholder="на пр. Ана Петрова"></div><div class="field"><label for="patient-email">Е-пошта</label><input id="patient-email" name="email" type="email" required maxlength="120" placeholder="ana@example.com"></div><div class="field"><label for="patient-phone">Телефон</label><input id="patient-phone" name="phone" type="tel" required maxlength="30" autocomplete="tel"></div><div id="patient-error"></div><div class="dialog-actions"><button class="btn secondary" type="button" id="patient-back">Назад</button><button class="btn primary" type="submit">Додај пациент</button></div></form>`,
      tr("ПОДАТОЦИ ЗА ПАЦИЕНТОТ"),
    );
    $("#patient-back").onclick = () => {
      if (returnBooking) {
        booking = returnBooking;
        bookingForm();
        loadSlots();
      } else closeDialog();
    };
    $("#patient-form").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target, button = $("button[type=submit]", form);
      button.disabled = true;
      try {
        const p = await api(
          "patients",
          Object.fromEntries(new FormData(e.target)),
        );
        rememberSaved("patients", p);
        const refreshed = await refreshAfterSave();
        if (!form.isConnected || !dialog.open) return;
        if (returnBooking) {
          booking = { ...returnBooking, patientId: p.id };
          bookingForm();
          await loadSlots();
        } else {
          closeDialog();
          if (page === "patients") {
            search = "";
            if(state.windowed)patientFocusId=p.id;
            else revealRecord("patients",[...state.patients].sort(compareRecords),p.id);
          }
          renderPage();
        }
        if (refreshed) toast(tr("Пациентот е додаден."));
      } catch (err) {
        if (!form.isConnected || !dialog.open) return;
        $("#patient-error", form).innerHTML =
          `<div class="inline-error" role="alert">${escape(err.message)}</div>`;
        button.disabled = false;
      }
    };
  }
  async function renderAvailability() {
    if (!ownDoctors().length) {
      app.innerHTML = heading(tr("Работно време и достапност"), tr("Прво додајте лекар во каталогот на клиниката.")) +
        html`<section class="card account-section">${empty(tr("Клиниката сè уште нема лекари"), tr("Додајте специјалност и лекар, па внесете го неговото работно време."))}<a class="btn secondary" href="#catalogue">Отвори управување</a></section>`;
      return;
    }
    if (!doctorFilter) doctorFilter = ownDoctors()[0]?.id;
    const d = doctor(doctorFilter);
    // Keep the version of the displayed hours, independent of background bootstrap refreshes.
    const scheduleDoctorId = d.id;
    let scheduleVersion = d.scheduleVersion;
    let schedulePeriods = d.workingPeriods.map(p => ({...p}));
    let editingRange = "regular", scheduleEdited = false;
    const datedRanges = [...new Map(schedulePeriods.filter(p => p.validFrom).map(p => [p.validFrom + "/" + p.validTo, p])).entries()];
    app.innerHTML =
      heading(
        tr("Достапност и работно време"),
        tr("Управувајте со работното време, паузите, отсуствата и дополнителните термини."),
        "",
        tr("ДОСТАПНОСТ"),
      ) +
      html`<a class="availability-back" href="#doctors">${icon("arrow-left")} Лекари</a><div class="toolbar"><label for="availability-doctor">Лекар</label><select id="availability-doctor" ${isDoctor() ? "disabled" : ""}>${doctorOptions(doctorFilter)}</select></div><div class="inline-note" style="margin-bottom:20px">Промените се видливи во сите работни простори. Постоечките термини се заштитени: промените што се преклопуваат со нив ќе бидат одбиени.</div><div class="schedule-editor"><section class="card"><h3>Неделно работно време</h3><p class="muted" style="font-size:0.9375rem">Користете одделни периоди за поделени смени или редовни паузи.</p><form id="schedule-form"><div class="field"><label for="schedule-range">Распоред</label><select id="schedule-range"><option value="regular">Редовна недела</option>${datedRanges.map(([key,p]) => `<option value="${key}">${formatDate(p.validFrom)} – ${formatDate(p.validTo)}</option>`).join("")}<option value="new">Нов распоред за период</option></select></div><div id="schedule-range-dates" class="form-row" hidden><div class="field"><label for="schedule-from">Важи од</label><input id="schedule-from" type="date" value="${addDays(monday(state.today),7)}"></div><div class="field"><label for="schedule-to">Важи до</label><input id="schedule-to" type="date" value="${addDays(monday(state.today),13)}"></div></div><p id="schedule-range-help" class="field-help" hidden>Овој распоред ја заменува редовната недела само во избраниот период. Потоа повторно важи редовниот распоред.</p><div class="schedule-period-actions"><button type="button" class="btn secondary small" id="copy-schedule-week" hidden>Копирај редовна недела</button><label id="remove-schedule-range-label" hidden><input id="remove-schedule-range" type="checkbox"> Отстрани го овој распоред за период</label></div><div class="field" ${state.doctorServices.some(link => link.doctorId === d.id) ? "hidden" : ""}><label for="duration">Стандардно времетраење без услуга (минути)</label><input id="duration" type="number" min="10" max="120" step="5" value="${d.durationMinutes}" required></div><div id="periods">${d.workingPeriods.filter(p => !p.validFrom).map(periodRow).join("")}</div><button type="button" class="btn secondary small" id="add-period">${icon("plus")} Додај работен период</button><div id="schedule-error" style="margin-top:15px"></div><div class="dialog-actions"><button class="btn primary" type="submit">Зачувај работно време</button></div></form></section><section class="card"><h3>Исклучоци и отсуства</h3><p class="muted" style="font-size:0.9375rem">Означете пауза или празник како недостапен период или додајте еднократен слободен период.</p><form id="exception-form"><div class="form-row"><div class="field"><label for="exception-date">Датум</label><input id="exception-date" name="date" type="date" min="${state.today}" max="${addDays(state.today, 180)}" value="${state.today}" required></div><div class="field"><label for="exception-type">Вид</label><select id="exception-type" name="type"><option value="blocked">Недостапно / пауза</option><option value="available">Дополнителна достапност</option></select></div></div><div class="form-row"><div class="field"><label for="exception-start">Од</label><input id="exception-start" type="time" name="start" value="12:00" required></div><div class="field"><label for="exception-end">До</label><input id="exception-end" type="time" name="end" value="13:00" required></div></div><div class="field"><label for="exception-reason">Причина</label><input id="exception-reason" name="reason" maxlength="120" minlength="2" placeholder="на пр. Пауза за ручек" required><div class="field-help">За цел ден користете 00:00–23:59. Без медицински податоци.</div></div><div id="exception-error"></div><button class="btn primary wide" type="submit">Додај исклучок</button></form><div class="divider"></div><label>Зачувани исклучоци</label><div id="exception-list" aria-live="polite">Се вчитува…</div></section></div>${isAdmin() && state.canReset ? html`<section class="reset-panel"><div><strong>Започнете одново</strong><p>Вратете ги сите демо-термини, пациенти и промени во распоредот на почетните податоци.</p></div><button class="btn secondary" id="reset-demo">Ресетирај демо</button></section>` : ""}`;
    $("#availability-doctor").onchange = (e) => {
      doctorFilter = e.target.value;
      renderAvailability();
    };
    const rangeSelect = $("#schedule-range"), fromField = $("#schedule-from"), toField = $("#schedule-to");
    $("#schedule-form").addEventListener("input", e => { if (e.target !== rangeSelect) scheduleEdited = true; });
    $("#schedule-form").addEventListener("change", e => { if (e.target !== rangeSelect) scheduleEdited = true; });
    rangeSelect.onchange = async () => {
      const choice = rangeSelect.value;
      if (scheduleEdited && !(await confirmAction(tr("Да се вчита избраниот распоред? Незачуваните промени во часовите ќе се отфрлат.")))) { rangeSelect.value = editingRange; return; }
      editingRange = choice; scheduleEdited = false;
      const dated = choice !== "regular", range = choice === "new" ? null : choice.split("/");
      if (dated && range) { fromField.value = range[0]; toField.value = range[1]; }
      $("#schedule-range-dates").hidden = !dated; $("#schedule-range-help").hidden = !dated;
      fromField.required = toField.required = dated;
      $("#copy-schedule-week").hidden = !dated;
      $("#remove-schedule-range-label").hidden = !dated || choice === "new"; $("#remove-schedule-range").checked = false;
      const rows = schedulePeriods.filter(p => choice === "regular" ? !p.validFrom : choice === "new" ? !p.validFrom : p.validFrom === range[0] && p.validTo === range[1]);
      $("#periods").innerHTML = rows.map(periodRow).join("");
    };
    $("#copy-schedule-week").onclick = () => {
      $("#periods").innerHTML = schedulePeriods.filter(p => !p.validFrom).map(periodRow).join("");
      $("#schedule-form").dispatchEvent(new Event("change", {bubbles:true}));
    };
    $("#add-period").onclick = () => {
      $("#periods").insertAdjacentHTML(
        "beforeend",
        periodRow({ day: "Monday", start: "09:00", end: "17:00" }),
      );
      $("#schedule-form").dispatchEvent(new Event("change", { bubbles: true }));
    };
    $("#periods").onclick = (e) => {
      const b = e.target.closest("[data-remove-period]");
      if (b) { b.closest(".period-row").remove(); $("#schedule-form").dispatchEvent(new Event("change", { bubbles: true })); }
    };
    $("#schedule-form").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target, button = $("button[type=submit]", form);
      const revision = window.MedTerminFormState?.revision(form);
      if (button.disabled) return;
      button.disabled = true; rangeSelect.disabled = true;
      try {
        const dated = editingRange !== "regular", remove = dated && $("#remove-schedule-range").checked;
        const rangeFrom = fromField.value, rangeTo = toField.value;
        if (remove && !(await confirmAction(tr("Да се отстрани овој датиран распоред? Повторно ќе важи редовната недела.")))) return;
        const edited = remove ? [] : $$(".period-row", form).map((row) => ({
          day: $(".period-day", row).value, start: $(".period-start", row).value, end: $(".period-end", row).value,
          ...(dated ? {validFrom:rangeFrom,validTo:rangeTo} : {}),
        }));
        if (dated && !remove && (!rangeFrom || !rangeTo || !edited.length)) throw new Error(tr("Додајте најмалку еден работен период и изберете важечки датуми."));
        const original = editingRange.split("/");
        const periods = schedulePeriods.filter(p => editingRange === "regular" ? !!p.validFrom : editingRange === "new" || p.validFrom !== original[0] || p.validTo !== original[1]).concat(edited);
        await api("schedule/" + scheduleDoctorId, {
          periods,
          durationMinutes: Number($("#duration", form).value),
          version: scheduleVersion,
        });
        // Advance only after our own successful save, never from a background refresh.
        scheduleVersion++;
        schedulePeriods = periods.map(p => ({...p}));
        if (dated) {
          const newKey = remove ? "regular" : rangeFrom + "/" + rangeTo;
          const oldOption = [...rangeSelect.options].find(o => o.value === editingRange && editingRange !== "new");
          if (oldOption) oldOption.remove();
          if (!remove) rangeSelect.add(new Option(formatDate(rangeFrom) + " – " + formatDate(rangeTo), newKey), rangeSelect.options[rangeSelect.options.length-1]);
          editingRange = newKey; rangeSelect.value = newKey; $("#remove-schedule-range-label").hidden = remove;
          if (remove) { $("#periods").innerHTML = schedulePeriods.filter(p=>!p.validFrom).map(periodRow).join(""); $("#schedule-range-dates").hidden = $("#schedule-range-help").hidden = $("#copy-schedule-week").hidden = $("#remove-schedule-range-label").hidden = true; fromField.required = toField.required = false; }
        }
        const savedDoctor = state.doctors.find(x => x.id === scheduleDoctorId);
        if (savedDoctor) { savedDoctor.workingPeriods = periods; savedDoctor.durationMinutes = Number($("#duration", form).value); savedDoctor.scheduleVersion = scheduleVersion; }
        if (window.MedTerminFormState?.revision(form) === revision) scheduleEdited = false;
        window.MedTerminFormState?.saved(form, revision);
        const refreshed = await refreshAfterSave();
        if (form !== $("#schedule-form")) return;
        $("#schedule-error", form).innerHTML = "";
        if (refreshed) toast(tr("Неделното работно време е зачувано."));
      } catch (err) {
        if (form !== $("#schedule-form")) return;
        const errorBox = $("#schedule-error", form);
        errorBox.innerHTML =
          `<div class="inline-error" role="alert">${escape(err.message)}${err.status === 409 ? tr(" Вашите внесени промени се задржани. Вчитајте го тековното работно време пред повторно уредување.") : ""}</div>${err.status === 409 ? html("<button type=\"button\" class=\"btn secondary small\" id=\"reload-schedule\">Отфрли ги внесените промени и вчитај го тековното работно време</button>") : ""}`;
        $("#reload-schedule", form)?.addEventListener("click", async (event) => {
          event.target.disabled = true;
          try {
            await load(false);
            if (form === $("#schedule-form")) renderAvailability();
          } catch (error) {
            if (form === $("#schedule-form")) toast(error.message, true);
          } finally { event.target.disabled = false; }
        });
      } finally {
        button.disabled = false; rangeSelect.disabled = false;
      }
    };
    $("#exception-form").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target, button = $("button[type=submit]", form);
      const revision = window.MedTerminFormState?.revision(form);
      if (button.disabled) return;
      button.disabled = true;
      const originalText = button.textContent; button.textContent = tr("Се зачувува…");
      try {
        const values = Object.fromEntries(new FormData(form));
        await api("exceptions/" + doctorFilter, {
          ...values,
          isAvailable: values.type === "available",
        });
        if (form !== $("#exception-form")) return;
        $("#exception-error").innerHTML = "";
        window.MedTerminFormState?.saved(form, revision);
        await exceptionList();
        toast(tr("Исклучокот во достапноста е зачуван."));
      } catch (err) {
        if (form === $("#exception-form")) $("#exception-error").innerHTML =
          `<div class="inline-error" role="alert">${escape(err.message)}</div>`;
      } finally {
        button.disabled = false; button.textContent = originalText;
      }
    };
    $("#reset-demo")?.addEventListener("click", async (e) => {
      if (
        !(await confirmAction(
          tr("Дали сакате да ги ресетирате сите демо-податоци? Ќе се избришат сите додадени пациенти, термини и промени во распоредот."),
          tr("Ресетирај демо-податоци"),
        ))
      )
        return;
      e.target.disabled = true;
      try {
        await api("reset", {});
        await load();
        toast(tr("Демо-податоците се ресетирани."));
      } catch (err) {
        toast(err.message, true);
        e.target.disabled = false;
      }
    });
    await exceptionList();
  }
  function periodRow(p) {
    return html`<div class="period-row"><select class="period-day" aria-label="Работен ден">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<option value="${days[i]}" ${p.day === days[i] ? "selected" : ""}>${dayLabels[i]}</option>`).join("")}</select><input class="period-start" type="time" aria-label="Почеток на работниот период" value="${p.start.slice(0, 5)}" required><input class="period-end" type="time" aria-label="Крај на работниот период" value="${p.end.slice(0, 5)}" required><button type="button" class="icon-button" data-remove-period aria-label="Отстрани работен период">${icon("x")}</button></div>`;
  }
  async function exceptionList() {
    try {
      const list = await api("exceptions?doctorId=" + doctorFilter);
      if (!$("#exception-list")) return;
      $("#exception-list").innerHTML = list.length
        ? list
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(
              (e) =>
                html`<div class="exception-row"><div><strong>${formatDate(e.date)} · ${e.start.slice(0, 5)}–${e.end.slice(0, 5)}</strong><small>${e.isAvailable ? tr("Дополнителна достапност") : tr("Недостапно")} · ${escape(e.reason)}</small></div><button class="icon-button" data-remove-exception="${e.id}" aria-label="Отстрани исклучок">${icon("x")}</button></div>`,
            )
            .join("")
        : html("<p class=\"muted\" style=\"font-size:0.9375rem\">Нема исклучоци. Важи неделното работно време.</p>");
      $$("[data-remove-exception]").forEach(
        (b) =>
          (b.onclick = async () => {
            if (
              !(await confirmAction(
                tr("Дали сакате да го отстраните овој исклучок во достапноста?"),
                tr("Отстрани исклучок"),
              ))
            )
              return;
            try {
              await api(
                "exceptions/" + b.dataset.removeException + "/remove",
                {},
              );
              await exceptionList();
              toast(tr("Исклучокот е отстранет."));
            } catch (e) {
              toast(e.message, true);
            }
          }),
      );
    } catch (e) {
      if ($("#exception-list"))
        $("#exception-list").innerHTML =
          `<div class="inline-error">${escape(e.message)}</div>`;
    }
  }
  document.addEventListener("click", async (e) => {
    document.querySelectorAll(".doctor-menu[open]").forEach(menu => {
      if (!menu.contains(e.target) || e.target.closest("button")) menu.open = false;
    });
    const target = e.target.closest("button, a");
    if (!target || !state || target.disabled) return;
    if (target.dataset.pagination) {
      const kind=target.dataset.pagination,paging=recordPages.get(kind);
      if (paging) { paging.page=Number(target.dataset.pageNumber);await renderRecordPage(kind);document.querySelector(`[data-pagination-nav="${kind}"]`)?.focus({preventScroll:true}); }
    }
    if (target.dataset.nav) {
      closeDialogIfOpen();
      navigate(target.dataset.nav);
    }
    if (target.dataset.page) {
      navigate(target.dataset.page);
    }
    if (target.dataset.recordsView) {
      const kind = target.dataset.recordsKind, value = target.dataset.recordsView;
      recordViews[kind] = value;
      try { localStorage.setItem("termino.view." + kind, value); } catch { /* Optional preference. */ }
      if (kind === "doctors") doctorResults(); else if (kind === "patients") patientResults(); else renderCatalogue();
      app.querySelector(`[data-records-kind="${kind}"][data-records-view="${value}"]`)?.focus();
    }
    if (isAdmin() && (target.dataset.doctorEdit || target.dataset.action === "add-doctor")) { catalogueTab = "doctors"; editCatalogue(target.dataset.doctorEdit); }
    if (target.dataset.availability) { doctorFilter = target.dataset.availability; navigate("availability"); }
    if (target.dataset.profile) profile(target.dataset.profile);
    if (target.dataset.book) openBooking(target.dataset.book);
    if (target.dataset.detail) details(target.dataset.detail);
    if (target.dataset.move) openBooking(null, null, null, target.dataset.move);
    if (target.dataset.status)
      changeStatus(target.dataset.id, target.dataset.status, target);
    if (target.dataset.listTab) {
      listTab = target.dataset.listTab;
      renderAppointments();
    }
    if (target.dataset.patientProfile) navigate("patient/" + encodeURIComponent(target.dataset.patientProfile));
    if (target.dataset.patientBook)
      openBooking(null, null, null, null, target.dataset.patientBook);
    if (target.dataset.action === "book") {
      if (isPatient()) navigate("doctors");
      else if (page === "calendar") {
        const selected = doctorFilter || calendarDoctors()[0]?.id;
        if (selected) openBooking(selected); else toast(tr("Нема профили за избраните филтри."), true);
      } else openBooking();
    }
    if (target.dataset.action === "close") closeDialog();
    if (target.dataset.action === "add-patient") addPatientForm();
  });
  function closeDialogIfOpen() {
    if (dialog.open) closeDialog();
  }
  $("#close-dialog").onclick = closeDialog;
  dialog.addEventListener("cancel", () => {
    booking = null;
    slotRequest++;
  });
  window.addEventListener("hashchange", () => {
    search = "";
    specialty = "";
    statusFilter = "";
    if (state) renderPage();
  });
  async function sync() {
    if (
      !state ||
      document.hidden ||
      document.querySelector("dialog[open]") ||
      refreshInFlight ||
      ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)
    )
      return;
    refreshInFlight = true;
    try {
      await load(false);
      if (page === "calendar") calendar?.refetchEvents();
      else if (page === "overview") renderOverview();
      else if (page === "appointments") appointmentResults();
      else if (page === "profile") await renderPatientProfile(true);
      else if (page === "patients") patientResults();
      else if (page === "doctors") refreshFirstSlots();
    } catch {
    } finally {
      refreshInFlight = false;
    }
  }
  setInterval(sync, 20000);
  window.addEventListener("focus", sync);
  load().catch((e) => {
    app.innerHTML =
      heading(
        tr("Не можевме да го вчитаме вашиот работен простор."),
        tr("Вашите зачувани термини не се променети."),
      ) +
      html`<div class="inline-error" role="alert">${escape(e.message)}</div><button class="btn primary" id="retry-load">Обиди се повторно</button><a class="btn secondary" href="/Account/Login">Најави се</a>`;
    $("#retry-load").onclick = () => location.reload();
  });
})();

})();
