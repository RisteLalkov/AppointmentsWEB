"use strict";
const users = [...document.querySelectorAll("#demo-user option")].map((o) => ({
  value: o.value,
  text: o.textContent,
  role: o.dataset.role,
}));
const descriptions = {
  Patient:
    "Find your doctor, choose a time, and keep every appointment in one place.",
  Administrator:
    "Coordinate the whole day. Find patients, book visits, and manage every doctor’s schedule.",
  Doctor:
    "A clear view of your day, with your appointments and availability together.",
};
document
  .querySelectorAll("[data-role].role-tabs button, .role-tabs button")
  .forEach((button) =>
    button.addEventListener("click", () => choose(button.dataset.role)),
  );
function choose(role) {
  document.querySelectorAll(".role-tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.role === role);
    b.setAttribute("aria-pressed", String(b.dataset.role === role));
  });
  const select = document.querySelector("#demo-user");
  select.replaceChildren(
    ...users
      .filter((u) => u.role === role)
      .map((u) => new Option(u.text, u.value)),
  );
  document.querySelector("#role-description").textContent = descriptions[role];
}
choose("Patient");
