'use strict';
// Search remains plain GET navigation and works without JavaScript.
(() => {
    const art = document.querySelector('[data-discovery-art]');
    const toggle = document.querySelector('[data-motion-toggle]');
    if (!art || !toggle) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let paused = false;
    try { paused = sessionStorage.getItem('careline.discovery.paused') === 'true'; } catch { /* Storage may be disabled. */ }
    function render() {
        art.classList.toggle('motion-enabled', !preference.matches);
        art.classList.toggle('motion-paused', paused);
        toggle.hidden = preference.matches;
        toggle.setAttribute('aria-pressed', String(paused));
        toggle.textContent = paused ? 'Продолжи анимација' : 'Паузирај анимација';
    }
    toggle.addEventListener('click', () => {
        paused = !paused;
        try { sessionStorage.setItem('careline.discovery.paused', String(paused)); } catch { /* Optional preference only. */ }
        render();
    });
    preference.addEventListener('change', render);
    render();
})();
