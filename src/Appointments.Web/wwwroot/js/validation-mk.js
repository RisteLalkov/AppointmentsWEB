(() => {
"use strict";
const { t: tr, html, locale } = window.MedTerminI18n;
const icon = window.MedTerminIcons.icon;
// Translate native constraint-validation messages, including dynamically added forms.
// Localized date controls own their strict format/range validation.
(() => {
  document.addEventListener("invalid", (event) => {
    const field = event.target;
    if (field.closest?.(".localized-date")) return;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
    field.setCustomValidity("");
    const validity = field.validity;
    let message = tr("Проверете ја внесената вредност.");
    if (validity.valueMissing) message = tr("Пополнете го ова задолжително поле.");
    else if (validity.typeMismatch && field.type === "email") message = tr("Внесете важечка адреса за е-пошта.");
    else if (validity.tooShort) message = html`Внесете најмалку ${field.minLength} знаци.`;
    else if (validity.tooLong) message = html`Внесете најмногу ${field.maxLength} знаци.`;
    else if (validity.rangeUnderflow) message = tr("Вредноста е пред или под дозволениот минимум.");
    else if (validity.rangeOverflow) message = tr("Вредноста е по или над дозволениот максимум.");
    else if (validity.stepMismatch) message = tr("Изберете вредност во дозволените чекори.");
    else if (validity.badInput) message = tr("Внесете важечка вредност.");
    field.setCustomValidity(message);
  }, true);
  for (const name of ["input", "change"]) {
    document.addEventListener(name, (event) => {
      if (!event.target.closest?.(".localized-date") && typeof event.target.setCustomValidity === "function") event.target.setCustomValidity("");
    });
  }
})();

})();
