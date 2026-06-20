import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';
import {
  getActivityName,
  activityMatchesPeriod,
  activityOverlapsDateRange,
  isActivityDeleted
} from './shared/operations-activity-helpers.js';
import { ACTIVITY_SEASON_SUMMER_2026 } from './shared/summer-activity.js';

const SUMMER_TRAINING_TAB_KEY = 'summer-training';
const STORAGE_KEY = 'operationsSummerTrainingTabActive';
const SUMMER_FROM = '2026-06-15';
const SUMMER_TO = '2026-09-01';

let isRendering = false;
let syncQueued = false;
let latestRenderToken = 0;

function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/[״"]/g, '')
    .replace(/[׳']/g, '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function pairKey(workshopName, instructorName) {
  return `${normalizeText(workshopName)}|${normalizeText(instructorName)}`;
}

function isValidInstructorName(name) {
  const value = String(name || '').trim();
  return Boolean(value) && value !== 'לא משויך' && value !== 'ללא שיוך' && value !== '-';
}

function uniqueSorted(values) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'he', { numeric: true }));
}

function getSystemWorkshopName(activity = {}) {
  return String(getActivityName(activity) || activity.activity_name || activity.name || activity.title || '').trim();
}

function getSystemInstructorNames(activity = {}) {
  return uniqueSorted([
    activity?.instructor_name,
    activity?.instructor_name_2
  ].filter(isValidInstructorName));
}

function addToNestedCount(map, workshopName, instructorName) {
  const workshopKey = normalizeText(workshopName);
  const instructorKey = normalizeText(instructorName);
  if (!workshopKey || !instructorKey) return;
  if (!map.has(workshopKey)) map.set(workshopKey, new Map());
  const instructors = map.get(workshopKey);
  instructors.set(instructorKey, (instructors.get(instructorKey) || 0) + 1);
}

function setSummerTrainingActive(root, active) {
  const nav = root?.querySelector?.('.ds-ops-mgmt-tabs');
  if (!nav) return;
  nav.querySelectorAll('.ds-ops-mgmt-tab').forEach((btn) => {
    const isSummerButton = btn.getAttribute('data-ops-summer-training-tab') === SUMMER_TRAINING_TAB_KEY;
    const shouldBeActive = active && isSummerButton;
    if (isSummerButton || active) {
      btn.classList.toggle('is-active', shouldBeActive);
      btn.setAttribute('aria-pressed', shouldBeActive ? 'true' : 'false');
    }
  });
}

function ensureSummerTrainingStyle() {
  if (document.getElementById('ds-ops-summer-training-style')) return;
  const style = document.createElement('style');
  style.id = 'ds-ops-summer-training-style';
  style.textContent = `
    .ds-ops-training-card{border:1px solid #d8e5ee;border-radius:16px;background:#fff;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.04)}
    .ds-ops-training-header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;background:#f8fbfd;border-bottom:1px solid #e2e8f0}
    .ds-ops-training-title{font-size:18px;font-weight:800;color:#0f172a;margin:0}
    .ds-ops-training-subtitle{font-size:12px;color:#64748b;margin:3px 0 0}
    .ds-ops-training-summary{display:flex;flex-wrap:wrap;gap:8px;padding:10px 16px;border-bottom:1px solid #e2e8f0;background:#fff}
    .ds-ops-training-pill{display:inline-flex;align-items:center;border-radius:999px;border:1px solid #dbe7ef;background:#f8fbfd;color:#334155;padding:3px 9px;font-size:12px;font-weight:700;white-space:nowrap}
    .ds-ops-training-pill--warn{background:#fff7ed;border-color:#fed7aa;color:#9a3412}
    .ds-ops-training-pill--ok{background:#ecfdf5;border-color:#bbf7d0;color:#166534}
    .ds-ops-training-wrap{width:100%;overflow:auto;background:#fff}
    .ds-ops-training-table{border-collapse:collapse;width:max-content;min-width:100%;table-layout:fixed;font-size:13px;direction:rtl}
    .ds-ops-training-table th,.ds-ops-training-table td{border:1px solid #111827;padding:5px 7px;text-align:center;vertical-align:middle;min-width:118px;height:34px;background:#fff}
    .ds-ops-training-table th{background:#f8fafc;color:#111827;font-weight:800;position:sticky;top:0;z-index:2}
    .ds-ops-training-table th:first-child,.ds-ops-training-table td:first-child{position:sticky;right:0;z-index:3;min-width:260px;max-width:320px;text-align:right;font-weight:800;background:#fff}
    .ds-ops-training-table th:first-child{z-index:4;background:#f8fafc}
    .ds-ops-training-table tr:nth-child(odd) td:first-child{background:#fffbeb}
    .ds-ops-training-symbol{font-size:24px;line-height:1;font-weight:900;display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px}
    .ds-ops-training-symbol--ok{color:#16a34a}
    .ds-ops-training-symbol--warn{color:#ef4444}
    .ds-ops-training-count{display:block;margin-top:1px;font-size:10px;color:#64748b;font-weight:600}
    .ds-ops-training-legend{display:flex;gap:12px;flex-wrap:wrap;padding:10px 16px;color:#475569;font-size:12px;border-top:1px solid #e2e8f0;background:#f8fbfd}
    .ds-ops-training-error,.ds-ops-training-loading{padding:20px 16px;color:#475569;font-weight:700;text-align:center}
    .ds-ops-training-error{color:#b91c1c;background:#fef2f2}
  `;
  document.head.appendChild(style);
}

