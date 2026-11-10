import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";

const root = new URL("../../src/Appointments.Web/wwwroot/", import.meta.url);
let checks = 0;
function check(ok, label) { if (!ok) throw Error(label); checks++; console.log("PASS dates " + label); }
for (const lang of ["mk", "en"]) {
  const dom = new JSDOM(`<html lang="${lang}"><body><form><label for="day">Date</label><input id="day" name="date" type="date" value="2000-02-29" min="1999-01-01" max="2030-12-31" required><button>Save</button></form></body></html>`, { runScripts: "outside-only" });
  const w = dom.window, doc = w.document;
  if (lang === "en") w.eval(await readFile(new URL("i18n/en.js", root), "utf8"));
  for (const file of ["localization.js", "icons.js", "validation-mk.js", "dates.js"]) w.eval(await readFile(new URL("js/" + file, root), "utf8"));
  const source = doc.querySelector("#day"), visible = doc.querySelector("#day-display"), form = doc.querySelector("form");
  let changes = 0; source.addEventListener("change", () => changes++);
  const enter = value => { visible.value = value; visible.dispatchEvent(new w.Event("input", { bubbles: true })); };
  const valid = () => visible.checkValidity() && source.checkValidity();
  check(visible.value === "29.02.2000" && source.value === "2000-02-29", lang + " initial date is day-first with unchanged ISO value");
  check(doc.querySelector("label").htmlFor === visible.id && !visible.name, lang + " label targets editable date and mirror has no submitted name");
  enter("31022027"); check(visible.value === "31.02.2027" && !valid() && source.value === "", lang + " invalid month-day combination cannot retain a previous date");
  enter("29022027"); check(!valid(), lang + " non-leap-year February 29 is rejected");
  enter("29022028"); check(valid() && source.value === "2028-02-29", lang + " leap date and punctuation-free phone entry work");
  check(changes === 0, lang + " typing never refreshes a screen before the date is committed");
  visible.dispatchEvent(new w.Event("change", { bubbles: true }));
  check(changes === 1, lang + " committing a valid date emits one application change");
  visible.value = "1.03.2026"; visible.setSelectionRange(1, 1); visible.dispatchEvent(new w.Event("input", { bubbles: true }));
  check(visible.value === "1.03.2026" && !valid(), lang + " editing a day in the middle does not shift the month or year");
  enter("02/03/2026"); check(!valid() && source.value === "", lang + " ambiguous slash format is rejected");
  enter(""); check(!valid() && !w.MedTerminDates.validate(form), lang + " required date blocks forms and non-form booking review");
  source.min = "2026-03-01"; source.max = "2026-03-31";
  await new Promise(r => w.setTimeout(r, 0));
  enter("28022026"); check(!valid(), lang + " date before minimum is rejected");
  enter("01032026"); check(valid() && source.value === "2026-03-01", lang + " minimum date is inclusive");
  enter("31032026"); check(valid() && source.value === "2026-03-31", lang + " maximum date is inclusive");
  enter("01042026"); check(!valid(), lang + " date after maximum is rejected");
  check(visible.validationMessage.includes("31.03.2026") && visible.validationMessage.startsWith(lang === "en" ? "Choose" : "Изберете"), lang + " localized range error uses day-first boundary");
  source.value = "2026-03-12"; source.dispatchEvent(new w.Event("input", { bubbles: true })); source.dispatchEvent(new w.Event("change", { bubbles: true }));
  check(visible.value === "12.03.2026" && valid(), lang + " native calendar selection updates visible date and validity");
  const values = [...new w.FormData(form)]; check(values.length === 1 && values[0][0] === "date" && values[0][1] === "2026-03-12", lang + " form submits exactly one original ISO date");
  source.disabled = true; await new Promise(r => w.setTimeout(r, 0));
  check(visible.disabled && w.MedTerminDates.validate(form), lang + " disabled dates stay disabled and do not block validation");
  source.disabled = false; source.min = "1999-01-01"; source.max = "2030-12-31"; form.reset(); await new Promise(r => w.setTimeout(r, 0));
  check(visible.value === "29.02.2000" && source.value === "2000-02-29", lang + " reset restores both representations");
  form.insertAdjacentHTML("beforeend", '<label>Optional<input type="date" name="optional"></label>'); await new Promise(r => w.setTimeout(r, 0));
  check(form.querySelectorAll(".localized-date").length === 2 && w.MedTerminDates.validate(form), lang + " dynamic optional dates are enhanced without becoming required");
  form.append(doc.createElement("span")); await new Promise(r => w.setTimeout(r, 0));
  check(form.querySelectorAll(".localized-date").length === 2, lang + " mutation handling never duplicates controls");
  dom.window.close();
}
console.log(`${checks}/${checks} date control checks passed.`);
