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
    `<span class="avatar tone-${index % 5} ${extra}" aria-hidden="true">${escape(initials(name))}</span>`;
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
  const formatDate = (
    date,
    options = { day: "numeric", month: "short", year: "numeric" },
  ) =>
    new Intl.DateTimeFormat("mk-MK", { ...options, timeZone: "UTC" }).format(
      new Date(date.slice(0, 10) + "T12:00:00Z"),
    );
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
  const doctorOptions = (selected = "", all = false) =>
    `${all ? '<option value="">Сите лекари</option>' : ""}${ownDoctors()
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
    if (isDoctor()) doctorFilter = state.actor.doctorId;
    if (render) renderPage();
  }
  function navigate(next) {
    search = "";
    specialty = "";
    statusFilter = "";
    location.hash = next;
    if (page === next) renderPage();
  }
  function renderPage() {
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
      overview: "Преглед",
      calendar: "Календар",
      doctors: isPatient() ? "Пронајди лекар" : "Список на лекари",
      appointments: "Термини",
      patients: "Пациенти",
      availability: "Достапност",
    }[page];
    $("#zone-label").textContent = state.timeZone;
    ({
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
      `<div class="profile-header">${avatar(d.name, Number(id.slice(1)), "lg")}<div><h3>${escape(d.name)}</h3><p>${escape(d.specialty)}</p></div></div><div class="form-row"><div><label>Времетраење на прегледот</label><p>${d.durationMinutes} минути <small class="muted">· прилагодливо времетраење</small></p></div><div><label>Начин на закажување</label><p style="font-size:12px">${escape(d.bookingMethod)}</p></div></div><h3>Работен распоред</h3>${scheduleList(d)}<div class="source-notes">${d.demoScheduleEdited ? "<p>Работното време е променето по првичниот увоз.</p>" : ""}${d.sourceSchedules.map((s) => `<p>${escape(s.days)} ${s.start ? escape(s.start + "–" + s.end) : "· Не е наведено работно време"}${s.note ? " · " + escape(s.note) : ""}</p>`).join("")}<p>Локација: не е наведена. ${d.isService ? "Ова е услуга без наведен лекар." : ""}</p></div><div class="dialog-actions"><button class="btn primary" data-book="${d.id}">Пронајди термин ↗</button></div>`,
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
      `<div class="chip-tabs" role="group" aria-label="Период на термините">${["upcoming", "previous", "all"].map((t) => `<button data-list-tab="${t}" class="${listTab === t ? "active" : ""}" aria-pressed="${listTab === t}">${({ upcoming: "Претстојни", previous: "Претходни", all: "Сите" })[t]}</button>`).join("")}</div><div class="toolbar"><div class="search-field"><label class="visually-hidden" for="appointment-search">Пребарај термини</label><input id="appointment-search" placeholder="Пребарајте ${isPatient() ? "лекари" : "пациенти или лекари"}…" value="${escape(search)}"></div>${isAdmin() ? `<label class="visually-hidden" for="list-doctor">Филтрирај по лекар</label><select id="list-doctor">${doctorOptions(doctorFilter, true)}</select>` : ""}<label class="visually-hidden" for="status-filter">Статус на терминот</label><select id="status-filter"><option value="">Сите статуси</option>${statuses.map((s) => `<option value="${s}" ${statusFilter === s ? "selected" : ""}>${statusLabel(s)}</option>`).join("")}</select></div><div id="appointment-results"></div>`;
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
      `<div class="booking-context">${avatar(d.name, Number(d.id.slice(1)))}<div><strong>${escape(d.name)}</strong><small>${escape(d.specialty)}</small></div></div>${badge(a.status)}<dl class="detail-list"><div><dt>Пациент</dt><dd>${escape(p?.name || "Пациент")}</dd></div><div><dt>Датум</dt><dd>${formatDate(dayOf(a.start), { weekday: "short", day: "numeric", month: "long", year: "numeric" })}</dd></div><div><dt>Време</dt><dd>${timeOf(a.start)} – ${timeOf(a.end)}</dd></div><div><dt>Временска зона</dt><dd>${escape(state.timeZone)}</dd></div><div><dt>Број на резервација</dt><dd>CL-${a.id.slice(0, 8).toUpperCase()}</dd></div><div><dt>Времетраење</dt><dd>${Math.round((new Date(a.end) - new Date(a.start)) / 60000)} минути</dd></div></dl>${a.status === "Scheduled" ? `<div class="inline-note warning">Терминот е резервиран и чека потврда од персоналот. Не е испратено известување.</div>` : ""}<div id="detail-error"></div><div class="dialog-actions">${future ? `<button class="btn danger" data-status="Cancelled" data-id="${id}">Откажи преглед</button>${!isPatient() || !d.staffOnly ? `<button class="btn secondary" data-move="${id}">Презакажи</button>` : ""}` : ""}${!isPatient() && future && a.status === "Scheduled" ? `<button class="btn primary" data-status="Confirmed" data-id="${id}">Потврди преглед</button>` : ""}${complete ? `<button class="btn secondary" data-status="NoShow" data-id="${id}">Означи недоаѓање</button><button class="btn primary" data-status="Completed" data-id="${id}">Заврши преглед</button>` : ""}${!future && !complete ? '<button class="btn secondary" data-action="close">Затвори</button>' : ""}</div>`,
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
        (d) => d.workingPeriods.length && (!isPatient() || !d.staffOnly),
      )?.id ||
      ownDoctors()[0].id;
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
      date: date || state.today,
      time: time || "",
      moveId,
      patientId:
        a?.patientId || patientId || (isPatient() ? state.actor.patientId : ""),
      requestId: crypto.randomUUID(),
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
      `<div class="steps"><span class="step active">01 · Лекар и термин</span><span class="step">02 · Проверка</span><span class="step">03 · Закажано</span></div><div class="field"><label for="booking-doctor">Вашиот лекар</label><select id="booking-doctor" ${b.moveId || isDoctor() ? "disabled" : ""}>${doctorOptions(b.doctorId)}</select></div>${d.requiresConfirmation ? `<div class="inline-note warning">${escape(d.bookingMethod)} · Потребна е потврда од персоналот.</div>` : ""}${d.tuesdayFirst ? '<div class="inline-note">Прво се пополнува вторник. Среда се отвора кога претстојните термини во вторник од истата недела се пополнети.</div>' : ""}<div class="form-row" style="margin-top:17px"><div class="field"><label for="booking-date">Изберете датум</label><input type="date" id="booking-date" value="${b.date}" min="${state.today}" max="${addDays(state.today, 180)}" required></div><div class="field"><label>Времетраење на прегледот</label><div class="inline-note">${d.durationMinutes} минути · ${escape(state.timeZone)}</div></div></div>${!isPatient() ? `<div class="field"><label for="booking-patient-search">Пронајди пациент</label><input id="booking-patient-search" placeholder="Пребарајте пациент по име…" ${b.moveId ? "disabled" : ""}></div><div class="field"><label for="booking-patient">Пациент</label><select id="booking-patient" ${b.moveId ? "disabled" : ""}><option value="">Изберете пациент</option>${state.patients.map((p) => `<option value="${p.id}" ${p.id === b.patientId ? "selected" : ""}>${escape(p.name)}</option>`).join("")}</select>${b.moveId ? "" : '<button class="link-button" style="font-size:11px;margin-top:8px" id="new-patient-from-booking">＋ Додај пациент</button>'}</div>` : ""}<div class="slots-label"><strong>Слободни термини</strong><span id="slot-count"></span></div><div id="booking-slots" aria-live="polite"></div><div id="booking-error"></div><div class="dialog-actions"><button class="btn secondary" data-action="close">Назад</button><button class="btn primary" id="review-booking">Провери го терминот ↗</button></div>`,
      "ЗАКАЖЕТЕ ТЕРМИН",
    );
    $("#booking-doctor").addEventListener("change", async (e) => {
      b.doctorId = e.target.value;
      b.time = "";
      bookingForm();
      await loadSlots();
    });
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
        `slots?doctorId=${encodeURIComponent(b.doctorId)}&date=${b.date}${b.moveId ? "&excludeId=" + b.moveId : ""}`,
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
      `<div class="steps"><span class="step">01 · Лекар и термин</span><span class="step active">02 · Проверка</span><span class="step">03 · Закажано</span></div><div class="booking-context">${avatar(d.name)}<div><strong>${escape(d.name)}</strong><small>${escape(d.specialty)}</small></div></div><dl class="detail-list"><div><dt>Пациент</dt><dd>${escape(patient(b.patientId)?.name)}</dd></div><div><dt>Датум</dt><dd>${formatDate(b.date, { weekday: "short", day: "numeric", month: "long" })}</dd></div><div><dt>Време</dt><dd>${b.time} · ${d.durationMinutes} минути</dd></div><div><dt>Временска зона</dt><dd>${escape(state.timeZone)}</dd></div></dl><div class="inline-note ${d.requiresConfirmation ? "warning" : ""}">${d.requiresConfirmation ? "Избраниот термин ќе биде резервиран до потврда од персоналот." : "Вашиот термин ќе биде веднаш потврден."} Не се испраќа е-пошта или SMS.</div><div id="booking-error"></div><div class="dialog-actions"><button class="btn secondary" id="booking-back">Назад</button><button class="btn primary" id="submit-booking">${b.moveId ? "Потврди нов термин" : "Потврди термин"} ✓</button></div>`,
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
              durationMinutes: doctor(b.doctorId).durationMinutes,
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
      `<div class="toolbar">${isAdmin() ? `<label for="calendar-doctor">Лекар</label><select id="calendar-doctor">${doctorOptions(doctorFilter, true)}</select>` : `<span class="results-count" style="margin:0">${escape(doctor(doctorFilter).name)}</span>`}<label class="visually-hidden" for="calendar-status">Филтрирај по статус</label><select id="calendar-status"><option value="">Сите статуси</option>${statuses.map((s) => `<option value="${s}" ${s === statusFilter ? "selected" : ""}>${statusLabel(s)}</option>`).join("")}</select><button class="btn secondary small" id="refresh-calendar">↻ Освежи</button></div><div class="calendar-layout"><section class="card calendar-panel"><div class="calendar-top"><div class="calendar-nav"><button class="icon-button" id="calendar-prev" aria-label="Претходен период">‹</button><button class="icon-button" id="calendar-next" aria-label="Следен период">›</button><h2 id="calendar-title"></h2><button class="btn secondary small" id="calendar-today">Денес</button></div><div class="calendar-views" role="group" aria-label="Приказ на календарот">${[
        ["timeGridDay", "Ден"],
        ["timeGridWeek", "Недела"],
        ["dayGridMonth", "Месец"],
      ]
        .map(
          ([v, l]) =>
            `<button data-calendar-view="${v}" class="${calendarView === v ? "active" : ""}">${l}</button>`,
        )
        .join(
          "",
        )}</div></div><div id="calendar-loading" class="calendar-load" aria-live="polite"></div><div id="calendar"></div><div class="calendar-legend"><span><i style="background:#dcebd0"></i>Достапно</span><span><i style="background:#6d9776"></i>Потврден</span><span><i style="background:#cba05b"></i>Чека потврда</span><span><i style="background:#cdb5a9"></i>Недостапно</span></div><p class="mobile-calendar-note">Користете дневен приказ за повеќе простор. Секој термин е достапен и преку тастатура во списокот со термини.</p></section><aside class="calendar-aside" id="calendar-aside"></aside></div>`;
    $("#calendar-doctor")?.addEventListener("change", (e) => {
      doctorFilter = e.target.value;
      calendarDate = calendar.getDate().toISOString().slice(0, 10);
      renderCalendar();
    });
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
      initialView: calendarView,
      initialDate: calendarDate || state.today,
      headerToolbar: false,
      firstDay: 1,
      timeZone: "UTC",
      allDaySlot: false,
      height: Math.max(520, Math.min(780, innerHeight - 260)),
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
        const date = info.dateStr.slice(0, 10);
        openBooking(
          doctorFilter,
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
        $("#calendar-loading").textContent =
          "Се освежуваат закажаните и слободните термини…";
        try {
          let events = state.appointments
            .filter(
              (a) =>
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
                api(`slots?doctorId=${doctorFilter}&date=${date}`),
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
          toast(e.message, true);
        }
      },
    });
    calendar.render();
    $("#calendar-prev").onclick = () => calendar.prev();
    $("#calendar-next").onclick = () => calendar.next();
    $("#calendar-today").onclick = () => calendar.gotoDate(state.today);
    $$("[data-calendar-view]").forEach(
      (b) =>
        (b.onclick = () => {
          calendarView = b.dataset.calendarView;
          calendar.changeView(calendarView);
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
      else openBooking();
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
