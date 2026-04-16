// ============================================================
// contacts.js — Schools + Contacts screen
// ============================================================

import { getSchools } from "../api/api.js";
import { showLoading, showError, showEmpty, escapeHtml } from "../shared/utils.js";
import { buildFilterBar, attachFilterListeners } from "../shared/filters.js";

let currentFilters = {};

export async function render(container, user) {
  container.innerHTML = `<div id="contacts-filters-wrap"></div><div id="contacts-content"></div>`;
  await loadContacts(container, user);
}

async function loadContacts(container, user) {
  const content = container.querySelector("#contacts-content");
  showLoading(content);

  try {
    const res = await getSchools();
    const schools = res.schools ?? [];

    const filtersWrap = container.querySelector("#contacts-filters-wrap");
    if (!filtersWrap.hasChildNodes()) {
      buildFilters(filtersWrap, schools, container, user);
    }

    renderTable(content, schools);
  } catch {
    showError(content);
  }
}

function buildFilters(wrap, schools, container, user) {
  const authorityOpts = [...new Set(schools.map((s) => s.authority).filter(Boolean))].sort()
    .map((v) => ({ value: v, label: v }));

  const fields = [
    { id: "authority", label: "רשות", type: "select", options: authorityOpts },
    { id: "active",    label: "פעיל", type: "select", options: [{ value: "yes", label: "פעיל" }, { value: "no", label: "לא פעיל" }] },
    { id: "q",         label: "חיפוש",type: "text" },
  ];

  wrap.innerHTML = buildFilterBar(fields, currentFilters);
  attachFilterListeners(wrap, (f) => { currentFilters = f; loadContacts(container, user); });
}

function renderTable(el, schools) {
  if (!schools.length) { showEmpty(el); return; }

  el.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>רשות</th>
              <th>בית ספר</th>
              <th>איש קשר</th>
              <th>תפקיד</th>
              <th>טלפון</th>
              <th>נייד</th>
              <th>מייל</th>
            </tr>
          </thead>
          <tbody>
            ${schools.map((s) => schoolRowHtml(s)).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}

function schoolRowHtml(s) {
  return `
    <tr>
      <td>${escapeHtml(s.authority)}</td>
      <td>${escapeHtml(s.school)}</td>
      <td>${escapeHtml(s.contact_name ?? "—")}</td>
      <td>${escapeHtml(s.contact_role ?? "—")}</td>
      <td><a href="tel:${escapeHtml(s.phone ?? "")}">${escapeHtml(s.phone ?? "—")}</a></td>
      <td><a href="tel:${escapeHtml(s.mobile ?? "")}">${escapeHtml(s.mobile ?? "—")}</a></td>
      <td><a href="mailto:${escapeHtml(s.email ?? "")}">${escapeHtml(s.email ?? "—")}</a></td>
    </tr>`;
}
