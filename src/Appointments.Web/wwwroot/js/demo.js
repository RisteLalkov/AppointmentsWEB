"use strict";
const users = [...document.querySelectorAll("#demo-user option")].map((o) => ({
  value: o.value,
  text: o.textContent,
  role: o.dataset.role,
}));
const descriptions = {
  Patient:
    "Пронајдете лекар, изберете термин и следете ги сите закажувања на едно место.",
  Administrator:
    "Организирајте го целиот ден. Пронајдете пациенти, закажете прегледи и управувајте со распоредите на лекарите.",
  Doctor:
    "Јасен преглед на вашиот ден, со сите термини и достапни периоди на едно место.",
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