function dateRangeFromDom(root) {
  const from = root?.querySelector?.('[data-ops-date="from"]')?.value || SUMMER_FROM;
  const to = root?.querySelector?.('[data-ops-date="to"]')?.value || SUMMER_TO;
  return {
    from: from < SUMMER_FROM ? SUMMER_FROM : from,
    to: to > SUMMER_TO ? SUMMER_TO : to
  };
}

async function readTrainingRows() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('summer_workshop_trainings')
    .select('workshop_name,instructor_name,is_trained')
    .eq('is_trained', true);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function readSummerActivities(from, to) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('activities').select('*');
  if (error) throw error;
  return (Array.isArray(data) ? data : [])
    .filter((row) => !isActivityDeleted(row))
    .filter((row) => {
      const status = String(row?.status || '').trim();
      return !['בוטל', 'מבוטל', 'נמחק'].includes(status);
    })
    .filter((row) => activityMatchesPeriod(row, ACTIVITY_SEASON_SUMMER_2026))
    .filter((row) => activityOverlapsDateRange(row, from, to));
}

function buildTrainingSet(trainingRows) {
  const trained = new Set();
  (Array.isArray(trainingRows) ? trainingRows : []).forEach((row) => {
    if (row?.is_trained === false) return;
    const workshop = String(row?.workshop_name || '').trim();
    const instructor = String(row?.instructor_name || '').trim();
    if (!workshop || !isValidInstructorName(instructor)) return;
    trained.add(pairKey(workshop, instructor));
  });
  return trained;
}

function buildMatrix({ activities, trainingRows }) {
  const trained = buildTrainingSet(trainingRows);
  const assigned = new Map();
  const systemWorkshops = [];
  const systemInstructors = [];
  const trainingWorkshops = [];
  const trainingInstructors = [];

  activities.forEach((activity) => {
    const workshop = getSystemWorkshopName(activity);
    if (!workshop) return;
    const instructors = getSystemInstructorNames(activity);
    if (!instructors.length) return;
    systemWorkshops.push(workshop);
    instructors.forEach((instructor) => {
      addToNestedCount(assigned, workshop, instructor);
      systemInstructors.push(instructor);
    });
  });

  (Array.isArray(trainingRows) ? trainingRows : []).forEach((row) => {
    if (row?.is_trained === false) return;
    const workshop = String(row?.workshop_name || '').trim();
    const instructor = String(row?.instructor_name || '').trim();
    if (workshop) trainingWorkshops.push(workshop);
    if (isValidInstructorName(instructor)) trainingInstructors.push(instructor);
  });

  const workshops = uniqueSorted([...systemWorkshops, ...trainingWorkshops]);
  const instructors = uniqueSorted([...systemInstructors, ...trainingInstructors]);

  let okPairCount = 0;
  let warningPairCount = 0;
  let assignedCount = 0;
  let assignedPairCount = 0;

  const rows = workshops.map((workshop) => {
    const assignedInstructors = assigned.get(normalizeText(workshop)) || new Map();
    const cells = instructors.map((instructor) => {
      const count = assignedInstructors.get(normalizeText(instructor)) || 0;
      if (!count) return { status: 'empty', count: 0 };
      assignedCount += count;
      assignedPairCount += 1;
      const hasTraining = trained.has(pairKey(workshop, instructor));
      if (hasTraining) okPairCount += 1;
      else warningPairCount += 1;
      return { status: hasTraining ? 'ok' : 'warning', count };
    });
    return { workshop, cells };
  });

  return {
    workshops,
    instructors,
    rows,
    okPairCount,
    warningPairCount,
    assignedPairCount,
    assignedCount,
    trainingPairCount: trained.size
  };
}

function statusCellHtml(cell, workshop, instructor) {
  if (!cell || cell.status === 'empty') return '<td></td>';
  if (cell.status === 'ok') {
    const title = `${workshop} — ${instructor}: משובץ וקיבל הכשרה`;
    return `<td title="${escapeHtml(title)}"><span class="ds-ops-training-symbol ds-ops-training-symbol--ok">✓</span>${cell.count > 1 ? `<span class="ds-ops-training-count">${cell.count} שיבוצים</span>` : ''}</td>`;
  }
  const title = `${workshop} — ${instructor}: משובץ ללא הכשרה`;
  return `<td title="${escapeHtml(title)}"><span class="ds-ops-training-symbol ds-ops-training-symbol--warn">!</span>${cell.count > 1 ? `<span class="ds-ops-training-count">${cell.count} שיבוצים</span>` : ''}</td>`;
}

