'use strict';
// Search remains plain GET navigation and works without JavaScript.
(() => {
    const art = document.querySelector('[data-discovery-art]');
    const toggle = document.querySelector('[data-motion-toggle]');
    if (!art || !toggle) return;
    const page = document.querySelector('.discovery-page');
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let paused = false;
    try { paused = sessionStorage.getItem('careline.discovery.paused') === 'true'; } catch { /* Storage may be disabled. */ }
    let frame = 0;
    function paintScroll() {
        frame = 0;
        if (!page || paused || preference.matches) return;
        const rect = page.getBoundingClientRect();
        const progress = Math.min(1, Math.max(.12, (window.innerHeight - rect.top) / rect.height));
        page.style.setProperty('--ribbon-progress', progress.toFixed(4));
    }
    function queueScroll() {
        if (!frame && !paused && !preference.matches) frame = requestAnimationFrame(paintScroll);
    }
    window.addEventListener('scroll', queueScroll, { passive: true });
    window.addEventListener('resize', queueScroll, { passive: true });
    function render() {
        page?.classList.toggle('discovery-motion', !preference.matches);
        page?.classList.toggle('discovery-paused', paused);
        art.classList.toggle('motion-enabled', !preference.matches);
        art.classList.toggle('motion-paused', paused);
        toggle.hidden = preference.matches;
        toggle.setAttribute('aria-pressed', String(paused));
        toggle.textContent = paused ? 'Продолжи анимација' : 'Паузирај анимација';
        queueScroll();
    }
    toggle.addEventListener('click', () => {
        paused = !paused;
        try { sessionStorage.setItem('careline.discovery.paused', String(paused)); } catch { /* Optional preference only. */ }
        render();
    });
    preference.addEventListener('change', render);
    render();
    // Cards are always visible without JS; animation only runs as they enter view.
    if ('IntersectionObserver' in window && page) {
        const observer = new IntersectionObserver(entries => {
            for (const entry of entries) if (entry.isIntersecting) {
                if (!preference.matches && !paused) entry.target.classList.add('is-arriving');
                observer.unobserve(entry.target);
            }
        }, { threshold: .08 });
        page.querySelectorAll('.discovery-card').forEach(card => observer.observe(card));
    }
})();
