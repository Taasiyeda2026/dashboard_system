// ============================================================
// week.js — Weekly calendar view
// ============================================================

import { getWeekData, getInstructors } from "../api/api.js";
import { showLoading, showError, formatDate, escapeHtml, getWeekRange } from "../shared/utils.js";
import { buildFilterBar, attachFilterListeners, readFilters } from "../shared/filters.js";
import { openActivityDrawer } from "../components/activity-drawer.js";
import { ACTIVITY_TYPES } from "../config/config.js";

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

let weekOffset = 0;
let currentFilters = {};

export async function render(container, user) {
  container.innerHTML = buildShell();
  attachNav(container, user);
  await loadWeek(container, user);
}

function buildShell() {
  return `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <button class="btn btn--secondary btn--sm" id="week-prev">‹ הקודם</button>
        <span id="week-range-label" style="font-size:.88rem; color:var(--panel-text-mute);"></span>
        <button class="btn btn--secondary btn--sm" id="week-next">הבא ›</button>
      </div>
      <button class="btn btn--sm" id="week-today" style="color:var(--shell-accent);">השבוע</button>
    </div>
    <div id="week-filters-wrap"></div>
    <div id="week-grid-wrap"></div>`;
}

function attachNav(container, user) {
  container.querySelector("#week-prev").addEventListener("click", () => { weekOffset--; loadWeek(container, user); });
  container.querySelector("#week-next").addEventListener("click", () => { weekOffset++; loadWeek(container, user); });
  container.querySelector("#week-today").addEventListener("click", () => { weekOffset = 0; loadWeek(container, user); });
}

async function loadWeek(container, user) {
  const grid = container.querySelector("#week-grid-wrap");
  showLoading(grid, "טוען שבוע...");

  const { from, to } = getWeekRange(weekOffset);
  container.querySelector("#week-range-label").textContent = `${formatDate(from)} – ${formatDate(to)}`;

  try {
    const [res, instrRes] = await Promise.all([
      getWeekData(from, to, currentFilters),
      getInstructors(),
    ]);

    // Build filters once
    const filtersWrap = container.querySelector("#week-filters-wrap");
    if (!filtersWrap.hasChildNodes()) {
      buildFilters(filtersWrap, instrRes.instructors ?? [], container, user);
    }

    renderGrid(grid, from, res.days ?? {});
  } catch {
    showError(grid);
  }
}

function buildFilters(wrap, instructors, container, user) {
  const instrOpts    = instructors.map((i) => ({ value: i.full_name, label: i.full_name }));
  const typeOpts     = ACTIVITY_TYPES.filter((t) => t.value !== "all");

  const fields = [
    { id: "instructor_name",  label: "מדריך",       type: "select", options: instrOpts },
    { id: "activity_type",    label: "סוג פעילות",  type: "select", options: typeOpts },
    { id: "activity_manager", label: "מנהל פעילות", type: "text" },
  ];

  wrap.innerHTML = buildFilterBar(fields, currentFilters);
  attachFilterListeners(wrap, (f) => { currentFilters = f; loadWeek(container, user); });
}

function renderGrid(el, from, days) {
  const fromDate = new Date(from);
  const todayStr = new Date().toISOString().slice(0, 10);

  const cols = DAY_NAMES.map((name, i) => {
    const d = new Date(fromDate);
    d.setDate(fromDate.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const isToday = iso === todayStr;
    const events = days[iso] ?? [];

    return `
      <div class="week-day ${isToday ? "today" : ""}">
        <div class="week-day__header">${name}<br><span style="font-size:.7rem;">${d.getDate()}/${d.getMonth() + 1}</span></div>
        ${events.map((ev) => eventHtml(ev)).join("")}
      </div>`;
  }).join("");

  el.innerHTML = `<div class="week-grid">${cols}</div>`;

  el.querySelectorAll(".week-event").forEach((evEl) => {
    evEl.addEventListener("click", () => {
      const sheet = evEl.dataset.rowid.startsWith("LONG-") ? "data_long" : "data_short";
      openActivityDrawer(sheet, evEl.dataset.rowid);
    });
  });
}

function eventHtml(ev) {
  return `<div class="week-event" data-rowid="${escapeHtml(ev.RowID)}" title="${escapeHtml(ev.activity_name)}">
    ${escapeHtml(ev.activity_name)}
  </div>`;
}
