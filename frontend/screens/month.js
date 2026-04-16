// ============================================================
// month.js — Monthly calendar view
// ============================================================

import { getMonthData, getInstructors } from "../api/api.js";
import { showLoading, showError, escapeHtml } from "../shared/utils.js";
import { buildFilterBar, attachFilterListeners } from "../shared/filters.js";
import { openActivityDrawer } from "../components/activity-drawer.js";
import { ACTIVITY_TYPES } from "../config/config.js";

const MONTH_NAMES = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
const DAY_HEADERS = ["א","ב","ג","ד","ה","ו","ש"];

let curYear  = new Date().getFullYear();
let curMonth = new Date().getMonth() + 1;
let currentFilters = {};

export async function render(container, user) {
  container.innerHTML = buildShell();
  attachNav(container, user);
  await loadMonth(container, user);
}

function buildShell() {
  return `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <button class="btn btn--secondary btn--sm" id="month-prev">‹</button>
        <span id="month-label" style="font-size:1rem; font-weight:600; color:var(--panel-text); min-width:120px; text-align:center;"></span>
        <button class="btn btn--secondary btn--sm" id="month-next">›</button>
      </div>
      <button class="btn btn--sm" id="month-today" style="color:var(--shell-accent);">החודש</button>
    </div>
    <div id="month-filters-wrap"></div>
    <div id="month-cal-wrap"></div>`;
}

function attachNav(container, user) {
  container.querySelector("#month-prev").addEventListener("click", () => {
    if (--curMonth < 1) { curMonth = 12; curYear--; }
    loadMonth(container, user);
  });
  container.querySelector("#month-next").addEventListener("click", () => {
    if (++curMonth > 12) { curMonth = 1; curYear++; }
    loadMonth(container, user);
  });
  container.querySelector("#month-today").addEventListener("click", () => {
    curYear = new Date().getFullYear();
    curMonth = new Date().getMonth() + 1;
    loadMonth(container, user);
  });
}

async function loadMonth(container, user) {
  const cal = container.querySelector("#month-cal-wrap");
  showLoading(cal, "טוען חודש...");
  container.querySelector("#month-label").textContent = `${MONTH_NAMES[curMonth - 1]} ${curYear}`;

  try {
    const [res, instrRes] = await Promise.all([
      getMonthData(curYear, curMonth, currentFilters),
      getInstructors(),
    ]);

    const filtersWrap = container.querySelector("#month-filters-wrap");
    if (!filtersWrap.hasChildNodes()) {
      buildFilters(filtersWrap, instrRes.instructors ?? [], container, user);
    }

    renderCalendar(cal, res.days ?? {});
  } catch {
    showError(cal);
  }
}

function buildFilters(wrap, instructors, container, user) {
  const instrOpts = instructors.map((i) => ({ value: i.full_name, label: i.full_name }));
  const typeOpts  = ACTIVITY_TYPES.filter((t) => t.value !== "all");
  const fields = [
    { id: "instructor_name",  label: "מדריך",       type: "select", options: instrOpts },
    { id: "activity_type",    label: "סוג פעילות",  type: "select", options: typeOpts },
    { id: "activity_manager", label: "מנהל פעילות", type: "text" },
  ];
  wrap.innerHTML = buildFilterBar(fields, currentFilters);
  attachFilterListeners(wrap, (f) => { currentFilters = f; loadMonth(container, user); });
}

function renderCalendar(el, days) {
  const today = new Date().toISOString().slice(0, 10);
  const firstDay = new Date(curYear, curMonth - 1, 1).getDay();
  const daysInMonth = new Date(curYear, curMonth, 0).getDate();
  const daysInPrev  = new Date(curYear, curMonth - 1, 0).getDate();

  let cells = "";

  // Header
  cells += DAY_HEADERS.map((h) => `<div style="text-align:center; font-size:.75rem; font-weight:700; color:var(--panel-text-mute); padding:4px 0;">${h}</div>`).join("");

  // Pre-fill
  for (let i = 0; i < firstDay; i++) {
    const d = daysInPrev - firstDay + i + 1;
    cells += `<div class="month-day other-month"><div class="month-day__num">${d}</div></div>`;
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${curYear}-${String(curMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isToday = iso === today;
    const events  = days[iso] ?? [];
    const numEl   = isToday
      ? `<div class="month-day__num today">${d}</div>`
      : `<div class="month-day__num">${d}</div>`;

    const evHtml = events.slice(0, 3).map((ev) =>
      `<div class="month-event" data-rowid="${escapeHtml(ev.RowID)}">${escapeHtml(ev.activity_name)}</div>`
    ).join("") + (events.length > 3 ? `<div style="font-size:.65rem; color:var(--panel-text-mute);">+${events.length - 3} נוספות</div>` : "");

    cells += `<div class="month-day ${isToday ? "today" : ""}">${numEl}${evHtml}</div>`;
  }

  // Post-fill
  const total = firstDay + daysInMonth;
  const remaining = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 1; i <= remaining; i++) {
    cells += `<div class="month-day other-month"><div class="month-day__num">${i}</div></div>`;
  }

  el.innerHTML = `<div class="month-grid">${cells}</div>`;

  el.querySelectorAll(".month-event").forEach((evEl) => {
    evEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const sheet = evEl.dataset.rowid.startsWith("LONG-") ? "data_long" : "data_short";
      openActivityDrawer(sheet, evEl.dataset.rowid);
    });
  });
}
