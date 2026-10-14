"use strict";
document.querySelectorAll('[data-prevent-duplicate]').forEach(form => {
  form.addEventListener('submit', event => {
    if (form.dataset.submitted) { event.preventDefault(); return; }
    form.dataset.submitted = 'true';
    form.querySelector('[type="submit"]').disabled = true;
    form.querySelector('[data-submit-status]').textContent = 'Се подготвува клиниката. Почекајте потврда пред повторување.';
  });
});
window.addEventListener('pageshow', () => document.querySelectorAll('[data-prevent-duplicate]').forEach(form => {
  delete form.dataset.submitted;
  form.querySelector('[type="submit"]').disabled = false;
}));
