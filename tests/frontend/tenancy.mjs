// Empty-clinic onboarding and tenant context through a real API-backed MVC host.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { JSDOM, CookieJar, VirtualConsole } from "jsdom";
const root = resolve(import.meta.dirname, "../..");
const base = process.env.TEST_WEB_BASE;
if (!base || !process.env.TEST_TENANT_PASSWORD) throw Error("Disposable tenant test host required");
const jar = new CookieJar();
async function request(path, options = {}) {
  const target = new URL(path, base).href;
  const headers = new Headers(options.headers);
  headers.set("Cookie", await jar.getCookieString(target));
  const response = await fetch(target, { ...options, headers, redirect: "manual" });
  for (const cookie of response.headers.getSetCookie()) await jar.setCookie(cookie, target);
  if (response.status === 302) return request(response.headers.get("location"));
  return response;
}
const entry = new JSDOM(await (await request("/Account/Login?clinicId=empty")).text());
const token = entry.window.document.querySelector('[name="__RequestVerificationToken"]').value;
const response = await request("/Account/Login", { method: "POST", body: new URLSearchParams({
  Email: "owner@tenancy.test", Password: process.env.TEST_TENANT_PASSWORD,
  ClinicId: "empty", __RequestVerificationToken: token,
}) });
entry.window.close();
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", e => errors.push(e.message));
const dom = new JSDOM(await response.text(), { url: base, runScripts: "outside-only", pretendToBeVisual: true, cookieJar: jar, virtualConsole });
const w = dom.window;
const $ = s => w.document.querySelector(s);
let checks = 0;
const check = (ok, name) => { if (!ok) throw Error(name); checks++; console.log("PASS " + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(test) { for (let i=0;i<500;i++) { if(test()) return; await wait(10); } throw Error("Tenant DOM timed out"); }
try {
  w.fetch = request;
  w.matchMedia = () => ({matches:false,addListener(){},removeListener(){}});
  w.HTMLDialogElement.prototype.showModal = function(){this.setAttribute("open","");};
  w.HTMLDialogElement.prototype.close = function(){this.removeAttribute("open");};
  for (const file of ["vendor/fullcalendar.min.js","js/app.js","js/validation-mk.js"])
    w.eval(await readFile(resolve(root,"src/Appointments.Web/wwwroot",file),"utf8"));
  await until(() => $(".page-heading"));
  check($(".clinic-badge").textContent.includes("Нова клиника"),"Workspace displays active clinic name");
  check($("#zone-label").textContent.includes("UTC"),"Workspace uses clinic timezone");
  for (const page of ["calendar","appointments","patients","doctors","availability","catalogue","reports"]) {
    w.location.hash = page;
    await until(() => $(`[data-page="${page}"]`).classList.contains("active"));
    await wait(150);
    check(!!$(".page-heading") && !$("#app").textContent.includes("Серверот не можеше"),"Empty clinic renders " + page);
  }
  w.location.hash = "calendar";
  await until(() => $("[data-action=book]"));
  $("[data-action=book]").click();
  await wait(100);
  check($("#toast").textContent.includes("Нема профили"),"Empty-clinic calendar booking gives useful feedback");
  w.location.hash = "overview";
  await until(() => $('[data-page="overview"]').classList.contains("active"));
  $("[data-action=book]").click();
  await wait(100);
  check($("#toast").textContent.includes("активен лекар"),"Empty-clinic overview booking gives useful feedback");
  check(!errors.length,"No JavaScript errors in empty-clinic workflows");
  console.log(`${checks}/${checks} tenant DOM checks passed. No visual/layout assertions.`);
} finally { w.close(); }
