"use strict";
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
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const dayLabels = ["Недела", "Понеделник", "Вторник", "Среда", "Четврток", "Петок", "Сабота"];
  const statuses = [
    "Scheduled",
    "Confirmed",
    "Completed",
    "Cancelled",
    "NoShow",
  ];
  const statusLabel = (s) =>
    ({ Scheduled: "Чека потврда", Confirmed: "Потврден", Completed: "Завршен", Cancelled: "Откажан", NoShow: "Не се појавил" })[s] || "Непознат статус";
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
  let calendarSpecialty = "", calendarService = "", calendarRange, reportRequest = 0, reportFilters;
  const serviceOptions = selected => `<option value="">Сите услуги / прегледи</option><option value="unassigned" ${selected === "unassigned" ? "selected" : ""}>Без заведена услуга</option>${[...state.services, ...state.doctors.filter(d => d.isService)].map(d => `<option value="${d.id}" ${selected === d.id ? "selected" : ""}>${escape(d.name)}</option>`).join("")}`;
  const specialtyOptions = selected => `<option value="">Сите специјалности</option>${[...new Set(state.doctors.map(d => d.specialty))].sort().map(v => `<option value="${escape(v)}" ${selected === v ? "selected" : ""}>${escape(v)}</option>`).join("")}`;
  const serviceKey = a => a.serviceId || (doctor(a.doctorId)?.isService ? a.doctorId : "unassigned");
  const servicesFor = id => state.services.filter(s => s.enabled && state.doctorServices.some(x => x.doctorId === id && x.serviceId === s.id));
  const calendarDoctors = () => ownDoctors().filter(d => (!calendarSpecialty || d.specialty === calendarSpecialty) && (!calendarService || (calendarService === "unassigned" && !d.isService) || d.id === calendarService || state.doctorServices.some(x => x.doctorId === d.id && x.serviceId === calendarService) || state.appointments.some(a => a.doctorId === d.id && serviceKey(a) === calendarService)));
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
    `<div class="empty-state"><span class="empty-icon" aria-hidden="true">◷</span><h3>${escape(title)}</h3><p>${escape(text)}</p></div>`;
  const wall = (instant) => {
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: state.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const p = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  };
  // Some browsers omit Macedonian from their bundled Intl/ICU data and silently
  // fall back to English. Explicit labels keep presentation Macedonian everywhere.
  const monthNames = ["јануари", "февруари", "март", "април", "мај", "јуни", "јули", "август", "септември", "октомври", "ноември", "декември"];
  const shortMonths = ["јан.", "фев.", "мар.", "апр.", "мај", "јун.", "јул.", "авг.", "септ.", "окт.", "ноем.", "дек."];
  const shortDays = ["нед.", "пон.", "вто.", "сре.", "чет.", "пет.", "саб."];
  const formatDate = (date, options = { day: "numeric", month: "short", year: "numeric" }) => {
    const value = new Date(date.slice(0, 10) + "T12:00:00Z");
    const day = value.getUTCDate(), month = value.getUTCMonth(), year = value.getUTCFullYear();
    const parts = [];
    if (options.day) parts.push(options.day === "2-digit" ? String(day).padStart(2, "0") : String(day));
    if (options.month) parts.push(options.month === "long" ? monthNames[month] : options.month === "short" ? shortMonths[month] : String(month + 1).padStart(options.month === "2-digit" ? 2 : 1, "0"));
    if (options.year) parts.push(String(year));
    const numeric = ["numeric", "2-digit"].includes(options.month);
    const text = parts.join(numeric ? "." : " ") + (numeric && !options.year ? "." : "");
    const weekday = options.weekday === "long" ? dayLabels[value.getUTCDay()].toLowerCase() : shortDays[value.getUTCDay()];
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
    eyebrow = "ВАШАТА ГРИЖА, НА ЕДНО МЕСТО",
  ) =>
    `<div class="page-heading"><div><span class="eyebrow">${escape(eyebrow)}</span><h1>${escape(title)}</h1><p>${escape(subtitle)}</p></div>${action}</div>`;
  const bookButton = (label) =>
    `<button class="btn primary" data-action="book"><span aria-hidden="true">＋</span> ${escape(label || "Нов термин")}</button>`;
  const doctorOptions = (selected = "", all = false, bookable = false) =>
    `${all ? '<option value="">Сите лекари</option>' : ""}${ownDoctors().filter(d => !bookable || d.enabled !== false || d.id === selected)
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
      headers:
        data === undefined
          ? {}
          : {
              "Content-Type": "application/json",
              "X-CSRF-TOKEN": $("#csrf input").value,
            },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (response.status === 401) {
      location.href = "/Account/Login";
      throw new Error("Вашата сесија заврши. Најавете се повторно.");
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(
        "Серверот не можеше да го изврши барањето. Обидете се повторно.",
      );
    }
    if (!response.ok)
      throw new Error(result.error || "Проверете го формуларот и обидете се повторно.");
    return result;
  }
  async function load(render = true) {
    state = await api("bootstrap");
    state.specialties ||= []; state.services ||= []; state.doctorServices ||= [];
    if (isDoctor()) doctorFilter = state.actor.doctorId;
    if (render) renderPage();
  }
  function navigate(next) {
    search = "";
    specialty = "";
    statusFilter = "";
    listService = "";
    location.hash = next;
    if (page === next) renderPage();
  }
  function renderPage() {
    reportRequest++;
    if (calendar) {
      calendar.destroy();
      calendar = null;
    }
    page = location.hash.slice(1) || "overview";
    const allowed = isPatient()
      ? ["overview", "doctors", "appointments"]
      : isDoctor()
        ? ["overview", "calendar", "appointments", "patients", "availability"]
        : [
            "overview",
            "calendar",
            "appointments",
            "patients",
            "availability",
            "doctors",
            "reports",
            "catalogue",
          ];
    if (!allowed.includes(page)) page = "overview";
    $$(".nav-item").forEach((n) => {
      n.classList.toggle("active", n.dataset.page === page);
      n.setAttribute(
        "aria-current",
        n.dataset.page === page ? "page" : "false",
      );
    });
    $("#page-label").textContent = {
      catalogue: "Каталог",
      reports: "Извештаи",
      overview: "Преглед",
      calendar: "Календар",
      doctors: isPatient() ? "Пронајди лекар" : "Список на лекари",
      appointments: "Термини",
      patients: "Пациенти",
      availability: "Достапност",
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
      availability: renderAvailability,
    })[page]();
  }
  function appointmentRow(a) {
    const d = doctor(a.doctorId),
      p = patient(a.patientId);
    const name = isPatient() ? d.name : p?.name || "Пациент";
    return `<button class="appointment-row" data-detail="${a.id}">${avatar(name, Number(d.id.slice(1)))}<span class="row-info"><strong>${escape(name)}</strong><small>${escape(isPatient() ? d.specialty : d.name)}</small></span><span class="row-time">${timeOf(a.start)}<small>${formatDate(dayOf(a.start), { day: "numeric", month: "short" })}</small></span>${badge(a.status)}<span class="muted" aria-hidden="true">↗</span></button>`;
  }
  function renderOverview() {
    const future = state.appointments.filter(upcoming);
    const today = state.appointments.filter(
      (a) => dayOf(a.start) === state.today && a.status !== "Cancelled",
    );
    const pending = state.appointments.filter((a) => a.status === "Scheduled");
    const firstName = state.actor.name.split(" ")[0];
    const stats = isPatient()
      ? [
          [
            "Претстојни прегледи",
            future.length,
            "Добро планирање за поголем спокој",
            "◷",
          ],
          [
            "Лекари и услуги",
            state.doctors.length,
            "Грижа од различни специјалности",
            "✚",
          ],
          [
            "Чека потврда",
            pending.length,
            "Терминот е резервиран и чека потврда",
            "◌",
          ],
          [
            "Претходни прегледи",
            state.appointments.filter((a) =>
              ["Completed", "NoShow"].includes(a.status),
            ).length,
            "Историја на вашите термини",
            "↗",
          ],
        ]
      : [
          [
            "Денешни термини",
            today.length,
            "Вашиот ден, добро организиран",
            "◷",
          ],
          [
            "Претстојни прегледи",
            future.length,
            "Следните закажани прегледи",
            "▤",
          ],
          [
            "Чека потврда",
            pending.length,
            "Подготвено за ваша проверка",
            "◌",
          ],
          [
            isDoctor() ? "Неделно работно време" : "Лекари и услуги",
            isDoctor()
              ? Math.round(
                  doctor(state.actor.doctorId).workingPeriods.reduce(
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
              ? "Според вашиот работен распоред"
              : "Заеднички список на лекари",
            "✚",
          ],
        ];
    const week = monday(state.today);
    const counts = Array.from(
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
        `Здраво, ${firstName}.`,
        `${formatDate(state.today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · Да направиме простор за убав ден.`,
        bookButton(isPatient() ? "Закажи преглед" : "Нов термин"),
      ) +
      (isPatient()
        ? `<section class="hero-banner"><div><span class="eyebrow">ДОБРОТО ЗДРАВЈЕ ЗАПОЧНУВА ТУКА</span><h2>Одвојте време за себе.<br /><em>Чекор кон подобро здравје.</em></h2><p>Пронајдете го соодветниот специјалист и термин што ви одговара. Сите детали ќе бидат на едно место.</p><button class="btn primary" data-nav="doctors">Пронајдете го вашиот лекар <span aria-hidden="true">↗</span></button></div><div class="hero-visual" aria-hidden="true"><span class="hero-plus">✚</span><span class="hero-tag">Вашето здравје. Вашето темпо.</span></div></section>`
        : "") +
      `<section class="stats-grid" aria-label="Преглед на термините">${stats.map(([label, value, note, symbol]) => `<div class="stat-card"><span class="stat-label">${label}</span><span class="stat-symbol" aria-hidden="true">${symbol}</span><strong class="stat-value">${value}</strong><div class="stat-note">${note}</div></div>`).join("")}</section>
        <div class="overview-grid"><section class="card"><div class="card-head"><h3>${isPatient() ? "Вашите следни термини" : "Следни термини"}</h3><button class="section-link" data-nav="appointments">Прикажи ги сите ↗</button></div>${future.length ? future.slice(0, 6).map(appointmentRow).join("") : empty("Време за одмор", "Немате претстојни термини. Изберете лекар за следниот преглед.")}</section><div><section class="card"><div class="card-head"><h3>Преглед на неделата</h3><span class="muted" style="font-size:10px">${formatDate(week, { day: "numeric", month: "short" })}</span></div><div class="card-body"><div class="week-chart" aria-label="Број на термини по денови">${counts.map((n, i) => `<div class="chart-col ${addDays(week, i) === state.today ? "current" : ""}"><span class="chart-count">${n}</span><div class="chart-bar" style="height:${Math.max(3, (n / max) * 105)}px"></div><small>${["пон.", "вто.", "сре.", "чет.", "пет.", "саб.", "нед."][i]}</small></div>`).join("")}</div><div class="week-chart-caption">${counts.reduce((a, b) => a + b, 0)} термини · од понеделник до недела</div></div></section><section class="card" style="margin-top:20px"><div class="card-head"><h3>Брз пристап</h3></div><div class="quick-list"><button data-nav="${isPatient() ? "doctors" : "calendar"}"><span>${isPatient() ? "Разгледајте ги можностите за преглед" : "Отворете го календарот"}<small>${isPatient() ? "Пронајдете специјалист за следниот преглед" : "Јасен преглед на секој ден"}</small></span>↗</button><button data-nav="${isPatient() ? "appointments" : "availability"}"><span>${isPatient() ? "Управувајте со вашите термини" : "Работно време и отсуства"}<small>${isPatient() ? "Презакажете или откажете претстоен преглед" : "Ажурирајте ја вашата достапност"}</small></span>↗</button></div></section></div></div>`;
  }
  function filteredDoctors() {
    return ownDoctors().filter(
      (d) =>
        (!isPatient() || d.enabled !== false) &&
        (!specialty || d.specialty === specialty) &&
        (!search ||
          `${d.name} ${d.specialty}`
            .toLocaleLowerCase()
            .includes(search.toLocaleLowerCase())),
    );
  }
  function renderDoctors() {
    app.innerHTML =
      heading(
        isPatient() ? "Соодветна грижа за вас." : "Вашиот список на лекари.",
        "Разгледајте ги специјалистите и нивните работни распореди.",
        "",
        isPatient() ? "ПРОНАЈДЕТЕ ГО ВАШИОТ ЛЕКАР" : "ЛУЃЕТО ШТО СЕ ГРИЖАТ ЗА ВАС",
      ) +
      `<div class="toolbar"><div class="search-field"><label class="visually-hidden" for="doctor-search">Пребарај лекари</label><input id="doctor-search" placeholder="Пребарајте по име или специјалност" value="${escape(search)}" /></div><label class="visually-hidden" for="specialty">Специјалност</label><select id="specialty"><option value="">Сите специјалности</option>${[
        ...new Set(ownDoctors().map((d) => d.specialty)),
      ]
        .sort()
        .map(
          (s) =>
            `<option ${s === specialty ? "selected" : ""}>${escape(s)}</option>`,
        )
        .join("")}</select></div><div id="doctor-results"></div>`;
    $("#doctor-search").addEventListener("input", (e) => {
      search = e.target.value;
      doctorResults();
    });
    $("#specialty").addEventListener("change", (e) => {
      specialty = e.target.value;
      doctorResults();
    });
    doctorResults();
  }
  function doctorResults() {
    const list = filteredDoctors();
    $("#doctor-results").innerHTML =
      `<p class="results-count">${list.length} лекари и услуги · Временска зона: ${escape(state.timeZone)}</p><div class="doctor-grid">${list.map((d, i) => `<article class="card doctor-card"><div class="doctor-card-top">${avatar(d.name, i)}<span class="badge">${d.staffOnly ? "Закажување преку рецепција" : d.workingPeriods.length ? "Утврдено работно време" : "По договор"}</span></div><h3>${escape(d.name)}</h3><div class="specialty">${escape(d.specialty)}</div><div class="doctor-card-meta"><span>◷ ${d.durationMinutes} мин.</span><span>${d.funding === "Не е наведено" ? "Не е наведен начин на финансирање" : escape(d.funding)}</span></div><div class="doctor-card-actions"><button class="btn secondary" data-profile="${d.id}">Види профил</button><button class="btn primary" data-book="${d.id}">${d.staffOnly && isPatient() ? "Информации за закажување" : "Пронајди термин"} ↗</button></div></article>`).join("")}</div>${list.length ? "" : empty("Не се пронајдени лекари", "Обидете се со друго име или специјалност.")}`;
  }
  function scheduleList(d) {
    return d.workingPeriods.length
      ? `<ul class="schedule-summary">${[1, 2, 3, 4, 5, 6, 0]
          .map((i) => {
            const periods = d.workingPeriods.filter((p) => p.day === days[i]);
            return `<li><span>${dayLabels[i]}</span><strong>${periods.length ? periods.map((p) => p.start.slice(0, 5) + " – " + p.end.slice(0, 5)).join(", ") : "—"}</strong></li>`;
          })
          .join("")}</ul>`
      : `<div class="inline-note warning">Не е наведено точно работно време. Рецепцијата или лекарот треба да договорат термин и да додадат период на достапност.</div>`;
  }
  function openDialog(title, content, eyebrow = "CARELINE") {
    lastFocus = document.activeElement;
    $("#dialog-title").textContent = title;
    $("#dialog-eyebrow").textContent = eyebrow;
    $("#dialog-content").innerHTML = content;
    if (!dialog.open) dialog.showModal();
  }
  function closeDialog() {
    dialog.close();
    booking = null;
    slotRequest++;
    lastFocus?.focus();
  }
  function profile(id) {
    const d = doctor(id);
    openDialog(
      "Запознајте го вашиот лекар",
      `<div class="profile-header">${avatar(d.name, Number(id.slice(1)), "lg")}<div><h3>${escape(d.name)}</h3><p>${escape(d.specialty)}</p></div></div><div class="form-row"><div><label>Времетраење на прегледот</label><p>${d.durationMinutes} минути <small class="muted">· прилагодливо времетраење</small></p></div><div><label>Начин на закажување</label><p style="font-size:12px">${escape(d.bookingMethod)}</p></div></div>${d.subspecialty ? `<p class="inline-note">Субспецијалност: ${escape(d.subspecialty)}</p>` : ""}<h3>Услуги и прегледи</h3>${servicesFor(d.id).length ? `<ul class="schedule-summary">${servicesFor(d.id).map(x => `<li><span>${escape(x.name)}</span><strong>${x.durationMinutes} мин.</strong></li>`).join("")}</ul>` : '<p class="inline-note">Засега нема заведени активни услуги за овој профил.</p>'}<h3>Работен распоред</h3>${scheduleList(d)}<div class="source-notes">${d.demoScheduleEdited ? "<p>Работното време е променето по првичниот увоз.</p>" : ""}${d.sourceSchedules.map((s) => `<p>${escape(s.days)} ${s.start ? escape(s.start + "–" + s.end) : "· Не е наведено работно време"}${s.note ? " · " + escape(s.note) : ""}</p>`).join("")}<p>Локација: не е наведена. ${d.isService ? "Ова е услуга без наведен лекар." : ""}</p></div><div class="dialog-actions">${d.enabled === false ? '<span class="inline-note">Лекарот е неактивен за нови закажувања.</span>' : `<button class="btn primary" data-book="${d.id}">Пронајди термин ↗</button>`}</div>`,
      "ПРОФИЛ НА ЛЕКАР",
    );
  }
  function renderAppointments() {
    app.innerHTML =
      heading(
        isPatient() ? "Вашите термини." : "Сите прегледи на едно место.",
        "Следете ги претстојните и претходните прегледи.",
        bookButton(),
      ) +
      `<div class="chip-tabs" role="group" aria-label="Период на термините">${["upcoming", "previous", "all"].map((t) => `<button data-list-tab="${t}" class="${listTab === t ? "active" : ""}" aria-pressed="${listTab === t}">${({ upcoming: "Претстојни", previous: "Претходни", all: "Сите" })[t]}</button>`).join("")}</div><div class="toolbar"><div class="search-field"><label class="visually-hidden" for="appointment-search">Пребарај термини</label><input id="appointment-search" placeholder="Пребарајте ${isPatient() ? "лекари" : "пациенти или лекари"}…" value="${escape(search)}"></div>${isAdmin() ? `<label class="visually-hidden" for="list-doctor">Филтрирај по лекар</label><select id="list-doctor">${doctorOptions(doctorFilter, true)}</select>` : ""}<label class="visually-hidden" for="status-filter">Статус на терминот</label><select id="status-filter"><option value="">Сите статуси</option>${statuses.map((s) => `<option value="${s}" ${statusFilter === s ? "selected" : ""}>${statusLabel(s)}</option>`).join("")}</select></div><div class="toolbar"><label for="list-service">Услуга</label><select id="list-service">${serviceOptions(listService)}</select></div><div id="appointment-results"></div>`;
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
    appointmentResults();
  }
  function appointmentResults() {
    const list = state.appointments
      .filter(
        (a) =>
          (listTab === "all" ||
            (listTab === "upcoming" ? upcoming(a) : !upcoming(a))) &&
          (!doctorFilter || a.doctorId === doctorFilter) &&
          (!listService || serviceKey(a) === listService) &&
          (!statusFilter || a.status === statusFilter) &&
          (!search ||
            `${doctor(a.doctorId)?.name} ${patient(a.patientId)?.name}`
              .toLocaleLowerCase()
              .includes(search.toLocaleLowerCase())),
      )
      .sort((a, b) =>
        listTab === "previous"
          ? new Date(b.start) - new Date(a.start)
          : new Date(a.start) - new Date(b.start),
      );
    $("#appointment-results").innerHTML =
      `<p class="results-count">${list.length} термини · ${escape(state.timeZone)}</p><section class="card table-wrap">${
        list.length
          ? `<table><thead><tr><th>${isPatient() ? "Лекар" : "Пациент"}</th>${isPatient() ? "" : "<th>Лекар</th>"}<th>Датум и време</th><th>Статус</th><th><span class="visually-hidden">Постапки</span></th></tr></thead><tbody>${list
              .map((a) => {
                const d = doctor(a.doctorId),
                  p = patient(a.patientId),
                  name = isPatient() ? d.name : p?.name || "Пациент";
                return `<tr><td><div class="table-person">${avatar(name, Number(d.id.slice(1)))}<span><strong>${escape(name)}</strong><small>${escape(isPatient() ? d.specialty : p?.isDemonstration ? "Измислен демо-пациент" : "Пациент")}</small></span></div></td>${isPatient() ? "" : `<td>${escape(d.name)}</td>`}<td class="table-date"><strong>${formatDate(dayOf(a.start))}</strong><small>${timeOf(a.start)} – ${timeOf(a.end)}</small></td><td>${badge(a.status)}</td><td><button class="table-action" data-detail="${a.id}">Детали ↗</button></td></tr>`;
              })
              .join("")}</tbody></table>`
          : empty(
              "Засега нема термини",
              "Обидете се со друг филтер или закажете нов термин.",
            )
      }</section>`;
  }
  function details(id) {
    const a = state.appointments.find((a) => a.id === id);
    if (!a) {
      toast("Овој термин повеќе не е достапен.", true);
      return;
    }
    const d = doctor(a.doctorId),
      p = patient(a.patientId);
    const future = upcoming(a);
    const complete =
      !isPatient() && a.status === "Confirmed" && new Date(a.end) <= new Date();
    openDialog(
      "Детали за терминот",
      `<div class="booking-context">${avatar(d.name, Number(d.id.slice(1)))}<div><strong>${escape(d.name)}</strong><small>${escape(d.specialty)}</small></div></div>${badge(a.status)}<dl class="detail-list"><div><dt>Пациент</dt><dd>${escape(p?.name || "Пациент")}</dd></div><div><dt>Датум</dt><dd>${formatDate(dayOf(a.start), { weekday: "short", day: "numeric", month: "long", year: "numeric" })}</dd></div><div><dt>Време</dt><dd>${timeOf(a.start)} – ${timeOf(a.end)}</dd></div><div><dt>Временска зона</dt><dd>${escape(state.timeZone)}</dd></div><div><dt>Услуга</dt><dd>${escape(a.serviceName || "Без заведена услуга")}</dd></div><div><dt>Број на резервација</dt><dd>CL-${a.id.slice(0, 8).toUpperCase()}</dd></div><div><dt>Времетраење</dt><dd>${Math.round((new Date(a.end) - new Date(a.start)) / 60000)} минути</dd></div></dl>${a.status === "Scheduled" ? `<div class="inline-note warning">Терминот е резервиран и чека потврда од персоналот. Не е испратено известување.</div>` : ""}<div id="detail-error"></div><div class="dialog-actions">${future ? `<button class="btn danger" data-status="Cancelled" data-id="${id}">Откажи преглед</button>${!isPatient() || !d.staffOnly ? `<button class="btn secondary" data-move="${id}">Презакажи</button>` : ""}` : ""}${!isPatient() && future && a.status === "Scheduled" ? `<button class="btn primary" data-status="Confirmed" data-id="${id}">Потврди преглед</button>` : ""}${complete ? `<button class="btn secondary" data-status="NoShow" data-id="${id}">Означи недоаѓање</button><button class="btn primary" data-status="Completed" data-id="${id}">Заврши преглед</button>` : ""}${!future && !complete ? '<button class="btn secondary" data-action="close">Затвори</button>' : ""}</div>`,
      "ТЕРМИН · CL-" + a.id.slice(0, 8).toUpperCase(),
    );
  }
  async function confirmAction(message, label = "Потврди") {
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
          ? "Дали сакате да го откажете прегледот и да го ослободите терминот?"
          : `Промени го статусот на овој термин во “${statusLabel(status)}”?`,
        status === "Cancelled" ? "Откажи термин" : "Ажурирај статус",
      ))
    )
      return;
    button.disabled = true;
    try {
      await api(`appointments/${id}/status`, { status, version: a.version });
      await load(false);
      details(id);
      renderPage();
      toast(
        status === "Cancelled"
          ? "Прегледот е откажан. Терминот е повторно достапен."
          : "Терминот е ажуриран.",
      );
    } catch (e) {
      $("#detail-error").innerHTML =
        `<div class="inline-error" role="alert">${escape(e.message)}</div>`;
      button.disabled = false;
    }
  }
  async function openBooking(doctorId, date, time, moveId, patientId) {
    const a = moveId ? state.appointments.find((a) => a.id === moveId) : null;
    const selected =
      doctorId ||
      a?.doctorId ||
      (isDoctor() ? state.actor.doctorId : doctorFilter) ||
      ownDoctors().find(
        (d) => d.enabled !== false && d.workingPeriods.length && (!isPatient() || !d.staffOnly),
      )?.id ||
      ownDoctors()[0].id;
    if (!selected || !doctor(selected)?.enabled) { toast("Изберете активен лекар.", true); return; }
    if (isPatient() && doctor(selected).staffOnly) {
      profile(selected);
      $("#dialog-content").insertAdjacentHTML(
        "afterbegin",
        '<div class="inline-note warning">Според изворниот распоред, закажувањето е преку рецепција. Контактирајте ја рецепцијата за овој преглед. Не е испратена порака.</div>',
      );
      return;
    }
    booking = {
      doctorId: selected,
      serviceId: a?.serviceId || (!moveId && (servicesFor(selected).find(s => s.id === calendarService)?.id || servicesFor(selected)[0]?.id)) || "",
      date: date || state.today,
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
  function bookingForm() {
    const b = booking,
      d = doctor(b.doctorId);
    openDialog(
      b.moveId ? "Пронајди нов термин" : "Одвојте време за вашето здравје",
      `<div class="steps"><span class="step active">01 · Лекар и термин</span><span class="step">02 · Проверка</span><span class="step">03 · Закажано</span></div><div class="field"><label for="booking-doctor">Вашиот лекар</label><select id="booking-doctor" ${b.moveId || isDoctor() ? "disabled" : ""}>${doctorOptions(b.doctorId, false, true)}</select></div>${b.moveId ? `<div class="inline-note">Услуга: ${escape(state.appointments.find(a => a.id === b.moveId)?.serviceName || "Без заведена услуга")}</div>` : `<div class="field"><label for="booking-service">Услуга / преглед</label><select id="booking-service">${servicesFor(d.id).length ? servicesFor(d.id).map(x => `<option value="${x.id}" ${x.id === b.serviceId ? "selected" : ""}>${escape(x.name)} · ${x.durationMinutes} мин.</option>`).join("") : '<option value="">Нема заведена достапна услуга</option>'}</select></div>`}${d.requiresConfirmation ? `<div class="inline-note warning">${escape(d.bookingMethod)} · Потребна е потврда од персоналот.</div>` : ""}${d.tuesdayFirst ? '<div class="inline-note">Прво се пополнува вторник. Среда се отвора кога претстојните термини во вторник од истата недела се пополнети.</div>' : ""}<div class="form-row" style="margin-top:17px"><div class="field"><label for="booking-date">Изберете датум</label><input type="date" id="booking-date" value="${b.date}" min="${state.today}" max="${addDays(state.today, 180)}" required></div><div class="field"><label>Времетраење на прегледот</label><div class="inline-note">${bookingDuration(b)} минути · ${escape(state.timeZone)}</div></div></div>${!isPatient() ? `<div class="field"><label for="booking-patient-search">Пронајди пациент</label><input id="booking-patient-search" placeholder="Пребарајте пациент по име…" ${b.moveId ? "disabled" : ""}></div><div class="field"><label for="booking-patient">Пациент</label><select id="booking-patient" ${b.moveId ? "disabled" : ""}><option value="">Изберете пациент</option>${state.patients.map((p) => `<option value="${p.id}" ${p.id === b.patientId ? "selected" : ""}>${escape(p.name)}</option>`).join("")}</select>${b.moveId ? "" : '<button class="link-button" style="font-size:11px;margin-top:8px" id="new-patient-from-booking">＋ Додај пациент</button>'}</div>` : ""}<div class="slots-label"><strong>Слободни термини</strong><span id="slot-count"></span></div><div id="booking-slots" aria-live="polite"></div><div id="booking-error"></div><div class="dialog-actions"><button class="btn secondary" data-action="close">Назад</button><button class="btn primary" id="review-booking">Провери го терминот ↗</button></div>`,
      "ЗАКАЖЕТЕ ТЕРМИН",
    );
    $("#booking-doctor").addEventListener("change", async (e) => {
      b.doctorId = e.target.value;
      b.serviceId = servicesFor(b.doctorId)[0]?.id || "";
      b.time = "";
      bookingForm();
      await loadSlots();
    });
    $("#booking-service")?.addEventListener("change", async e => { b.serviceId = e.target.value; b.time = ""; bookingForm(); await loadSlots(); });
    $("#booking-date").addEventListener("change", async (e) => {
      b.date = e.target.value;
      b.time = "";
      await loadSlots();
    });
    $("#booking-patient")?.addEventListener(
      "change",
      (e) => (b.patientId = e.target.value),
    );
    $("#booking-patient-search")?.addEventListener("input", (e) => {
      const query = e.target.value.toLowerCase();
      const sel = $("#booking-patient");
      sel.innerHTML =
        '<option value="">Изберете пациент</option>' +
        state.patients
          .filter((p) => p.name.toLowerCase().includes(query))
          .map(
            (p) =>
              `<option value="${p.id}" ${p.id === b.patientId ? "selected" : ""}>${escape(p.name)}</option>`,
          )
          .join("");
      b.patientId = sel.value;
    });
    $("#new-patient-from-booking")?.addEventListener("click", () =>
      addPatientForm({ ...b }),
    );
    $("#review-booking").addEventListener("click", reviewBooking);
  }
  async function loadSlots() {
    const request = ++slotRequest,
      b = booking;
    const container = $("#booking-slots");
    if (!container || !b) return;
    container.innerHTML =
      '<div class="loading-state" style="padding:25px"><span class="spinner"></span> Се проверуваат слободните термини…</div>';
    $("#review-booking").disabled = true;
    try {
      if (!b.date) throw new Error("Изберете датум за приказ на слободните термини.");
      const slots = await api(
        `slots?doctorId=${encodeURIComponent(b.doctorId)}&serviceId=${encodeURIComponent(b.serviceId || "")}&date=${b.date}${b.moveId ? "&excludeId=" + b.moveId : ""}`,
      );
      if (request !== slotRequest || booking !== b) return;
      b.slots = slots;
      $("#slot-count").textContent = `${slots.length} слободни`;
      if (!slots.some((s) => s.time.slice(0, 5) === b.time)) b.time = "";
      container.innerHTML = slots.length
        ? `<div class="slots">${slots.map((s) => `<button class="slot ${s.time.slice(0, 5) === b.time ? "selected" : ""}" aria-pressed="${s.time.slice(0, 5) === b.time}" data-time="${s.time.slice(0, 5)}">${s.time.slice(0, 5)}</button>`).join("")}</div>`
        : empty(
            "Нема слободни термини на овој датум",
            "Изберете друг ден. Достапноста ги зема предвид работното време, закажаните прегледи и отсуствата.",
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
      if (request === slotRequest)
        container.innerHTML = `<div class="inline-error" role="alert">${escape(e.message)}</div><button class="btn secondary small" id="retry-slots">Обиди се повторно</button>`;
      $("#retry-slots")?.addEventListener("click", loadSlots);
    }
  }
  function reviewBooking() {
    const b = booking,
      d = doctor(b.doctorId);
    if (!b.time || !b.patientId) {
      $("#booking-error").innerHTML =
        '<div class="inline-error" role="alert">Изберете слободен термин и пациент пред да продолжите.</div>';
      return;
    }
    openDialog(
      "Последна проверка.",
      `<div class="steps"><span class="step">01 · Лекар и термин</span><span class="step active">02 · Проверка</span><span class="step">03 · Закажано</span></div><div class="booking-context">${avatar(d.name)}<div><strong>${escape(d.name)}</strong><small>${escape(d.specialty)}</small></div></div><dl class="detail-list"><div><dt>Пациент</dt><dd>${escape(patient(b.patientId)?.name)}</dd></div><div><dt>Датум</dt><dd>${formatDate(b.date, { weekday: "short", day: "numeric", month: "long" })}</dd></div><div><dt>Услуга</dt><dd>${escape(b.moveId ? state.appointments.find(a => a.id === b.moveId)?.serviceName || "Без заведена услуга" : state.services.find(x => x.id === b.serviceId)?.name || "Без заведена услуга")}</dd></div><div><dt>Време</dt><dd>${b.time} · ${bookingDuration(b)} минути</dd></div><div><dt>Временска зона</dt><dd>${escape(state.timeZone)}</dd></div></dl><div class="inline-note ${d.requiresConfirmation ? "warning" : ""}">${d.requiresConfirmation ? "Избраниот термин ќе биде резервиран до потврда од персоналот." : "Вашиот термин ќе биде веднаш потврден."} Не се испраќа е-пошта или SMS.</div><div id="booking-error"></div><div class="dialog-actions"><button class="btn secondary" id="booking-back">Назад</button><button class="btn primary" id="submit-booking">${b.moveId ? "Потврди нов термин" : "Потврди термин"} ✓</button></div>`,
      "ПРОВЕРЕТЕ ГО ВАШИОТ ПРЕГЛЕД",
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
            },
      );
      await load(false);
      renderPage();
      booking = null;
      openDialog(
        a.status === "Scheduled" ? "Вашиот термин е резервиран." : "Сè е подготвено.",
        `<div class="success-view"><div class="success-mark">✓</div><h3>${a.status === "Scheduled" ? "Чека потврда" : "Терминот е потврден"}</h3><p>${escape(doctor(a.doctorId).name)}<br>${formatDate(dayOf(a.start), { weekday: "long", day: "numeric", month: "long" })} во <strong>${timeOf(a.start)}</strong><br>${escape(state.timeZone)}</p>${badge(a.status)}<p style="margin-top:18px">Број на резервација <strong>CL-${a.id.slice(0, 8).toUpperCase()}</strong><br>Не е испратена е-пошта или SMS.</p></div><div class="dialog-actions"><button class="btn secondary" data-action="close">Готово</button><button class="btn primary" data-detail="${a.id}">Види термин ↗</button></div>`,
        "ПОВЕЌЕ СПОКОЈ ВО СЕКОЈДНЕВИЕТО",
      );
      toast(
        b.moveId
          ? "Терминот е презакажан."
          : "Терминот е зачуван и видлив во сите соодветни работни простори.",
      );
    } catch (e) {
      $("#booking-error").innerHTML =
        `<div class="inline-error" role="alert">${escape(e.message)}</div>`;
      button.disabled = false;
      $("#booking-back").disabled = false;
    }
  }
  function renderCalendar() {
    if (isDoctor()) { calendarSpecialty = ""; calendarService = ""; doctorFilter = state.actor.doctorId; }
    const matchingDoctors = calendarDoctors();
    if (doctorFilter && !matchingDoctors.some(d => d.id === doctorFilter)) doctorFilter = "";
    calendarRange ||= { from: state.today, to: addDays(state.today, 6) };
    const calendarDoctorOptions = `<option value="">Сите соодветни лекари / услуги</option>${matchingDoctors.map(d => `<option value="${d.id}" ${d.id === doctorFilter ? "selected" : ""}>${escape(d.name)}</option>`).join("")}`;
    // Replacing the selected provider also replaces the calendar's listeners.
    if (calendar) {
      calendar.destroy();
      calendar = null;
    }
    app.innerHTML =
      heading(
        isDoctor()
          ? "Вашиот ден, добро испланиран."
          : "Јасен преглед на секој ден.",
        "Кликнете на слободно време за закажување. Отворете преглед за да ги видите деталите.",
        bookButton(),
        "ВАШИОТ РАСПОРЕД",
      ) +
      `<section class="card workspace-filters"><div class="card-head"><div><h3>Филтри на календарот</h3><p class="filter-description">Изберете лекар и прегледајте ги термините што ви се потребни.</p></div><button class="btn secondary small" id="refresh-calendar">↻ Освежи</button></div><div class="card-body"><div class="calendar-filter-grid">${isAdmin() ? `<label>Лекар<select id="calendar-doctor">${calendarDoctorOptions}</select></label><label>Специјалност<select id="calendar-specialty">${specialtyOptions(calendarSpecialty)}</select></label><label>Услуга<select id="calendar-service">${serviceOptions(calendarService)}</select></label>` : `<div class="filter-provider"><span>Вашиот календар</span><strong>${escape(doctor(doctorFilter).name)}</strong></div>`}<label>Статус<select id="calendar-status"><option value="">Сите статуси</option>${statuses.map((s) => `<option value="${s}" ${s === statusFilter ? "selected" : ""}>${statusLabel(s)}</option>`).join("")}</select></label></div><form id="calendar-range-form" class="calendar-range"><label>Од<input type="date" id="calendar-from" value="${calendarRange.from}" required></label><label>До<input type="date" id="calendar-to" value="${calendarRange.to}" required></label><button class="btn secondary small" type="submit">Прикажи период</button><span class="filter-hint">До 31 ден · ${matchingDoctors.length} профили</span><span id="calendar-range-error" role="alert"></span></form></div></section><div class="calendar-layout"><section class="card calendar-panel ${calendarView === "timeGridRange" ? "custom-range" : ""}" style="--range-width:${Math.max(1, (new Date(calendarRange.to) - new Date(calendarRange.from)) / 86400000 + 1) * 110}px"><div class="calendar-top"><div class="calendar-nav"><button class="icon-button" id="calendar-prev" aria-label="Претходен период">‹</button><button class="icon-button" id="calendar-next" aria-label="Следен период">›</button><h2 id="calendar-title"></h2><button class="btn secondary small" id="calendar-today">Денес</button></div><div class="calendar-views" role="group" aria-label="Приказ на календарот">${[
        ["timeGridDay", "Ден"],
        ["timeGridWeek", "Недела"],
        ["dayGridMonth", "Месец"],
        ["timeGridRange", "Период"],
      ]
        .map(
          ([v, l]) =>
            `<button data-calendar-view="${v}" class="${calendarView === v ? "active" : ""}">${l}</button>`,
        )
        .join(
          "",
        )}</div></div><div id="calendar-loading" class="calendar-load" aria-live="polite"></div><div class="calendar-scroll"><div id="calendar"></div></div><div class="calendar-legend"><span><i style="background:#dcebd0"></i>Достапно</span><span><i style="background:#6d9776"></i>Потврден</span><span><i style="background:#cba05b"></i>Чека потврда</span><span><i style="background:#cdb5a9"></i>Недостапно</span></div><p class="mobile-calendar-note">Користете дневен приказ за повеќе простор. Секој термин е достапен и преку тастатура во списокот со термини.</p></section><details class="card calendar-context"><summary><span class="schedule-icon" aria-hidden="true">◷</span><span><strong>Работно време и информации за избраниот лекар</strong><small>Неделен распоред и управување со достапноста</small></span><span class="disclosure-chevron" aria-hidden="true">⌄</span></summary><aside class="calendar-aside" id="calendar-aside"></aside></details></div>`;
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
        $("#calendar-range-error").textContent = "Изберете период од 1 до 31 ден."; return;
      }
      calendarRange = { from, to }; calendarView = "timeGridRange"; calendarDate = from; renderCalendar();
    };
    $("#calendar-status").addEventListener("change", (e) => {
      statusFilter = e.target.value;
      calendar.refetchEvents();
    });
    const selected = doctor(doctorFilter);
    $("#calendar-aside").innerHTML = selected
      ? `<section class="card"><div class="card-head"><h3>Избраниот лекар</h3></div><div class="card-body">${avatar(selected.name, Number(selected.id.slice(1)))}<h4>${escape(selected.name)}</h4><p>${escape(selected.specialty)}</p><div class="divider"></div><label>Неделно работно време</label>${scheduleList(selected)}<button class="btn secondary small wide" data-nav="availability">Управувај со достапноста ↗</button></div></section>`
      : `<section class="card"><div class="card-head"><h3>Заеднички календар</h3></div><div class="card-body"><p>Прегледајте ги термините на сите лекари или изберете еден лекар за неговите слободни термини и работен распоред.</p><button class="btn primary small wide" data-action="book">＋ Нов термин</button></div></section>`;
    if (!window.FullCalendar) {
      $("#calendar").innerHTML = empty(
        "Календарот не можеше да се вчита",
        "Освежете ја страницата. Може да закажувате и да управувате со прегледите во делот Термини.",
      );
      return;
    }
    calendar = new FullCalendar.Calendar($("#calendar"), {
      locale: {
        code: "mk",
        week: { dow: 1, doy: 7 },
        buttonText: { prev: "Претходно", next: "Следно", today: "Денес", year: "Година", month: "Месец", week: "Недела", day: "Ден", list: "Список" },
        buttonHints: { prev: "Претходен период", next: "Следен период", today: "Тековен период" },
        weekText: "Сед.",
        weekTextLong: "Недела",
        allDayText: "Цел ден",
        moreLinkText: n => `уште ${n}`,
        moreLinkHint: n => `Прикажи уште ${n} термини`,
        noEventsText: "Нема термини за прикажување",
        closeHint: "Затвори",
        timeHint: "Време",
        eventHint: "Термин",
        navLinkHint: "Отвори го датумот",
        viewHint: "Приказ на календарот"
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
      businessHours: selected
        ? selected.workingPeriods.map((p) => ({
            daysOfWeek: [days.indexOf(p.day)],
            startTime: p.start,
            endTime: p.end,
          }))
        : false,
      editable: true,
      eventDurationEditable: false,
      eventStartEditable: true,
      eventResizableFromStart: false,
      datesSet(info) {
        $("#calendar-title").textContent = info.view.title;
        calendarDate = info.view.currentStart.toISOString().slice(0, 10);
      },
      dateClick(info) {
        if (!matchingDoctors.length) { toast("Нема профили за избраните филтри.", true); return; }
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
        const a = state.appointments.find((a) => a.id === info.event.id);
        const moved = info.event.start.toISOString();
        if (
          !(await confirmAction(
            `Презакажи го овој термин за ${formatDate(moved.slice(0, 10))} во ${moved.slice(11, 16)} (${state.timeZone})?`,
            "Презакажи термин",
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
          toast("Терминот е презакажан.");
        } catch (e) {
          info.revert();
          toast(e.message, true);
        }
      },
      events: async (info, success, failure) => {
        if (page !== "calendar") { success([]); return; }
        $("#calendar-loading").textContent =
          "Се освежуваат закажаните и слободните термини…";
        try {
          let events = state.appointments
            .filter(
              (a) =>
                matchingDoctors.some(d => d.id === a.doctorId) &&
                (!calendarService || serviceKey(a) === calendarService) &&
                (!doctorFilter || a.doctorId === doctorFilter) &&
                (!statusFilter || a.status === statusFilter),
            )
            .map((a) => ({
              id: a.id,
              title: `${patient(a.patientId)?.name || "Пациент"}${!doctorFilter ? " · " + doctor(a.doctorId).name : ""}`,
              start: wall(a.start),
              end: wall(a.end),
              classNames: [a.status],
              editable: upcoming(a),
              extendedProps: { appointmentId: a.id },
            }));
          if (doctorFilter) {
            const exceptions = await api("exceptions?doctorId=" + doctorFilter);
            const start = info.startStr.slice(0, 10),
              end = info.endStr.slice(0, 10);
            const dates = [];
            for (let date = start; date < end; date = addDays(date, 1)) {
              if (date >= state.today && date <= addDays(state.today, 180))
                dates.push(date);
            }
            const lists = await Promise.all(
              dates.map((date) =>
                (doctor(doctorFilter).enabled === false ? Promise.resolve([]) : (state.services.some(s => s.id === calendarService) ? [calendarService] : servicesFor(doctorFilter).map(s => s.id)).length
                  ? Promise.all((state.services.some(s => s.id === calendarService) ? [calendarService] : servicesFor(doctorFilter).map(s => s.id)).map(id => api(`slots?doctorId=${doctorFilter}&date=${date}&serviceId=${id}`))).then(lists => lists.flat())
                  : state.doctorServices.some(x => x.doctorId === doctorFilter) ? Promise.resolve([]) : api(`slots?doctorId=${doctorFilter}&date=${date}`)),
              ),
            );
            events.push(
              ...lists.flat().map((s) => ({
                start: `${s.date}T${s.time}`,
                end: wall(s.end),
                display: "background",
                backgroundColor: "#dbeccb",
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
                  backgroundColor: "#d9b8a8",
                  title: "Недостапно",
                  editable: false,
                })),
            );
          }
          success(events);
          if ($("#calendar-loading"))
            $("#calendar-loading").textContent = doctorFilter
              ? `Ажурирана достапност · ${state.timeZone} · Изберете зелено означено време или кликнете Нов термин.`
              : `${state.timeZone} · Изберете лекар за приказ на слободните термини.`;
        } catch (e) {
          failure(e);
          if ($("#calendar-loading"))
            $("#calendar-loading").textContent =
              "Освежувањето не успеа. Кликнете Освежи за повторен обид.";
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
  let catalogueTab = "doctors", catalogueSearch = "", listService = "";
  function renderCatalogue() {
    const kinds = { doctors: "Лекари", specialties: "Специјалности", services: "Услуги" };
    const items = state[catalogueTab].filter(x => `${x.name} ${x.specialty || ""}`.toLocaleLowerCase().includes(catalogueSearch.toLocaleLowerCase()));
    app.innerHTML = heading("Каталог за подобра организација.", "Лекари, специјалности и услуги поврзани со закажувањето.", '<button class="btn primary" id="catalogue-add">＋ Додај запис</button>', "УПРАВУВАЊЕ СО КАТАЛОГОТ") +
      `<div class="chip-tabs" role="group" aria-label="Каталог">${Object.entries(kinds).map(([key,label]) => `<button data-catalogue-tab="${key}" class="${key === catalogueTab ? "active" : ""}" aria-pressed="${key === catalogueTab}">${label}</button>`).join("")}</div>
      <section class="card workspace-filters"><div class="card-head"><h3>${kinds[catalogueTab]}</h3><span class="muted">${items.length} записи</span></div><div class="card-body"><label for="catalogue-search">Пребарај по име</label><input id="catalogue-search" value="${escape(catalogueSearch)}" placeholder="Пребарај каталог…"></div></section>
      <p class="inline-note">Деактивирањето спречува нови закажувања. Постоечките термини и историјата се задржуваат. Работното време се уредува во Достапност; сметките за најава во Сметки и пристап.</p>
      <section class="card table-wrap"><table><thead><tr><th>Назив</th><th>Информации</th><th>Статус</th><th>Постапки</th></tr></thead><tbody>${items.map(x => `<tr><td><strong>${escape(x.name)}</strong>${x.isService ? '<small class="catalogue-subtext">Увезен услужен профил</small>' : ""}</td><td>${escape(catalogueTab === "doctors" ? x.specialty + (x.subspecialty ? " · " + x.subspecialty : "") : catalogueTab === "services" ? `${state.specialties.find(s => s.id === x.specialtyId)?.name || ""} · ${x.durationMinutes} минути · ${state.doctorServices.filter(a => a.serviceId === x.id).length} профили` : `${state.doctors.filter(d => d.specialtyId === x.id).length} лекари / профили`)}</td><td><span class="badge ${x.enabled === false ? "Cancelled" : "Confirmed"}">${x.enabled === false ? "Неактивен" : "Активен"}</span></td><td><button class="table-action" data-catalogue-edit="${x.id}">Измени ↗</button>${catalogueTab === "doctors" ? `<button class="table-action" data-catalogue-schedule="${x.id}">Работно време ↗</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="4">Нема соодветни записи.</td></tr>'}</tbody></table></section>`;
    $("#catalogue-add").onclick = () => editCatalogue();
    $("#catalogue-search").onchange = e => { catalogueSearch = e.target.value; renderCatalogue(); };
    $$("[data-catalogue-tab]").forEach(b => b.onclick = () => { catalogueTab = b.dataset.catalogueTab; catalogueSearch = ""; renderCatalogue(); });
    $$("[data-catalogue-edit]").forEach(b => b.onclick = () => editCatalogue(b.dataset.catalogueEdit));
    $$("[data-catalogue-schedule]").forEach(b => b.onclick = () => { doctorFilter = b.dataset.catalogueSchedule; navigate("availability"); });
  }
  function editCatalogue(id) {
    const kind = catalogueTab, item = state[kind].find(x => x.id === id);
    const specialties = state.specialties.map(s => `<option value="${s.id}" ${s.id === item?.specialtyId ? "selected" : ""}>${escape(s.name)}</option>`).join("");
    openDialog(item ? "Измени запис" : "Додај во каталогот", `<form id="catalogue-form"><div class="field"><label for="catalogue-name">${kind === "doctors" ? "Име и презиме" : "Назив"}</label><input id="catalogue-name" name="name" required minlength="2" maxlength="200" value="${escape(item?.name || "")}"></div>
      ${kind !== "specialties" ? `<div class="field"><label for="catalogue-specialty">Специјалност</label><select id="catalogue-specialty" name="specialtyId" required><option value="">Изберете специјалност</option>${specialties}</select></div>` : ""}
      ${kind === "doctors" ? `<div class="field"><label for="catalogue-sub">Субспецијалност (незадолжително)</label><input id="catalogue-sub" name="subspecialty" maxlength="200" value="${escape(item?.subspecialty || "")}"></div><p class="inline-note">Нов лекар започнува без работни часови. По зачувување, внесете распоред во Достапност и доделете услуги во каталогот.</p>` : ""}
      ${kind === "services" ? `<div class="field"><label for="catalogue-duration">Траење (минути)</label><input id="catalogue-duration" name="durationMinutes" type="number" required min="10" max="120" step="5" value="${item?.durationMinutes || 30}"></div><fieldset class="catalogue-assignments"><legend>Лекари / профили кои ја извршуваат услугата</legend>${state.doctors.map(d => `<label><input type="checkbox" name="doctorIds" value="${d.id}" ${state.doctorServices.some(x => x.doctorId === d.id && x.serviceId === item?.id) ? "checked" : ""}><span>${escape(d.name)}${d.enabled === false ? " · Неактивен" : ""}<small>${escape(d.specialty)}</small></span></label>`).join("")}</fieldset><p class="inline-note">Промената на траење важи за нови термини. Веќе закажаните го задржуваат своето траење.</p>` : ""}
      ${kind !== "specialties" ? `<label class="catalogue-toggle"><input type="checkbox" name="enabled" ${item?.enabled !== false ? "checked" : ""}> Активен за нови закажувања</label>` : ""}
      <div id="catalogue-error" role="alert"></div><div class="dialog-actions"><button class="btn secondary" type="button" data-action="close">Назад</button><button class="btn primary" type="submit">Зачувај</button></div></form>`, "КАТАЛОГ");
    $("#catalogue-form").onsubmit = async e => {
      e.preventDefault(); const form = e.target, button = form.querySelector('[type="submit"]'); button.disabled = true;
      try {
        const f = new FormData(form), input = { id: item?.id || null, name: f.get("name"), version: item?.catalogVersion || item?.version || 0 };
        if (kind !== "specialties") Object.assign(input, { specialtyId: f.get("specialtyId"), enabled: f.has("enabled") });
        if (kind === "doctors") input.subspecialty = f.get("subspecialty");
        if (kind === "services") Object.assign(input, { durationMinutes: Number(f.get("durationMinutes")), doctorIds: f.getAll("doctorIds") });
        await api("catalogue/" + kind, input); await load(false); closeDialog(); renderCatalogue(); toast("Каталогот е зачуван.");
      } catch (err) { $("#catalogue-error").textContent = err.message; button.disabled = false; }
    };
  }
  function renderReports() {
    if (!isAdmin()) return;
    reportFilters ||= { from: state.today.slice(0, 8) + "01", to: state.today, groupBy: "day", doctorId: "", specialty: "", serviceId: "" };
    const f = reportFilters;
    app.innerHTML = heading("Извештаи и статистика.", "Јасен преглед на термините, исходите и искористеноста.", "", "ПОДАТОЦИ ЗА ПОДОБРО ПЛАНИРАЊЕ") +
      `<section class="card workspace-filters report-controls"><div class="card-head"><div><h3>Филтри на извештајот</h3><p class="filter-description">Изберете период и профили за преглед на резултатите.</p></div></div><form id="report-form" class="card-body"><div class="report-filter-grid"><label>Од<input type="date" name="from" value="${f.from}" required></label><label>До<input type="date" name="to" value="${f.to}" required></label><label>Групирање<select name="groupBy">${[["day","По ден"],["week","По недела"],["month","По месец"]].map(([v,l]) => `<option value="${v}" ${v === f.groupBy ? "selected" : ""}>${l}</option>`).join("")}</select></label><label>Лекар / профил<select name="doctorId">${doctorOptions(f.doctorId, true)}</select></label><label>Специјалност<select name="specialty">${specialtyOptions(f.specialty)}</select></label><label>Услуга<select name="serviceId">${serviceOptions(f.serviceId)}</select></label></div><div class="report-presets"><button type="button" class="btn secondary small" data-report-preset="today">Денес</button><button type="button" class="btn secondary small" data-report-preset="week">Оваа недела</button><button type="button" class="btn secondary small" data-report-preset="month">Овој месец</button><button type="button" class="btn secondary small" id="report-reset">Исчисти филтри</button><button class="btn primary small" type="submit">Прикажи извештај ↗</button></div></form></section><div id="report-results" aria-live="polite"></div>`;
    const form = $("#report-form");
    form.onsubmit = e => { e.preventDefault(); reportFilters = Object.fromEntries(new FormData(form)); loadReport(); };
    $$("[data-report-preset]").forEach(b => b.onclick = () => {
      const type = b.dataset.reportPreset;
      form.elements.from.value = type === "today" ? state.today : type === "week" ? monday(state.today) : state.today.slice(0,8) + "01";
      form.elements.to.value = type === "week" ? addDays(monday(state.today), 6) : type === "month"
        ? new Date(Date.UTC(Number(state.today.slice(0,4)), Number(state.today.slice(5,7)), 0, 12)).toISOString().slice(0,10) : state.today;
      form.requestSubmit();
    });
    $("#report-reset").onclick = () => { for (const key of ["doctorId", "specialty", "serviceId"]) form.elements[key].value = ""; form.requestSubmit(); };
    loadReport();
  }
  async function loadReport() {
    const request = ++reportRequest, target = $("#report-results");
    target.innerHTML = '<div class="loading-state" role="status"><span class="spinner"></span> Се подготвува извештајот…</div>';
    try {
      const data = await api("reports?" + new URLSearchParams(reportFilters));
      if (request !== reportRequest || page !== "reports") return;
      const m = data.summary;
      const percent = value => value == null ? "—" : `${value.toFixed(1)}%`;
      const hours = value => (value / 60).toFixed(1);
      const tiles = [
        ["Вкупно термини",m.total,"Вклучува и откажани"], ["Реализирани",m.completed,"Завршени прегледи"],
        ["Потврдени",m.confirmed,"Тековен статус"], ["Чекаат потврда",m.pending,"Резервирани термини"],
        ["Откажани",m.cancelled,`${percent(m.cancellationPercent)} од сите термини`], ["Не се појавиле",m.noShow,`${percent(m.noShowPercent)} од реализирани + недоаѓања`],
        ["Пациенти во периодот",m.patients,`${data.registeredPatients} регистрирани вкупно`], ["Искористеност ≈",percent(m.utilizationPercent),`${hours(m.occupiedMinutes)} / ${hours(m.capacityMinutes)} часа`]
      ];
      const periodLabel = row => data.query.groupBy === "month" ? formatDate(row.key, { month: "long", year: "numeric" }) : (data.query.groupBy === "week" ? "Недела од " : "") + formatDate(row.key);
      const max = Math.max(1, ...data.periods.map(r => r.metrics.total));
      target.innerHTML = `<p class="results-count">${formatDate(data.query.from)} – ${formatDate(data.query.to)} · ${escape(data.timeZone)} · Пресметано во ${timeOf(data.generatedAt)}</p><div class="stats-grid report-stats">${tiles.map(([label,value,note]) => `<article class="card stat-card"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong><div class="stat-note">${note}</div></article>`).join("")}</div>
        <details class="report-definitions"><summary>Како се пресметуваат показателите</summary><p>Периодот ги опфаќа двата датума според почетокот на прегледот во ${escape(data.timeZone)}. Броевите ги користат тековните статуси. „Вкупно“ ги вклучува сите статуси; процентот на откажување е откажани / вкупно. Процентот на недоаѓање е недоаѓања / (реализирани + недоаѓања). Пациентите во периодот се единствени пациенти, вклучувајќи ги и откажаните термини.</p><p>Искористеноста е приближна: зафатени минути / минути достапни за целосни прегледи, според сегашното работно време и зачуваните исклучоци. Се сметаат сите неоткажани термини, вклучувајќи недоаѓања. Не се чуваат историски верзии на распоредот; правилото „прво вторник“ не го намалува физичкиот капацитет. При нула капацитет се прикажува „—“.</p><p>Услугите се од каталогот; старите услужни профили остануваат посебна група. Старите лекарски термини без услуга се „Без заведена услуга“. Капацитетот по услуга е споделениот капацитет на соодветните лекари и не се собира меѓу услуги. Неделите почнуваат во понеделник. Првиот и последниот збирен период може да бидат делумни.</p></details>
        <p class="inline-note report-caveat">Искористеноста е проценка според сегашниот распоред. ${m.outsideCapacityMinutes ? `${hours(m.outsideCapacityMinutes)} часа неоткажани термини се надвор од пресметаниот капацитет.` : ""} Капацитетот е споделен меѓу услугите; старите термини без услуга остануваат нераспределени.</p>
        ${m.total ? "" : '<div class="inline-note">Нема термини за избраните филтри. Капацитетот, ако постои, е прикажан подолу.</div>'}
        <section class="card report-chart-card"><div class="card-head"><h3>Термини низ периодот</h3><span class="muted">Сите статуси</span></div><div class="report-chart" tabindex="0" role="img" aria-label="Број на термини по период; точните вредности се во табелата подолу.">${data.periods.map(r => `<div class="report-bar" title="${escape(periodLabel(r))}: ${r.metrics.total}"><span>${r.metrics.total}</span><i style="height:${Math.max(2, r.metrics.total / max * 120)}px"></i><small>${escape(data.query.groupBy === "day" ? formatDate(r.key, { day: "numeric", month: "short" }) : periodLabel(r))}</small></div>`).join("")}</div></section>
        <section class="card report-table-card"><div class="card-head"><div class="chip-tabs" role="group" aria-label="Разгледај извештај">${[["periods","По период"],["doctors","По лекар / профил"],["specialties","По специјалност"],["services","По услуга"]].map(([key,label]) => `<button data-report-tab="${key}" aria-pressed="${key === "periods"}" class="${key === "periods" ? "active" : ""}">${label}</button>`).join("")}</div><button class="btn secondary small" id="report-export">Преземи CSV</button></div><div class="table-wrap" tabindex="0" id="report-table"></div></section>`;
      let active = "periods";
      const labels = ["Група","Вкупно","Потврдени","Реализирани","Откажани","Чекаат потврда","Недоаѓања","Пациенти","Капацитет (часа)","Зафатено (часа)","Искористеност ≈","Откажани %","Недоаѓања %"];
      const rowValues = r => { const v = r.metrics; return [active === "periods" ? periodLabel(r) : r.label,v.total,v.confirmed,v.completed,v.cancelled,v.pending,v.noShow,v.patients,hours(v.capacityMinutes),hours(v.occupiedMinutes),percent(v.utilizationPercent),percent(v.cancellationPercent),percent(v.noShowPercent)]; };
      const table = () => {
        $("#report-table").innerHTML = `<table><caption class="visually-hidden">Извештај за избраниот период</caption><thead><tr>${labels.map(l => `<th scope="col">${l}</th>`).join("")}</tr></thead><tbody>${data[active].map(r => `<tr>${rowValues(r).map((v,i) => i === 0 ? `<th scope="row">${escape(v)}</th>` : `<td>${escape(v)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="13">Нема соодветни профили.</td></tr>`}</tbody></table>`;
      };
      table();
      $$("[data-report-tab]").forEach(b => b.onclick = () => { active = b.dataset.reportTab; $$("[data-report-tab]").forEach(x => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); }); table(); });
      $("#report-export").onclick = () => {
        const safe = value => { let text = String(value); if (/^[=+@\-\t\r]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
        const rows = [["Од",data.query.from,"До",data.query.to,"Временска зона",data.timeZone], ["Лекар", data.query.doctorId || "Сите", "Специјалност", data.query.specialty || "Сите", "Услуга", data.query.serviceId || "Сите"], ["Капацитетот е проценка според сегашниот распоред. Капацитетот по услуга е споделен; историските услуги не се претпоставуваат."], labels, ...data[active].map(rowValues)];
        const url = URL.createObjectURL(new Blob(["\ufeff" + rows.map(r => r.map(safe).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = `careline-${active}-${data.query.from}-${data.query.to}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
    } catch (error) {
      if (request === reportRequest && page === "reports") target.innerHTML = `<div class="inline-error" role="alert">${escape(error.message)}</div><p>Проверете ги филтрите и кликнете „Прикажи извештај“ за повторен обид.</p>`;
    }
  }
  function renderPatients() {
    app.innerHTML =
      heading(
        "Пациентите во центарот на грижата.",
        "Пронајдете пациенти и организирајте ги нивните термини.",
        '<button class="btn primary" data-action="add-patient">＋ Додај пациент</button>',
        "СПИСОК НА ПАЦИЕНТИ",
      ) +
      `<div class="toolbar"><div class="search-field"><label class="visually-hidden" for="patient-search">Пребарај пациенти</label><input id="patient-search" placeholder="Пребарајте по име, е-пошта или телефон…" value="${escape(search)}"></div></div><div class="inline-note" style="margin-bottom:20px">${state.demoMode ? "Демо-режим: користете само измислени контактни податоци." : "Контактните податоци служат за закажување. Не внесувајте медицински податоци во овој простор."}</div><div id="patient-results"></div>`;
    $("#patient-search").oninput = (e) => {
      search = e.target.value;
      patientResults();
    };
    patientResults();
  }
  function patientResults() {
    const list = state.patients.filter((p) =>
      `${p.name} ${p.email} ${p.phone}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
    $("#patient-results").innerHTML =
      `<p class="results-count">${list.length} пациенти</p><div class="patient-card-list">${list.map((p, i) => `<article class="card patient-card">${avatar(p.name, i)}<h3>${escape(p.name)}</h3><p>${escape(p.email || "Не е наведена е-пошта")}</p><p>${escape(p.phone || "Не е наведен телефон")}</p><span class="badge">${p.isDemonstration ? "Измислен пациент" : "Пациент"}</span><br><button class="btn secondary small" data-patient-book="${p.id}">Закажи термин ↗</button></article>`).join("")}</div>${list.length ? "" : empty("Нема соодветни пациенти", "Обидете се со друго пребарување или додајте пациент.")}`;
  }
  function addPatientForm(returnBooking) {
    openDialog(
      "Додај пациент",
      `<p class="muted" style="font-size:12px">${state.demoMode ? "Користете само измислени податоци." : "Овој пациент ќе биде достапен за закажување од медицинскиот тим."}</p><form id="patient-form"><div class="field"><label for="patient-name">Име и презиме</label><input id="patient-name" name="name" required minlength="2" maxlength="80" placeholder="на пр. Ана Пример (демо)"></div><div class="field"><label for="patient-email">Е-пошта <span class="muted">· незадолжително</span></label><input id="patient-email" name="email" type="email" maxlength="120" placeholder="jane@example.test"></div><div class="field"><label for="patient-phone">Телефон <span class="muted">· незадолжително</span></label><input id="patient-phone" name="phone" maxlength="30" placeholder="Оставете празно ако не е потребно"></div><div id="patient-error"></div><div class="dialog-actions"><button class="btn secondary" type="button" id="patient-back">Назад</button><button class="btn primary" type="submit">Додај пациент</button></div></form>`,
      "ПОДАТОЦИ ЗА ПАЦИЕНТОТ",
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
      const button = $("button[type=submit]", e.target);
      button.disabled = true;
      try {
        const p = await api(
          "patients",
          Object.fromEntries(new FormData(e.target)),
        );
        await load(false);
        if (returnBooking) {
          booking = { ...returnBooking, patientId: p.id };
          bookingForm();
          await loadSlots();
        } else {
          closeDialog();
          renderPage();
        }
        toast("Пациентот е додаден.");
      } catch (err) {
        $("#patient-error").innerHTML =
          `<div class="inline-error" role="alert">${escape(err.message)}</div>`;
        button.disabled = false;
      }
    };
  }
  async function renderAvailability() {
    if (!doctorFilter) doctorFilter = ownDoctors()[0].id;
    const d = doctor(doctorFilter);
    app.innerHTML =
      heading(
        "Простор за грижа. Време за вас.",
        "Управувајте со работното време, паузите, отсуствата и дополнителните термини.",
        "",
        "ДОСТАПНОСТ",
      ) +
      `<div class="toolbar"><label for="availability-doctor">Лекар</label><select id="availability-doctor" ${isDoctor() ? "disabled" : ""}>${doctorOptions(doctorFilter)}</select></div><div class="inline-note" style="margin-bottom:20px">Промените се видливи во сите работни простори. Постоечките термини се заштитени: промените што се преклопуваат со нив ќе бидат одбиени.</div><div class="schedule-editor"><section class="card"><h3>Неделно работно време</h3><p class="muted" style="font-size:12px">Користете одделни периоди за поделени смени или редовни паузи.</p><form id="schedule-form"><div class="field"><label for="duration">Времетраење на прегледот (минути)</label><input id="duration" type="number" min="10" max="120" step="5" value="${d.durationMinutes}" required></div><div id="periods">${d.workingPeriods.map(periodRow).join("")}</div><button type="button" class="btn secondary small" id="add-period">＋ Додај работен период</button><div id="schedule-error" style="margin-top:15px"></div><div class="dialog-actions"><button class="btn primary" type="submit">Зачувај работно време</button></div></form><div class="divider"></div><label>Податоци од изворниот документ</label><div class="source-notes">${d.sourceSchedules.map((s) => `<p>${escape(s.days)} · ${s.start ? escape(s.start + "–" + s.end) : "Не е наведено точно работно време"}${s.note ? " · " + escape(s.note) : ""}</p>`).join("")}</div></section><section class="card"><h3>Исклучоци и отсуства</h3><p class="muted" style="font-size:12px">Означете пауза или празник како недостапен период или додајте еднократен слободен период.</p><form id="exception-form"><div class="form-row"><div class="field"><label for="exception-date">Датум</label><input id="exception-date" name="date" type="date" min="${state.today}" max="${addDays(state.today, 180)}" value="${state.today}" required></div><div class="field"><label for="exception-type">Вид</label><select id="exception-type" name="type"><option value="blocked">Недостапно / пауза</option><option value="available">Дополнителна достапност</option></select></div></div><div class="form-row"><div class="field"><label for="exception-start">Од</label><input id="exception-start" type="time" name="start" value="12:00" required></div><div class="field"><label for="exception-end">До</label><input id="exception-end" type="time" name="end" value="13:00" required></div></div><div class="field"><label for="exception-reason">Причина</label><input id="exception-reason" name="reason" maxlength="120" minlength="2" placeholder="на пр. Пауза за ручек" required><div class="field-help">За цел ден користете 00:00–23:59. Без медицински податоци.</div></div><div id="exception-error"></div><button class="btn primary wide" type="submit">Додај исклучок</button></form><div class="divider"></div><label>Зачувани исклучоци</label><div id="exception-list" aria-live="polite">Се вчитува…</div></section></div>${isAdmin() && state.canReset ? `<section class="reset-panel"><div><strong>Започнете одново</strong><p>Вратете ги сите демо-термини, пациенти и промени во распоредот на почетните податоци.</p></div><button class="btn secondary" id="reset-demo">Ресетирај демо</button></section>` : ""}`;
    $("#availability-doctor").onchange = (e) => {
      doctorFilter = e.target.value;
      renderAvailability();
    };
    $("#add-period").onclick = () =>
      $("#periods").insertAdjacentHTML(
        "beforeend",
        periodRow({ day: "Monday", start: "09:00", end: "17:00" }),
      );
    $("#periods").onclick = (e) => {
      const b = e.target.closest("[data-remove-period]");
      if (b) b.closest(".period-row").remove();
    };
    $("#schedule-form").onsubmit = async (e) => {
      e.preventDefault();
      const button = $("button[type=submit]", e.target);
      button.disabled = true;
      try {
        const periods = $$(".period-row").map((row) => ({
          day: $(".period-day", row).value,
          start: $(".period-start", row).value,
          end: $(".period-end", row).value,
        }));
        await api("schedule/" + doctorFilter, {
          periods,
          durationMinutes: Number($("#duration").value),
          version: doctor(doctorFilter).scheduleVersion,
        });
        await load(false);
        $("#schedule-error").innerHTML = "";
        toast("Неделното работно време е зачувано.");
      } catch (err) {
        $("#schedule-error").innerHTML =
          `<div class="inline-error" role="alert">${escape(err.message)}</div>`;
      } finally {
        button.disabled = false;
      }
    };
    $("#exception-form").onsubmit = async (e) => {
      e.preventDefault();
      const button = $("button[type=submit]", e.target);
      button.disabled = true;
      try {
        const values = Object.fromEntries(new FormData(e.target));
        await api("exceptions/" + doctorFilter, {
          ...values,
          isAvailable: values.type === "available",
        });
        $("#exception-error").innerHTML = "";
        await exceptionList();
        toast("Исклучокот во достапноста е зачуван.");
      } catch (err) {
        $("#exception-error").innerHTML =
          `<div class="inline-error" role="alert">${escape(err.message)}</div>`;
      } finally {
        button.disabled = false;
      }
    };
    $("#reset-demo")?.addEventListener("click", async (e) => {
      if (
        !(await confirmAction(
          "Дали сакате да ги ресетирате сите демо-податоци? Ќе се избришат сите додадени пациенти, термини и промени во распоредот.",
          "Ресетирај демо-податоци",
        ))
      )
        return;
      e.target.disabled = true;
      try {
        await api("reset", {});
        await load();
        toast("Демо-податоците се ресетирани.");
      } catch (err) {
        toast(err.message, true);
        e.target.disabled = false;
      }
    });
    await exceptionList();
  }
  function periodRow(p) {
    return `<div class="period-row"><select class="period-day" aria-label="Работен ден">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<option value="${days[i]}" ${p.day === days[i] ? "selected" : ""}>${dayLabels[i]}</option>`).join("")}</select><input class="period-start" type="time" aria-label="Почеток на работниот период" value="${p.start.slice(0, 5)}" required><input class="period-end" type="time" aria-label="Крај на работниот период" value="${p.end.slice(0, 5)}" required><button type="button" class="icon-button" data-remove-period aria-label="Отстрани работен период">×</button></div>`;
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
                `<div class="exception-row"><div><strong>${formatDate(e.date)} · ${e.start.slice(0, 5)}–${e.end.slice(0, 5)}</strong><small>${e.isAvailable ? "Дополнителна достапност" : "Недостапно"} · ${escape(e.reason)}</small></div><button class="icon-button" data-remove-exception="${e.id}" aria-label="Отстрани исклучок">×</button></div>`,
            )
            .join("")
        : '<p class="muted" style="font-size:12px">Нема исклучоци. Важи неделното работно време.</p>';
      $$("[data-remove-exception]").forEach(
        (b) =>
          (b.onclick = async () => {
            if (
              !(await confirmAction(
                "Дали сакате да го отстраните овој исклучок во достапноста?",
                "Отстрани исклучок",
              ))
            )
              return;
            try {
              await api(
                "exceptions/" + b.dataset.removeException + "/remove",
                {},
              );
              await exceptionList();
              toast("Исклучокот е отстранет.");
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
  document.addEventListener("click", (e) => {
    const target = e.target.closest("button, a");
    if (!target || !state) return;
    if (target.dataset.nav) {
      closeDialogIfOpen();
      navigate(target.dataset.nav);
    }
    if (target.dataset.page) {
      navigate(target.dataset.page);
      $("#sidebar").classList.remove("open");
      $("#menu-toggle").setAttribute("aria-expanded", "false");
    }
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
    if (target.dataset.patientBook)
      openBooking(null, null, null, null, target.dataset.patientBook);
    if (target.dataset.action === "book") {
      if (isPatient()) navigate("doctors");
      else if (page === "calendar") {
        const selected = doctorFilter || calendarDoctors()[0]?.id;
        if (selected) openBooking(selected); else toast("Нема профили за избраните филтри.", true);
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
  $("#menu-toggle").onclick = () => {
    const open = $("#sidebar").classList.toggle("open");
    $("#menu-toggle").setAttribute("aria-expanded", String(open));
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      $("#sidebar").classList.remove("open");
      $("#menu-toggle").setAttribute("aria-expanded", "false");
    }
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
      dialog.open ||
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
        "Не можевме да го вчитаме вашиот работен простор.",
        "Вашите зачувани термини не се променети.",
      ) +
      `<div class="inline-error" role="alert">${escape(e.message)}</div><button class="btn primary" id="retry-load">Обиди се повторно</button><a class="btn secondary" href="/Account/Login">Најави се</a>`;
    $("#retry-load").onclick = () => location.reload();
  });
})();
