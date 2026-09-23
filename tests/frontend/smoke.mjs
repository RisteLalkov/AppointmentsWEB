// DOM integration checks, not browser layout/accessibility/drag visual verification.
// Build Release first; npm install in this folder, then npm test.
import { JSDOM, CookieJar, VirtualConsole } from "jsdom";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporary = await mkdtemp(resolve(tmpdir(), "careline-dom-"));
const port = await new Promise((res) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => res(port));
  });
});
const base = `http://127.0.0.1:${port}`;
const dotnet = process.env.TEST_DOTNET || "dotnet";
const proc = spawn(
  dotnet,
  [
    resolve(root, "src/Appointments.Web/bin/Release/net10.0/Appointments.Web.dll"),
    "--urls",
    base,
  ],
  {
    cwd: resolve(root, "src/Appointments.Web"),
    env: {
      ...process.env,
      Demo__DataPath: resolve(temporary, "demo-state.json"),
      Backend__Mode: process.env.TEST_API_BASE ? "Api" : "Demo",
      Backend__ApiBaseUrl: process.env.TEST_API_BASE || "http://localhost:5181/",
      Demo__Enabled: "true",
      ASPNETCORE_ENVIRONMENT: "Development",
    },
  },
);
let log = "",
  checks = 0;
proc.stdout.on("data", (x) => (log += x));
proc.stderr.on("data", (x) => (log += x));
const windows = [];
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
async function until(test) {
  for (let i = 0; i < 500; i++) {
    if (test()) return;
    await wait(10);
  }
  throw Error("Timed out waiting for DOM state");
}
function assert(test, name) {
  if (!test) throw Error(name);
  checks++;
  console.log("PASS " + name);
}
async function workspace(user) {
  const jar = new CookieJar();
  async function request(path, options = {}) {
    const url = new URL(path, base).href;
    const headers = new Headers(options.headers);
    headers.set("Cookie", await jar.getCookieString(url));
    const res = await fetch(url, { ...options, headers, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) await jar.setCookie(c, url);
    if (res.status === 302) return request(res.headers.get("location"));
    return res;
  }
  const entry = new JSDOM(await (await request("/Demo")).text());
  const token = entry.window.document.querySelector(
    "[name=__RequestVerificationToken]",
  ).value;
  const response = await request("/Demo/Enter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      userId: user,
      __RequestVerificationToken: token,
    }).toString(),
  });
  const errors = [];
  const console = new VirtualConsole();
  console.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(await response.text(), {
    url: base,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    cookieJar: jar,
    virtualConsole: console,
  });
  windows.push(dom.window);
  const w = dom.window;
  w.fetch = request;
  // Model Chromium builds that silently fall back to English for mk-MK.
  // Explicit Macedonian calendar/date labels must remain correct in this case.
  const NativeDateTimeFormat = w.Intl.DateTimeFormat;
  w.Intl = Object.create(w.Intl);
  w.Intl.DateTimeFormat = class extends NativeDateTimeFormat {
    constructor(locales, options) {
      const fallback = value => /^mk(?:-|$)/i.test(value) ? "en-US" : value;
      super(Array.isArray(locales) ? locales.map(fallback) : locales ? fallback(locales) : locales, options);
    }
  };
  w.matchMedia = () => ({
    matches: false,
    addListener() {},
    removeListener() {},
  });
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  w.eval(
    await readFile(
      resolve(root, "src/Appointments.Web/wwwroot/vendor/fullcalendar.min.js"),
      "utf8",
    ),
  );
  w.eval(
    await readFile(
      resolve(root, "src/Appointments.Web/wwwroot/js/app.js"),
      "utf8",
    ),
  );
  w.eval(await readFile(resolve(root, "src/Appointments.Web/wwwroot/js/validation-mk.js"), "utf8"));
  const $ = (selector) => w.document.querySelector(selector);
  await until(() => $(".page-heading"));
  return {
    w,
    $,
    errors,
    request,
    click(selector) {
      const el = $(selector);
      if (!el) throw Error("Missing " + selector);
      el.click();
    },
    change(selector, value) {
      const el = $(selector);
      el.value = value;
      el.dispatchEvent(new w.Event("change", { bubbles: true }));
    },
    async page(name) {
      w.location.hash = name;
      await until(() =>
        $(`#navigation [data-page="${name}"]`).classList.contains("active"),
      );
    },
  };
}
try {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(base + "/Demo")).ok) break;
    } catch {}
    await wait(100);
  }
  const pat = await workspace("p01");
  assert(
    pat.$(".hero-banner")?.textContent.includes("Одвојте време"),
    "Patient overview renders",
  );
  assert(pat.w.document.documentElement.lang === "mk", "HTML defaults to Macedonian");
  assert(pat.$("#navigation").textContent.includes("Термини") && !pat.$("#navigation").textContent.includes("Appointments"), "Navigation is Macedonian");
  await pat.page("doctors");
  assert(
    pat.w.document.querySelectorAll(".doctor-card").length === 40,
    "Directory renders all source providers",
  );
  pat.$("#doctor-search").value = "Ивица";
  pat
    .$("#doctor-search")
    .dispatchEvent(new pat.w.Event("input", { bubbles: true }));
  assert(
    pat.w.document.querySelectorAll(".doctor-card").length === 1,
    "Macedonian name search filters correctly",
  );
  pat.click("[data-profile]");
  assert(
    pat.$("#main-dialog").open && pat.$(".schedule-summary"),
    "Doctor profile shows schedule",
  );
  assert(pat.$(".schedule-summary").textContent.includes("Понеделник"), "Doctor profile uses Macedonian weekdays");
  pat.click("#close-dialog");
  pat.click("[data-book]");
  await until(() => pat.$("#booking-date"));
  const now = await (await pat.request("/data/bootstrap")).json();
  let date = new Date(now.today + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + 20);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6)
    date.setUTCDate(date.getUTCDate() + 1);
  const iso = date.toISOString().slice(0, 10);
  pat.change("#booking-date", iso);
  await until(() => pat.$(".slot"));
  pat.click(".slot");
  pat.click("#review-booking");
  assert(pat.$("#submit-booking"), "Review step appears after choosing slot");
  pat.click("#submit-booking");
  await until(() => pat.$(".success-view"));
  assert(
    pat.$(".success-view").textContent.includes("Терминот е потврден"),
    "Patient booking completes in DOM flow",
  );
  pat.click("[data-detail]");
  assert(pat.$("#dialog-content .badge.Confirmed").textContent === "Потврден", "Status label translated while CSS/protocol status stays stable");
  assert(pat.$("[data-move]"), "Saved appointment offers rescheduling");
  pat.click("[data-move]");
  await until(() => pat.$("#booking-date"));
  pat.change("#booking-date", iso);
  await until(() => pat.$(".slot"));
  const slots = pat.w.document.querySelectorAll(".slot");
  slots[slots.length - 1].click();
  pat.click("#review-booking");
  pat.click("#submit-booking");
  await until(() => pat.$(".success-view"));
  assert(
    pat.$(".success-view").textContent.includes("Терминот е потврден"),
    "Rescheduling completes in DOM flow",
  );
  pat.click("[data-detail]");
  pat.click('[data-status="Cancelled"]');
  assert(pat.$("#confirm-dialog").open, "Cancellation asks for confirmation");
  pat.click("#confirm-yes");
  await until(() => pat.$("#dialog-content .badge.Cancelled"));
  assert(
    pat.$("#dialog-content .badge.Cancelled"),
    "Cancellation updates displayed status",
  );
  pat.click("#close-dialog");
  await pat.page("appointments");
  assert(pat.$("#appointment-results"), "Patient appointment list renders");
  assert(/[а-ш]/i.test(pat.$(".table-date strong").textContent) && !/[a-z]/i.test(pat.$(".table-date strong").textContent), "Appointment dates stay Macedonian without browser locale data");
  const admin = await workspace("admin");
  await admin.page("calendar");
  await until(() => admin.$(".fc-view"));
  assert(
    admin.$(".fc-timeGridWeek-view"),
    "Reception weekly calendar initializes",
  );
  assert(/[А-Ша-ш]/.test(admin.$("#calendar-title").textContent) && !/September|October|November|December|January|February|March|April|May|June|July|August/.test(admin.$("#calendar-title").textContent), "Calendar title uses Macedonian months");
  assert(admin.$(".fc-col-header-cell-cushion").textContent.includes("пон"), "Calendar starts on Monday with Macedonian weekday");
  admin.change("#calendar-doctor", "d01");
  await until(() =>
    admin.$("#calendar-loading")?.textContent.includes("Ажурирана достапност"),
  );
  assert(
    admin.$("#calendar-loading").textContent.includes("Ажурирана достапност"),
    "Calendar loads authoritative availability successfully",
  );
  admin.click('[data-calendar-view="dayGridMonth"]');
  assert(admin.$(".fc-dayGridMonth-view"), "Month view initializes");
  admin.click('[data-calendar-view="timeGridDay"]');
  assert(admin.$(".fc-timeGridDay-view"), "Day view initializes");
  await admin.page("patients");
  admin.click('[data-action="add-patient"]');
  admin.$("#patient-name").reportValidity();
  assert(admin.$("#patient-name").validationMessage === "Пополнете го ова задолжително поле.", "Native required validation is Macedonian");
  admin.$("#patient-name").value = "DOM Example (Demo)";
  admin.$("#patient-name").dispatchEvent(new admin.w.Event("input", { bubbles: true }));
  assert(admin.$("#patient-name").checkValidity(), "Editing clears localized validation error");
  admin.$("#patient-email").value = "dom@example.test";
  admin
    .$("#patient-form")
    .dispatchEvent(
      new admin.w.Event("submit", { bubbles: true, cancelable: true }),
    );
  await until(() => !admin.$("#main-dialog").open);
  assert(
    admin.$("#patient-results").textContent.includes("DOM Example"),
    "Fictional patient creation updates directory",
  );
  await admin.page("availability");
  await until(() => admin.$("#exception-form"));
  assert(
    admin.w.document.querySelectorAll(".period-row").length === 5,
    "Weekly schedule editor loads actual periods",
  );
  await until(() => admin.$("#exception-list")?.textContent !== "Се вчитува…");
  // PostgreSQL owned collections have no implicit order: validate every selected
  // label/value pair rather than assuming the first saved period is Monday.
  const weekdayLabels = { Sunday: "Недела", Monday: "Понеделник", Tuesday: "Вторник", Wednesday: "Среда", Thursday: "Четврток", Friday: "Петок", Saturday: "Сабота" };
  const periodSelects = [...admin.w.document.querySelectorAll(".period-day")];
  const expectedDays = periodSelects.map(select => select.value).sort();
  assert(periodSelects.every(select => weekdayLabels[select.value] === select.selectedOptions[0].textContent), "Schedule editor preserves enum values behind Macedonian labels");
  admin.$("#schedule-form").dispatchEvent(new admin.w.Event("submit", { bubbles: true, cancelable: true }));
  await until(() => admin.$("#toast").textContent === "Неделното работно време е зачувано.");
  const saved = await (await admin.request("/data/bootstrap")).json();
  assert(JSON.stringify(saved.doctors.find(d => d.id === "d01").workingPeriods.map(p => p.day).sort()) === JSON.stringify(expectedDays), "Localized schedule saves and round-trips through server");
  admin.$("#exception-date").value = iso;
  admin.$("#exception-start").value = "12:00";
  admin.$("#exception-end").value = "13:00";
  admin.$("#exception-reason").value = "DOM demo lunch";
  admin
    .$("#exception-form")
    .dispatchEvent(
      new admin.w.Event("submit", { bubbles: true, cancelable: true }),
    );
  await until(() =>
    admin.$("#exception-list").textContent.includes("DOM demo lunch"),
  );
  assert(
    admin.$("#exception-list").textContent.includes("DOM demo lunch"),
    "Availability exception form saves and refreshes",
  );
  const doc = await workspace("user-d01");
  await doc.page("calendar");
  await until(() => doc.$(".fc-timeGridWeek-view"));
  assert(
    !doc.$("#calendar-doctor"),
    "Doctor calendar cannot switch to other doctors",
  );
  await doc.page("availability");
  await until(() => doc.$("#exception-list")?.textContent !== "Се вчитува…");
  assert(
    doc.$("#availability-doctor").disabled,
    "Doctor availability selection stays on own profile",
  );
  assert(
    [...pat.errors, ...admin.errors, ...doc.errors].length === 0,
    "No uncaught JavaScript errors in exercised flows",
  );
  console.log(
    `\n${checks}/${checks} DOM integration checks passed. No layout/visual assertions are made.`,
  );
} catch (e) {
  console.error(log);
  throw e;
} finally {
  for (const window of windows) window.close();
  proc.kill();
  await new Promise((res) => proc.once("exit", res));
  await rm(temporary, { recursive: true, force: true });
}
