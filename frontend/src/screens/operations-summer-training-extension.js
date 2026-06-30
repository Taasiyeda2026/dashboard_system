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

function compareTrainingRows(a, b) {
  const workshopCompare = String(a.workshop || '').localeCompare(String(b.workshop || ''), 'he', { numeric: true });
  if (workshopCompare !== 0) return workshopCompare;
  return String(a.instructor || '').localeCompare(String(b.instructor || ''), 'he', { numeric: true });
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
    .ds-ops-training-wrap{width:100%;overflow:auto;background:#fff;padding:0}
    .ds-ops-training-table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:13px;direction:rtl}
    .ds-ops-training-table th,.ds-ops-training-table td{border:1px solid #cbd5e1;padding:7px 8px;text-align:right;vertical-align:middle;height:42px;line-height:1.25;background:#fff;box-sizing:border-box}
    .ds-ops-training-table th{background:#f8fafc;color:#111827;font-weight:800;text-align:right;white-space:nowrap}
    .ds-ops-training-table th:nth-child(3),.ds-ops-training-table th:nth-child(4){text-align:center}
    .ds-ops-training-table tr:nth-child(even) td{background:#f8fafc}
    .ds-ops-training-col--workshop,.ds-ops-training-col--instructor{width:35%}
    .ds-ops-training-col--count{width:14%;text-align:center!important;white-space:nowrap}
    .ds-ops-training-col--status{width:16%;text-align:center!important;white-space:nowrap}
    .ds-ops-training-name{display:block;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;color:#0f172a}
    .ds-ops-training-status{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:999px;padding:4px 10px;font-weight:800;font-size:12px;min-width:112px;box-sizing:border-box}
    .ds-ops-training-status--ok{background:#ecfdf5;border:1px solid #bbf7d0;color:#166534}
    .ds-ops-training-status--warn{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c}
    .ds-ops-training-symbol{font-size:18px;line-height:1;font-weight:900;display:inline-flex;align-items:center;justify-content:center;min-width:18px;min-height:18px}
    .ds-ops-training-symbol--ok{color:#16a34a}
    .ds-ops-training-symbol--warn{color:#ef4444}
    .ds-ops-training-count{font-weight:800;color:#334155;text-align:center;display:block}
    .ds-ops-training-legend{display:flex;gap:12px;flex-wrap:wrap;padding:10px 16px;color:#475569;font-size:12px;border-top:1px solid #e2e8f0;background:#f8fbfd}
    .ds-ops-training-error,.ds-ops-training-loading,.ds-ops-training-empty{padding:20px 16px;color:#475569;font-weight:700;text-align:center}
    .ds-ops-training-error{color:#b91c1c;background:#fef2f2}
    @media (max-width: 900px){.ds-ops-training-table{min-width:760px}.ds-ops-training-wrap{overflow-x:auto}}
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

function buildStatusRows({ activities, trainingRows }) {
  const trained = buildTrainingSet(trainingRows);
  const assignedPairs = new Map();
  let assignedCount = 0;

  activities.forEach((activity) => {
    const workshop = getSystemWorkshopName(activity);
    if (!workshop) return;
    const instructors = getSystemInstructorNames(activity);
    if (!instructors.length) return;
    instructors.forEach((instructor) => {
      const key = pairKey(workshop, instructor);
      const existing = assignedPairs.get(key) || { workshop, instructor, count: 0 };
      existing.count += 1;
      assignedPairs.set(key, existing);
      assignedCount += 1;
    });
  });

  const rows = Array.from(assignedPairs.values()).map((row) => ({
    ...row,
    hasTraining: trained.has(pairKey(row.workshop, row.instructor))
  })).sort(compareTrainingRows);

  const okPairCount = rows.filter((row) => row.hasTraining).length;
  const warningPairCount = rows.length - okPairCount;

  return {
    rows,
    okPairCount,
    warningPairCount,
    assignedPairCount: rows.length,
    assignedCount,
    trainingPairCount: trained.size
  };
}

function trainingStatusHtml(row) {
  if (row.hasTraining) {
    return `<span class="ds-ops-training-status ds-ops-training-status--ok"><span class="ds-ops-training-symbol ds-ops-training-symbol--ok">✓</span>קיבל הכשרה</span>`;
  }
  return `<span class="ds-ops-training-status ds-ops-training-status--warn"><span class="ds-ops-training-symbol ds-ops-training-symbol--warn">!</span>ללא הכשרה</span>`;
}

function statusRowsHtml(model, from, to) {
  const body = model.rows.map((row) => `<tr>
    <td class="ds-ops-training-col--workshop" title="${escapeHtml(row.workshop)}"><span class="ds-ops-training-name">${escapeHtml(row.workshop)}</span></td>
    <td class="ds-ops-training-col--instructor" title="${escapeHtml(row.instructor)}"><span class="ds-ops-training-name">${escapeHtml(row.instructor)}</span></td>
    <td class="ds-ops-training-col--count"><span class="ds-ops-training-count">${escapeHtml(String(row.count))}</span></td>
    <td class="ds-ops-training-col--status">${trainingStatusHtml(row)}</td>
  </tr>`).join('');

  const table = model.rows.length
    ? `<div class="ds-ops-training-wrap">
        <table class="ds-ops-training-table" aria-label="טבלת סטטוס הכשרות קיץ">
          <colgroup>
            <col class="ds-ops-training-col--workshop">
            <col class="ds-ops-training-col--instructor">
            <col class="ds-ops-training-col--count">
            <col class="ds-ops-training-col--status">
          </colgroup>
          <thead><tr><th>שם סדנה</th><th>שם מדריך</th><th>כמות שיבוצים</th><th>סטטוס הכשרה</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`
    : '<div class="ds-ops-training-empty">לא נמצאו שיבוצים בטווח התאריכים שנבחר</div>';

  return `<section class="ds-ops-mgmt-panel ds-ops-training-panel" dir="rtl">
    <div class="ds-ops-training-card">
      <header class="ds-ops-training-header">
        <div>
          <h2 class="ds-ops-training-title">הכשרות קיץ</h2>
          <p class="ds-ops-training-subtitle">רשימה לפי שיבוצים בפועל במערכת בלבד. הבדיקה היא לפי זוג ייחודי: שם סדנה + שם מדריך. טווח: ${escapeHtml(from)} עד ${escapeHtml(to)}</p>
        </div>
      </header>
      <div class="ds-ops-training-summary">
        <span class="ds-ops-training-pill">${model.assignedCount} שיבוצים שנבדקו</span>
        <span class="ds-ops-training-pill">${model.assignedPairCount} צמדי מדריך-סדנה</span>
        <span class="ds-ops-training-pill ds-ops-training-pill--ok">${model.okPairCount} צמדים עם הכשרה</span>
        <span class="ds-ops-training-pill ds-ops-training-pill--warn">${model.warningPairCount} צמדים ללא הכשרה</span>
        <span class="ds-ops-training-pill">${model.trainingPairCount} רשומות הכשרה מאחורי הקלעים</span>
      </div>
      ${table}
      <div class="ds-ops-training-legend">
        <span><strong class="ds-ops-training-symbol ds-ops-training-symbol--ok">✓</strong> משובץ וקיבל הכשרה</span>
        <span><strong class="ds-ops-training-symbol ds-ops-training-symbol--warn">!</strong> משובץ ללא הכשרה</span>
        <span>רשומות הכשרה שאינן משובצות בטווח התאריכים אינן מוצגות בטבלה</span>
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
    const model = buildStatusRows({ activities, trainingRows });
    content.innerHTML = statusRowsHtml(model, from, to);
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
  if (sessionStorage.getItem(STORAGE_KEY) !== '1') return;
  setSummerTrainingActive(root, true);
  const content = root.querySelector('.ds-ops-mgmt-content');
  if (content?.querySelector?.('.ds-ops-training-panel,.ds-ops-training-loading,.ds-ops-training-error')) return;
  renderSummerTraining(root);
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
