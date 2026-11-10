(() => {
"use strict";
const { t: tr, html, locale } = window.MedTerminI18n;
const icon = window.MedTerminIcons.icon;
(() => {
    const form = document.querySelector('#account-create-form');
    if (!form) return;
    const role = form.querySelector('#role');
    const help = form.querySelector('#account-role-help');
    const messages = {
        Doctor: tr("Поврзете ја сметката со постоечки лекарски профил."),
        Administrator: tr("Администраторот управува со рецепцијата. Не е потребен пациентски или лекарски профил.")
    };
    function update() {
        form.querySelectorAll('[data-account-profile]').forEach(field => {
            const active = field.dataset.accountProfile === role.value;
            const select = field.querySelector('select');
            field.hidden = !active;
            select.disabled = !active;
            select.required = active;
            if (!active) select.value = '';
        });
        help.textContent = messages[role.value] || '';
    }
    role.addEventListener('change', update);
    // Restore correct state after back/forward navigation and browser form restoration.
    window.addEventListener('pageshow', update);
    form.addEventListener('reset', () => queueMicrotask(update));
    update();
})();

})();