function matrixHtml(matrix, from, to) {
  const header = `<tr><th>סדנה</th>${matrix.instructors.map((name) => `<th>${escapeHtml(name)}</th>`).join('')}</tr>`;
  const body = matrix.rows.map((row) => `<tr><td>${escapeHtml(row.workshop)}</td>${row.cells.map((cell, index) => statusCellHtml(cell, row.workshop, matrix.instructors[index])).join('')}</tr>`).join('');
  return `<section class="ds-ops-mgmt-panel ds-ops-training-panel" dir="rtl">
    <div class="ds-ops-training-card">
      <header class="ds-ops-training-header">
        <div>
          <h2 class="ds-ops-training-title">הכשרות קיץ</h2>
          <p class="ds-ops-training-subtitle">סטטוס הכשרה לפי שיבוץ בפועל. שמות הסדנאות והמדריכים נלקחים מהמערכת. טווח: ${escapeHtml(from)} עד ${escapeHtml(to)}</p>
        </div>
      </header>
      <div class="ds-ops-training-summary">
        <span class="ds-ops-training-pill">${matrix.assignedCount} שיבוצים שנבדקו</span>
        <span class="ds-ops-training-pill">${matrix.assignedPairCount} צמדי מדריך-סדנה</span>
        <span class="ds-ops-training-pill ds-ops-training-pill--ok">${matrix.okPairCount} צמדים עם הכשרה</span>
        <span class="ds-ops-training-pill ds-ops-training-pill--warn">${matrix.warningPairCount} צמדים ללא הכשרה</span>
        <span class="ds-ops-training-pill">${matrix.trainingPairCount} רשומות הכשרה מאחורי הקלעים</span>
      </div>
      <div class="ds-ops-training-wrap">
        <table class="ds-ops-training-table" aria-label="טבלת סטטוס הכשרות קיץ">
          <thead>${header}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <div class="ds-ops-training-legend">
        <span><strong class="ds-ops-training-symbol ds-ops-training-symbol--ok">✓</strong> משובץ וקיבל הכשרה</span>
        <span><strong class="ds-ops-training-symbol ds-ops-training-symbol--warn">!</strong> משובץ ללא הכשרה</span>
        <span>תא ריק = אין שיבוץ בטווח התאריכים</span>
      </div>
    </div>
  </section>`;
}

async function renderSummerTraining(root) {
  if (!root || isRendering) return;
  const content = root.querySelector('.ds-ops-mgmt-content');
  if (!content) return;
  const token = ++latestRenderToken;
  isRendering = true;
  ensureSummerTrainingStyle();
  setSummerTrainingActive(root, true);
  const { from, to } = dateRangeFromDom(root);
  content.innerHTML = '<div class="ds-ops-training-card"><div class="ds-ops-training-loading">טוען סטטוס הכשרות קיץ...</div></div>';
  try {
    const [activities, trainingRows] = await Promise.all([
      readSummerActivities(from, to),
      readTrainingRows()
    ]);
    if (token !== latestRenderToken) return;
    const matrix = buildMatrix({ activities, trainingRows });
    content.innerHTML = matrixHtml(matrix, from, to);
  } catch (error) {
    console.warn('[operations-summer-training] failed to render', error?.message || error);
    if (token !== latestRenderToken) return;
    content.innerHTML = `<div class="ds-ops-training-card"><div class="ds-ops-training-error">לא ניתן לטעון את נתוני הכשרות הקיץ כרגע. ${escapeHtml(error?.message || '')}</div></div>`;
  } finally {
    isRendering = false;
  }
}

function ensureSummerTrainingTab(root) {
  const nav = root?.querySelector?.('.ds-ops-mgmt-tabs');
  if (!nav || nav.querySelector('[data-ops-summer-training-tab]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ds-exceptions-tab ds-ops-mgmt-tab';
  button.setAttribute('data-ops-summer-training-tab', SUMMER_TRAINING_TAB_KEY);
  button.setAttribute('aria-pressed', 'false');
  button.textContent = 'הכשרות קיץ';
  button.addEventListener('click', () => {
    sessionStorage.setItem(STORAGE_KEY, '1');
    renderSummerTraining(root);
  });
  nav.appendChild(button);

  nav.querySelectorAll('[data-ops-tab]').forEach((existingButton) => {
    existingButton.addEventListener('click', () => sessionStorage.removeItem(STORAGE_KEY), { capture: true });
  });
}

function syncSummerTrainingTab() {
  const root = document.querySelector('.ds-ops-mgmt-screen');
  if (!root) return;
  ensureSummerTrainingTab(root);
  if (sessionStorage.getItem(STORAGE_KEY) === '1') renderSummerTraining(root);
}

function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  setTimeout(() => {
    syncQueued = false;
    syncSummerTrainingTab();
  }, 60);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleSync, { once: true });
  else scheduleSync();
  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
