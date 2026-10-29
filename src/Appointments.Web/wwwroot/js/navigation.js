// Back/Forward can restore a document without contacting the server, even with no-store.
// Revisit it with GET so current authentication and permissions decide what is displayed.
window.addEventListener("pageshow", event => {
  if (event.persisted) window.location.replace(window.location.href);
});
