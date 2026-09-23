"use strict";
// Translate native constraint-validation messages, including dynamically added forms.
// Date/time input widgets themselves follow the browser/operating-system language.
(() => {
  document.addEventListener("invalid", (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
    field.setCustomValidity("");
    const validity = field.validity;
    let message = "Проверете ја внесената вредност.";
    if (validity.valueMissing) message = "Пополнете го ова задолжително поле.";
    else if (validity.typeMismatch && field.type === "email") message = "Внесете важечка адреса за е-пошта.";
    else if (validity.tooShort) message = `Внесете најмалку ${field.minLength} знаци.`;
    else if (validity.tooLong) message = `Внесете најмногу ${field.maxLength} знаци.`;
    else if (validity.rangeUnderflow) message = "Вредноста е пред или под дозволениот минимум.";
    else if (validity.rangeOverflow) message = "Вредноста е по или над дозволениот максимум.";
    else if (validity.stepMismatch) message = "Изберете вредност во дозволените чекори.";
    else if (validity.badInput) message = "Внесете важечка вредност.";
    field.setCustomValidity(message);
  }, true);
  for (const name of ["input", "change"]) {
    document.addEventListener(name, (event) => {
      if (typeof event.target.setCustomValidity === "function") event.target.setCustomValidity("");
    });
  }
})();
