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
  const statuses = [
    "Scheduled",
    "Confirmed",
    "Completed",
    "Cancelled",
    "NoShow",
  ];
  const statusLabel = (s) =>
    ({ Scheduled: "Awaiting confirmation", NoShow: "No-show" })[s] || s;
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
    new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(
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
    eyebrow = "YOUR CARE, CONNECTED",
  ) =>
    `<div class="page-heading"><div><span class="eyebrow">${escape(eyebrow)}</span><h1>${escape(title)}</h1><p>${escape(subtitle)}</p></div>${action}</div>`;
  const bookButton = (label) =>
    `<button class="btn primary" data-action="book"><span aria-hidden="true">＋</span> ${escape(label || "New appointment")}</button>`;
  const doctorOptions = (selected = "", all = false) =>
    `${all ? '<option value="">All doctors</option>' : ""}${ownDoctors()
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
      throw new Error("Your session ended. Please sign in again.");
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(
        "The server could not complete this request. Please try again.",
      );
    }
    if (!response.ok)
      throw new Error(result.error || "Check the form and try again.");
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
      overview: "Overview",
      calendar: "Calendar",
      doctors: isPatient() ? "Find a doctor" : "Doctor directory",
      appointments: "Appointments",
      patients: "Patients",
      availability: "Availability",
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
    const name = isPatient() ? d.name : p?.name || "Patient";
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
            "Upcoming visits",
            future.length,
            "A little planning, more peace of mind",
            "◷",
          ],
          [
            "Doctors & services",
            state.doctors.length,
            "Care across a range of specialties",
            "✚",
          ],
          [
            "Awaiting confirmation",
            pending.length,
            "Your time is held for review",
            "◌",
          ],
          [
            "Previous visits",
            state.appointments.filter((a) =>
              ["Completed", "NoShow"].includes(a.status),
            ).length,
            "Your appointment history",
            "↗",
          ],
        ]
      : [
          [
            "Appointments today",
            today.length,
            "Your day, clearly organized",
            "◷",
          ],
          [
            "Upcoming visits",
            future.length,
            "Across the next scheduled dates",
            "▤",
          ],
          [
            "Awaiting confirmation",
            pending.length,
            "Ready for your review",
            "◌",
          ],
          [
            isDoctor() ? "Weekly working hours" : "Doctors & services",
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
              ? "Based on your working schedule"
              : "One connected directory",
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
        `Hello, ${firstName.replace("Др.", "Doctor")}.`,
        `${formatDate(state.today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · Let’s make room for a good day.`,
        bookButton(isPatient() ? "Book a visit" : "New appointment"),
      ) +
      (isPatient()
        ? `<section class="hero-banner"><div><span class="eyebrow">GOOD HEALTH STARTS HERE</span><h2>A little time for yourself.<br /><em>A step toward feeling better.</em></h2><p>Find the right specialist and a time that works for you. We’ll keep the details together.</p><button class="btn primary" data-nav="doctors">Find your doctor <span aria-hidden="true">↗</span></button></div><div class="hero-visual" aria-hidden="true"><span class="hero-plus">✚</span><span class="hero-tag">Your health. Your pace.</span></div></section>`
        : "") +
      `<section class="stats-grid" aria-label="Appointment overview">${stats.map(([label, value, note, symbol]) => `<div class="stat-card"><span class="stat-label">${label}</span><span class="stat-symbol" aria-hidden="true">${symbol}</span><strong class="stat-value">${value}</strong><div class="stat-note">${note}</div></div>`).join("")}</section>
        <div class="overview-grid"><section class="card"><div class="card-head"><h3>${isPatient() ? "Your next appointments" : "Coming up next"}</h3><button class="section-link" data-nav="appointments">View all ↗</button></div>${future.length ? future.slice(0, 6).map(appointmentRow).join("") : empty("A little breathing room", "No upcoming appointments. Choose a doctor to plan your next visit.")}</section><div><section class="card"><div class="card-head"><h3>This week at a glance</h3><span class="muted" style="font-size:10px">${formatDate(week, { day: "numeric", month: "short" })}</span></div><div class="card-body"><div class="week-chart" aria-label="Appointment counts by weekday">${counts.map((n, i) => `<div class="chart-col ${addDays(week, i) === state.today ? "current" : ""}"><span class="chart-count">${n}</span><div class="chart-bar" style="height:${Math.max(3, (n / max) * 105)}px"></div><small>${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]}</small></div>`).join("")}</div><div class="week-chart-caption">${counts.reduce((a, b) => a + b, 0)} appointments · Monday through Sunday</div></div></section><section class="card" style="margin-top:20px"><div class="card-head"><h3>A few helpful shortcuts</h3></div><div class="quick-list"><button data-nav="${isPatient() ? "doctors" : "calendar"}"><span>${isPatient() ? "Explore your care options" : "Open your calendar"}<small>${isPatient() ? "Find a specialist for your next visit" : "A clear picture of every day"}</small></span>↗</button><button data-nav="${isPatient() ? "appointments" : "availability"}"><span>${isPatient() ? "Manage your appointments" : "Working hours & time away"}<small>${isPatient() ? "Move or cancel an upcoming visit" : "Keep your availability up to date"}</small></span>↗</button></div></section></div></div>`;
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
        isPatient() ? "The right care, for you." : "Your doctor directory.",
        "Explore specialists and the schedules supplied by your care team.",
        "",
        isPatient() ? "FIND YOUR DOCTOR" : "PEOPLE BEHIND THE CARE",
      ) +
      `<div class="toolbar"><div class="search-field"><label class="visually-hidden" for="doctor-search">Search doctors</label><input id="doctor-search" placeholder="Search by name or specialty" value="${escape(search)}" /></div><label class="visually-hidden" for="specialty">Specialty</label><select id="specialty"><option value="">All specialties</option>${[
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
      `<p class="results-count">${list.length} doctors & services · All times in ${escape(state.timeZone)}</p><div class="doctor-grid">${list.map((d, i) => `<article class="card doctor-card"><div class="doctor-card-top">${avatar(d.name, i)}<span class="badge">${d.staffOnly ? "Reception booking" : d.workingPeriods.length ? "Scheduled hours" : "By arrangement"}</span></div><h3>${escape(d.name)}</h3><div class="specialty">${escape(d.specialty)}</div><div class="doctor-card-meta"><span>◷ ${d.durationMinutes} min</span><span>${d.funding === "Не е наведено" ? "Funding not specified" : escape(d.funding)}</span></div><div class="doctor-card-actions"><button class="btn secondary" data-profile="${d.id}">View profile</button><button class="btn primary" data-book="${d.id}">${d.staffOnly && isPatient() ? "Booking information" : "Find a time"} ↗</button></div></article>`).join("")}</div>${list.length ? "" : empty("No doctors found", "Try a different name or specialty.")}`;
  }
  function scheduleList(d) {
    return d.workingPeriods.length
      ? `<ul class="schedule-summary">${[1, 2, 3, 4, 5, 6, 0]
          .map((i) => {
            const periods = d.workingPeriods.filter((p) => p.day === days[i]);
            return `<li><span>${days[i]}</span><strong>${periods.length ? periods.map((p) => p.start.slice(0, 5) + " – " + p.end.slice(0, 5)).join(", ") : "—"}</strong></li>`;
          })
          .join("")}</ul>`
      : `<div class="inline-note warning">Exact hours are not supplied. Reception or the doctor must agree a time and add an availability period.</div>`;
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
      "Meet your care provider",
      `<div class="profile-header">${avatar(d.name, Number(id.slice(1)), "lg")}<div><h3>${escape(d.name)}</h3><p>${escape(d.specialty)}</p></div></div><div class="form-row"><div><label>Appointment length</label><p>${d.durationMinutes} minutes <small class="muted">· configurable duration</small></p></div><div><label>Booking method</label><p style="font-size:12px">${escape(d.bookingMethod)}</p></div></div><h3>Working schedule</h3>${scheduleList(d)}<div class="source-notes">${d.demoScheduleEdited ? "<p>Working hours have been adjusted since the original import.</p>" : ""}${d.sourceSchedules.map((s) => `<p>${escape(s.days)} ${s.start ? escape(s.start + "–" + s.end) : "· Hours not specified"}${s.note ? " · " + escape(s.note) : ""}</p>`).join("")}<p>Location: not supplied. ${d.isService ? "This is a service without a named doctor." : ""}</p></div><div class="dialog-actions"><button class="btn primary" data-book="${d.id}">Find an appointment ↗</button></div>`,
      "DOCTOR PROFILE",
    );
  }
  function renderAppointments() {
    app.innerHTML =
      heading(
        isPatient() ? "Your appointments." : "Every visit, in view.",
        "Keep track of what’s next, and everything that came before.",
        bookButton(),
      ) +
      `<div class="chip-tabs" role="group" aria-label="Appointment period">${["upcoming", "previous", "all"].map((t) => `<button data-list-tab="${t}" class="${listTab === t ? "active" : ""}" aria-pressed="${listTab === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div><div class="toolbar"><div class="search-field"><label class="visually-hidden" for="appointment-search">Search appointments</label><input id="appointment-search" placeholder="Search ${isPatient() ? "doctors" : "patients or doctors"}…" value="${escape(search)}"></div>${isAdmin() ? `<label class="visually-hidden" for="list-doctor">Filter doctor</label><select id="list-doctor">${doctorOptions(doctorFilter, true)}</select>` : ""}<label class="visually-hidden" for="status-filter">Appointment status</label><select id="status-filter"><option value="">All statuses</option>${statuses.map((s) => `<option value="${s}" ${statusFilter === s ? "selected" : ""}>${statusLabel(s)}</option>`).join("")}</select></div><div id="appointment-results"></div>`;
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
      `<p class="results-count">${list.length} appointments · ${escape(state.timeZone)}</p><section class="card table-wrap">${
        list.length
          ? `<table><thead><tr><th>${isPatient() ? "Doctor" : "Patient"}</th>${isPatient() ? "" : "<th>Doctor</th>"}<th>Date & time</th><th>Status</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${list
              .map((a) => {
                const d = doctor(a.doctorId),
                  p = patient(a.patientId),
                  name = isPatient() ? d.name : p?.name || "Patient";
                return `<tr><td><div class="table-person">${avatar(name, Number(d.id.slice(1)))}<span><strong>${escape(name)}</strong><small>${escape(isPatient() ? d.specialty : p?.isDemonstration ? "Fictional demonstration patient" : "Patient")}</small></span></div></td>${isPatient() ? "" : `<td>${escape(d.name)}</td>`}<td class="table-date"><strong>${formatDate(dayOf(a.start))}</strong><small>${timeOf(a.start)} – ${timeOf(a.end)}</small></td><td>${badge(a.status)}</td><td><button class="table-action" data-detail="${a.id}">Details ↗</button></td></tr>`;
              })
              .join("")}</tbody></table>`
          : empty(
              "Nothing here just yet",
              "Try another filter or book your next appointment.",
            )
      }</section>`;
  }
  function details(id) {
    const a = state.appointments.find((a) => a.id === id);
    if (!a) {
      toast("This appointment is no longer available.", true);
      return;
    }
    const d = doctor(a.doctorId),
      p = patient(a.patientId);
    const future = upcoming(a);
    const complete =
      !isPatient() && a.status === "Confirmed" && new Date(a.end) <= new Date();
    openDialog(
      "Appointment details",
      `<div class="booking-context">${avatar(d.name, Number(d.id.slice(1)))}<div><strong>${escape(d.name)}</strong><small>${escape(d.specialty)}</small></div></div>${badge(a.status)}<dl class="detail-list"><div><dt>Patient</dt><dd>${escape(p?.name || "Patient")}</dd></div><div><dt>Date</dt><dd>${formatDate(dayOf(a.start), { weekday: "short", day: "numeric", month: "long", year: "numeric" })}</dd></div><div><dt>Time</dt><dd>${timeOf(a.start)} – ${timeOf(a.end)}</dd></div><div><dt>Time zone</dt><dd>${escape(state.timeZone)}</dd></div><div><dt>Booking reference</dt><dd>CL-${a.id.slice(0, 8).toUpperCase()}</dd></div><div><dt>Duration</dt><dd>${Math.round((new Date(a.end) - new Date(a.start)) / 60000)} minutes</dd></div></dl>${a.status === "Scheduled" ? `<div class="inline-note warning">This time is reserved and awaiting staff confirmation. No notification has been sent.</div>` : ""}<div id="detail-error"></div><div class="dialog-actions">${future ? `<button class="btn danger" data-status="Cancelled" data-id="${id}">Cancel visit</button>${!isPatient() || !d.staffOnly ? `<button class="btn secondary" data-move="${id}">Reschedule</button>` : ""}` : ""}${!isPatient() && future && a.status === "Scheduled" ? `<button class="btn primary" data-status="Confirmed" data-id="${id}">Confirm visit</button>` : ""}${complete ? `<button class="btn secondary" data-status="NoShow" data-id="${id}">Mark no-show</button><button class="btn primary" data-status="Completed" data-id="${id}">Complete visit</button>` : ""}${!future && !complete ? '<button class="btn secondary" data-action="close">Close</button>' : ""}</div>`,
      "APPOINTMENT · CL-" + a.id.slice(0, 8).toUpperCase(),
    );
  }
  async function confirmAction(message, label = "Confirm") {
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
          ? "Cancel this appointment and release the reserved time?"
          : `Change this appointment to “${statusLabel(status)}”?`,
        status === "Cancelled" ? "Cancel appointment" : "Update status",
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
          ? "Appointment cancelled. The time is available again."
          : "Appointment updated.",
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
        '<div class="inline-note warning">The source requires booking through reception. Contact reception to arrange this visit. No message has been sent.</div>',
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
      b.moveId ? "Find a new time" : "Make time for your health",
      `<div class="steps"><span class="step active">01 · Doctor & time</span><span class="step">02 · Review</span><span class="step">03 · Booked</span></div><div class="field"><label for="booking-doctor">Your care provider</label><select id="booking-doctor" ${b.moveId || isDoctor() ? "disabled" : ""}>${doctorOptions(b.doctorId)}</select></div>${d.requiresConfirmation ? `<div class="inline-note warning">${escape(d.bookingMethod)} · Staff confirmation is required.</div>` : ""}${d.tuesdayFirst ? '<div class="inline-note">Tuesday is filled first. Wednesday opens when that week’s future Tuesday slots are full.</div>' : ""}<div class="form-row" style="margin-top:17px"><div class="field"><label for="booking-date">Choose a date</label><input type="date" id="booking-date" value="${b.date}" min="${state.today}" max="${addDays(state.today, 180)}" required></div><div class="field"><label>Appointment length</label><div class="inline-note">${d.durationMinutes} minutes · ${escape(state.timeZone)}</div></div></div>${!isPatient() ? `<div class="field"><label for="booking-patient-search">Find a patient</label><input id="booking-patient-search" placeholder="Search patient name…" ${b.moveId ? "disabled" : ""}></div><div class="field"><label for="booking-patient">Patient</label><select id="booking-patient" ${b.moveId ? "disabled" : ""}><option value="">Select a patient</option>${state.patients.map((p) => `<option value="${p.id}" ${p.id === b.patientId ? "selected" : ""}>${escape(p.name)}</option>`).join("")}</select>${b.moveId ? "" : '<button class="link-button" style="font-size:11px;margin-top:8px" id="new-patient-from-booking">＋ Add a patient</button>'}</div>` : ""}<div class="slots-label"><strong>Available times</strong><span id="slot-count"></span></div><div id="booking-slots" aria-live="polite"></div><div id="booking-error"></div><div class="dialog-actions"><button class="btn secondary" data-action="close">Go back</button><button class="btn primary" id="review-booking">Review appointment ↗</button></div>`,
      "BOOK AN APPOINTMENT",
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
        '<option value="">Select a patient</option>' +
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
      '<div class="loading-state" style="padding:25px"><span class="spinner"></span> Checking available times…</div>';
    $("#review-booking").disabled = true;
    try {
      if (!b.date) throw new Error("Select a date to see available times.");
      const slots = await api(
        `slots?doctorId=${encodeURIComponent(b.doctorId)}&date=${b.date}${b.moveId ? "&excludeId=" + b.moveId : ""}`,
      );
      if (request !== slotRequest || booking !== b) return;
      b.slots = slots;
      $("#slot-count").textContent = `${slots.length} available`;
      if (!slots.some((s) => s.time.slice(0, 5) === b.time)) b.time = "";
      container.innerHTML = slots.length
        ? `<div class="slots">${slots.map((s) => `<button class="slot ${s.time.slice(0, 5) === b.time ? "selected" : ""}" aria-pressed="${s.time.slice(0, 5) === b.time}" data-time="${s.time.slice(0, 5)}">${s.time.slice(0, 5)}</button>`).join("")}</div>`
        : empty(
            "No available times on this date",
            "Try another day. Availability respects working hours, existing visits, and time away.",
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
        container.innerHTML = `<div class="inline-error" role="alert">${escape(e.message)}</div><button class="btn secondary small" id="retry-slots">Try again</button>`;
      $("#retry-slots")?.addEventListener("click", loadSlots);
    }
  }
  function reviewBooking() {
    const b = booking,
      d = doctor(b.doctorId);
    if (!b.time || !b.patientId) {
      $("#booking-error").innerHTML =
        '<div class="inline-error" role="alert">Select an available time and a patient before continuing.</div>';
      return;
    }
    openDialog(
      "One last look.",
      `<div class="steps"><span class="step">01 · Doctor & time</span><span class="step active">02 · Review</span><span class="step">03 · Booked</span></div><div class="booking-context">${avatar(d.name)}<div><strong>${escape(d.name)}</strong><small>${escape(d.specialty)}</small></div></div><dl class="detail-list"><div><dt>Patient</dt><dd>${escape(patient(b.patientId)?.name)}</dd></div><div><dt>Date</dt><dd>${formatDate(b.date, { weekday: "short", day: "numeric", month: "long" })}</dd></div><div><dt>Time</dt><dd>${b.time} · ${d.durationMinutes} minutes</dd></div><div><dt>Time zone</dt><dd>${escape(state.timeZone)}</dd></div></dl><div class="inline-note ${d.requiresConfirmation ? "warning" : ""}">${d.requiresConfirmation ? "Your selected time will be reserved pending staff confirmation." : "Your appointment will be confirmed immediately."} No email or SMS is sent.</div><div id="booking-error"></div><div class="dialog-actions"><button class="btn secondary" id="booking-back">Back</button><button class="btn primary" id="submit-booking">${b.moveId ? "Confirm new time" : "Confirm appointment"} ✓</button></div>`,
      "REVIEW YOUR VISIT",
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
        a.status === "Scheduled" ? "Your time is reserved." : "You’re all set.",
        `<div class="success-view"><div class="success-mark">✓</div><h3>${a.status === "Scheduled" ? "Awaiting confirmation" : "Appointment confirmed"}</h3><p>${escape(doctor(a.doctorId).name)}<br>${formatDate(dayOf(a.start), { weekday: "long", day: "numeric", month: "long" })} at <strong>${timeOf(a.start)}</strong><br>${escape(state.timeZone)}</p>${badge(a.status)}<p style="margin-top:18px">Reference <strong>CL-${a.id.slice(0, 8).toUpperCase()}</strong><br>No email or SMS has been sent.</p></div><div class="dialog-actions"><button class="btn secondary" data-action="close">Done</button><button class="btn primary" data-detail="${a.id}">View appointment ↗</button></div>`,
        "A LITTLE MORE PEACE OF MIND",
      );
      toast(
        b.moveId
          ? "Appointment rescheduled."
          : "Appointment saved across all workspaces.",
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
          ? "Your day, thoughtfully planned."
          : "A clear view of every day.",
        "Click an available time to book. Open a visit to see the details.",
        bookButton(),
        "YOUR SCHEDULE",
      ) +
      `<div class="toolbar">${isAdmin() ? `<label for="calendar-doctor">Care provider</label><select id="calendar-doctor">${doctorOptions(doctorFilter, true)}</select>` : `<span class="results-count" style="margin:0">${escape(doctor(doctorFilter).name)}</span>`}<label class="visually-hidden" for="calendar-status">Filter status</label><select id="calendar-status"><option value="">All statuses</option>${statuses.map((s) => `<option value="${s}" ${s === statusFilter ? "selected" : ""}>${statusLabel(s)}</option>`).join("")}</select><button class="btn secondary small" id="refresh-calendar">↻ Refresh</button></div><div class="calendar-layout"><section class="card calendar-panel"><div class="calendar-top"><div class="calendar-nav"><button class="icon-button" id="calendar-prev" aria-label="Previous period">‹</button><button class="icon-button" id="calendar-next" aria-label="Next period">›</button><h2 id="calendar-title"></h2><button class="btn secondary small" id="calendar-today">Today</button></div><div class="calendar-views" role="group" aria-label="Calendar view">${[
        ["timeGridDay", "Day"],
        ["timeGridWeek", "Week"],
        ["dayGridMonth", "Month"],
      ]
        .map(
          ([v, l]) =>
            `<button data-calendar-view="${v}" class="${calendarView === v ? "active" : ""}">${l}</button>`,
        )
        .join(
          "",
        )}</div></div><div id="calendar-loading" class="calendar-load" aria-live="polite"></div><div id="calendar"></div><div class="calendar-legend"><span><i style="background:#dcebd0"></i>Available</span><span><i style="background:#6d9776"></i>Confirmed</span><span><i style="background:#cba05b"></i>Awaiting confirmation</span><span><i style="background:#cdb5a9"></i>Unavailable</span></div><p class="mobile-calendar-note">Use Day view for more space. Every appointment is also keyboard-accessible in the Appointments list.</p></section><aside class="calendar-aside" id="calendar-aside"></aside></div>`;
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
      ? `<section class="card"><div class="card-head"><h3>Your selected provider</h3></div><div class="card-body">${avatar(selected.name, Number(selected.id.slice(1)))}<h4>${escape(selected.name)}</h4><p>${escape(selected.specialty)}</p><div class="divider"></div><label>Weekly working hours</label>${scheduleList(selected)}<button class="btn secondary small wide" data-nav="availability">Manage availability ↗</button></div></section>`
      : `<section class="card"><div class="card-head"><h3>One connected calendar</h3></div><div class="card-body"><p>View appointments across all doctors, or choose one provider to reveal available times and their working schedule.</p><button class="btn primary small wide" data-action="book">＋ New appointment</button></div></section>`;
    if (!window.FullCalendar) {
      $("#calendar").innerHTML = empty(
        "Calendar could not load",
        "Reload the page. You can still book and manage visits in Appointments.",
      );
      return;
    }
    calendar = new FullCalendar.Calendar($("#calendar"), {
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
            `Move this appointment to ${formatDate(moved.slice(0, 10))} at ${moved.slice(11, 16)} (${state.timeZone})?`,
            "Move appointment",
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
          toast("Appointment moved.");
        } catch (e) {
          info.revert();
          toast(e.message, true);
        }
      },
      events: async (info, success, failure) => {
        $("#calendar-loading").textContent =
          "Refreshing appointments and available times…";
        try {
          let events = state.appointments
            .filter(
              (a) =>
                (!doctorFilter || a.doctorId === doctorFilter) &&
                (!statusFilter || a.status === statusFilter),
            )
            .map((a) => ({
              id: a.id,
              title: `${patient(a.patientId)?.name || "Patient"}${!doctorFilter ? " · " + doctor(a.doctorId).name : ""}`,
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
                  title: "Unavailable",
                  editable: false,
                })),
            );
          }
          success(events);
          if ($("#calendar-loading"))
            $("#calendar-loading").textContent = doctorFilter
              ? `Live availability · ${state.timeZone} · Choose a green time or use New appointment.`
              : `${state.timeZone} · Select a doctor to show available times.`;
        } catch (e) {
          failure(e);
          if ($("#calendar-loading"))
            $("#calendar-loading").textContent =
              "Could not refresh. Use Refresh to try again.";
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
        "People at the heart of care.",
        "Find patients and coordinate their appointments.",
        '<button class="btn primary" data-action="add-patient">＋ Add patient</button>',
        "DEMONSTRATION DIRECTORY",
      ) +
      `<div class="toolbar"><div class="search-field"><label class="visually-hidden" for="patient-search">Search patients</label><input id="patient-search" placeholder="Search name, email or phone…" value="${escape(search)}"></div></div><div class="inline-note" style="margin-bottom:20px">${state.demoMode ? "Demo mode: use fictional contact details only." : "Contact information supports scheduling. Keep clinical details out of this workspace."}</div><div id="patient-results"></div>`;
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
      `<p class="results-count">${list.length} patients</p><div class="patient-card-list">${list.map((p, i) => `<article class="card patient-card">${avatar(p.name, i)}<h3>${escape(p.name)}</h3><p>${escape(p.email || "No email supplied")}</p><p>${escape(p.phone || "No phone supplied")}</p><span class="badge">${p.isDemonstration ? "Fictional patient" : "Patient"}</span><br><button class="btn secondary small" data-patient-book="${p.id}">Book appointment ↗</button></article>`).join("")}</div>${list.length ? "" : empty("No matching patients", "Try another search or add a patient.")}`;
  }
  function addPatientForm(returnBooking) {
    openDialog(
      "Add a patient",
      `<p class="muted" style="font-size:12px">${state.demoMode ? "Use fictional details only." : "This person becomes available to the care team for scheduling."}</p><form id="patient-form"><div class="field"><label for="patient-name">Full name</label><input id="patient-name" name="name" required minlength="2" maxlength="80" placeholder="e.g. Jane Example (Demo)"></div><div class="field"><label for="patient-email">Email <span class="muted">· optional</span></label><input id="patient-email" name="email" type="email" maxlength="120" placeholder="jane@example.test"></div><div class="field"><label for="patient-phone">Phone <span class="muted">· optional</span></label><input id="patient-phone" name="phone" maxlength="30" placeholder="Leave empty if not needed"></div><div id="patient-error"></div><div class="dialog-actions"><button class="btn secondary" type="button" id="patient-back">Back</button><button class="btn primary" type="submit">Add patient</button></div></form>`,
      "FICTIONAL DETAILS ONLY",
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
        toast("Patient added.");
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
        "Space for care. Time for you.",
        "Manage working hours, breaks, time away and additional sessions.",
        "",
        "AVAILABILITY",
      ) +
      `<div class="toolbar"><label for="availability-doctor">Care provider</label><select id="availability-doctor" ${isDoctor() ? "disabled" : ""}>${doctorOptions(doctorFilter)}</select></div><div class="inline-note" style="margin-bottom:20px">Changes are shared across all workspaces. Existing bookings are protected: conflicting availability changes will be rejected.</div><div class="schedule-editor"><section class="card"><h3>Weekly working hours</h3><p class="muted" style="font-size:12px">Use separate periods for split shifts or recurring breaks.</p><form id="schedule-form"><div class="field"><label for="duration">Appointment duration (minutes)</label><input id="duration" type="number" min="10" max="120" step="5" value="${d.durationMinutes}" required></div><div id="periods">${d.workingPeriods.map(periodRow).join("")}</div><button type="button" class="btn secondary small" id="add-period">＋ Add working period</button><div id="schedule-error" style="margin-top:15px"></div><div class="dialog-actions"><button class="btn primary" type="submit">Save working hours</button></div></form><div class="divider"></div><label>Original workbook information</label><div class="source-notes">${d.sourceSchedules.map((s) => `<p>${escape(s.days)} · ${s.start ? escape(s.start + "–" + s.end) : "Exact hours not supplied"}${s.note ? " · " + escape(s.note) : ""}</p>`).join("")}</div></section><section class="card"><h3>Exceptions & time away</h3><p class="muted" style="font-size:12px">Block a break or holiday, or add a one-off available session.</p><form id="exception-form"><div class="form-row"><div class="field"><label for="exception-date">Date</label><input id="exception-date" name="date" type="date" min="${state.today}" max="${addDays(state.today, 180)}" value="${state.today}" required></div><div class="field"><label for="exception-type">Type</label><select id="exception-type" name="type"><option value="blocked">Unavailable / break</option><option value="available">Additional availability</option></select></div></div><div class="form-row"><div class="field"><label for="exception-start">From</label><input id="exception-start" type="time" name="start" value="12:00" required></div><div class="field"><label for="exception-end">Until</label><input id="exception-end" type="time" name="end" value="13:00" required></div></div><div class="field"><label for="exception-reason">Reason</label><input id="exception-reason" name="reason" maxlength="120" minlength="2" placeholder="e.g. Lunch break" required><div class="field-help">For a full day, use 00:00–23:59. No clinical details.</div></div><div id="exception-error"></div><button class="btn primary wide" type="submit">Add exception</button></form><div class="divider"></div><label>Saved exceptions</label><div id="exception-list" aria-live="polite">Loading…</div></section></div>${isAdmin() && state.canReset ? `<section class="reset-panel"><div><strong>Start fresh</strong><p>Reset all demo appointments, patients and schedule changes to the original seed.</p></div><button class="btn secondary" id="reset-demo">Reset demo</button></section>` : ""}`;
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
        toast("Weekly working hours saved.");
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
        toast("Availability exception saved.");
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
          "Reset all demo data? This removes every custom patient, appointment and schedule change.",
          "Reset demonstration",
        ))
      )
        return;
      e.target.disabled = true;
      try {
        await api("reset", {});
        await load();
        toast("Demo data has been reset.");
      } catch (err) {
        toast(err.message, true);
        e.target.disabled = false;
      }
    });
    await exceptionList();
  }
  function periodRow(p) {
    return `<div class="period-row"><select class="period-day" aria-label="Working day">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<option ${p.day === days[i] ? "selected" : ""}>${days[i]}</option>`).join("")}</select><input class="period-start" type="time" aria-label="Working period start" value="${p.start.slice(0, 5)}" required><input class="period-end" type="time" aria-label="Working period end" value="${p.end.slice(0, 5)}" required><button type="button" class="icon-button" data-remove-period aria-label="Remove working period">×</button></div>`;
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
                `<div class="exception-row"><div><strong>${formatDate(e.date)} · ${e.start.slice(0, 5)}–${e.end.slice(0, 5)}</strong><small>${e.isAvailable ? "Extra availability" : "Unavailable"} · ${escape(e.reason)}</small></div><button class="icon-button" data-remove-exception="${e.id}" aria-label="Remove exception">×</button></div>`,
            )
            .join("")
        : '<p class="muted" style="font-size:12px">No exceptions yet. Weekly working hours apply.</p>';
      $$("[data-remove-exception]").forEach(
        (b) =>
          (b.onclick = async () => {
            if (
              !(await confirmAction(
                "Remove this availability exception?",
                "Remove exception",
              ))
            )
              return;
            try {
              await api(
                "exceptions/" + b.dataset.removeException + "/remove",
                {},
              );
              await exceptionList();
              toast("Exception removed.");
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
        "We couldn’t load your workspace.",
        "Your saved appointments have not been changed.",
      ) +
      `<div class="inline-error" role="alert">${escape(e.message)}</div><button class="btn primary" id="retry-load">Try again</button><a class="btn secondary" href="/Account/Login">Sign in</a>`;
    $("#retry-load").onclick = () => location.reload();
  });
})();
