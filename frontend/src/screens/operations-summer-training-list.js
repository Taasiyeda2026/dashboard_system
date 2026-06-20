import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';
import {
  getActivityName,
  activityMatchesPeriod,
  activityOverlapsDateRange,
  isActivityDeleted
} from './shared/operations-activity-helpers.js';
import { ACTIVITY_SEASON_SUMMER_2026 } from './shared/summer-activity.js';

const STORAGE_KEY = 'opsSummerTrainingActive';
const SUMMER_FROM = '2026-06-15';
const SUMMER_TO = '2026-09-01';

let queued = false;
let rendering = false;
let latestToken = 0;

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
  return String(getActivityName(activity) || activity.activity_name || activity.name || activity.title || activity.program_name || '').trim();
}

function getSystemInstructorNames(activity = {}) {
  return uniqueSorted([
    activity?.instructor_name,
    activity?.instructor_name_2,
    activity?.instructor,
    activity?.guide_name,
    activity?.guide
  ].filter(isValidInstructorName));
}

function getDateRange(root) {
  const rawFrom = root?.querySelector?.('[data-ops-date="from"]')?.value || SUMMER_FROM;
  const rawTo = root?.querySelector?.('[data-ops-date="to"]')?.value || SUMMER_TO;
  return {
    from: rawFrom < SUMMER_FROM ? SUMMER_FROM : rawFrom,
    to: rawTo > SUMMER_TO ? SUMMER_TO : rawTo
  };
}

function addStyles() {
  if (document.getElementById('ops-summer-training-list-style')) return;
  const style = document.createElement('style');
  style.id = 'ops-summer-training-list-style';
  style.textContent = `
    .ops-training-list{direction:rtl;background:#fff;border:1px solid #d8e5ee;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.04);max-width:980px;margin:0 auto}
    .ops-training-list__header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;background:#f8fbfd;border-bottom:1px solid #e2e8f0}
    .ops-training-list__title{font-size:18px;font-weight:800;color:#0f172a;margin:0}
    .ops-training-list__subtitle{font-size:12px;color:#64748b;margin:3px 0 0;line-height:1.45}
    .ops-training-list__summary{display:flex;flex-wrap:wrap;gap:8px;padding:10px 16px;border-bottom:1px solid #e2e8f0;background:#fff}
    .ops-training-list__pill{display:inline-flex;align-items:center;border-radius:999px;border:1px solid #dbe7ef;background:#f8fbfd;color:#334155;padding:3px 9px;font-size:12px;font-weight:700;white-space:nowrap}
    .ops-training-list__pill--ok{background:#ecfdf5;border-color:#bbf7d0;color:#166534}
    .ops-training-list__pill--warn{background:#fff7ed;border-color:#fed7aa;color:#9a3412}
    .ops-training-list__pill--info{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}
    .ops-training-list__wrap{width:100%;overflow:auto;background:#fff;padding:0}
    .ops-training-list__table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:13px;direction:rtl}
    .ops-training-list__table th,.ops-training-list__table td{border:1px solid #cbd5e1;padding:0 10px;text-align:right;vertical-align:middle;height:44px;line-height:44px;background:#fff;box-sizing:border-box;overflow:hidden}
    .ops-training-list__table th{background:#f1f5f9;color:#111827;font-weight:800;text-align:center;white-space:nowrap}
    .ops-training-list__table tr:nth-child(even) td{background:#f8fafc}
    .ops-training-list__col-name{width:36%}
    .ops-training-list__col-count{width:12%;text-align:center!important;white-space:nowrap}
    .ops-training-list__col-status{width:16%;text-align:center!important;white-space:nowrap}
    .ops-training-list__name{display:block;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;color:#0f172a;line-height:44px}
    .ops-training-list__count{display:block;text-align:center;font-weight:800;color:#334155;line-height:44px}
    .ops-training-list__status{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:999px;padding:4px 10px;font-weight:800;font-size:12px;min-width:114px;box-sizing:border-box;line-height:1.2;vertical-align:middle}
    .ops-training-list__status--ok{background:#ecfdf5;border:1px solid #bbf7d0;color:#166534}
    .ops-training-list__status--warn{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c}
    .ops-training-list__symbol{font-size:18px;line-height:1;font-weight:900;display:inline-flex;align-items:center;justify-content:center;min-width:18px;min-height:18px}
    .ops-training-list__symbol--ok{color:#16a34a}
    .ops-training-list__symbol--warn{color:#ef4444}
    .ops-training-list__legend{display:flex;gap:12px;flex-wrap:wrap;padding:10px 16px;color:#475569;font-size:12px;border-top:1px solid #e2e8f0;background:#f8fbfd}
    .ops-training-list__loading,.ops-training-list__error,.ops-training-list__empty{padding:20px 16px;text-align:center;font-weight:700;color:#475569}
    .ops-training-list__error{color:#b91c1c;background:#fef2f2}
    @media (max-width: 760px){.ops-training-list{max-width:none}.ops-training-list__table{min-width:720px}.ops-training-list__wrap{overflow-x:auto}}
  `;
  document.head.appendChild(style);
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
    .filter((row) => !['בוטל', 'מבוטל', 'נמחק'].includes(String(row?.status || '').trim()))
    .filter((row) => activityMatchesPeriod(row, ACTIVITY_SEASON_SUMMER_2026))
    .filter((row) => activityOverlapsDateRange(row, from, to));
}

function buildModel(activities, trainingRows) {
  const trained = new Map();
  const pairs = new Map();

  (Array.isArray(trainingRows) ? trainingRows : []).forEach((row) => {
    const workshop = String(row?.workshop_name || '').trim();
    const instructor = String(row?.instructor_name || '').trim();
    if (!workshop || !isValidInstructorName(instructor)) return;
    const key = pairKey(workshop, instructor);
    trained.set(key, { workshop, instructor });
    pairs.set(key, { workshop, instructor, count: 0, hasTraining: true });
  });

  let assignmentCount = 0;
  (Array.isArray(activities) ? activities : []).forEach((activity) => {
    const workshop = getSystemWorkshopName(activity);
    if (!workshop) return;
    const instructors = getSystemInstructorNames(activity);
    instructors.forEach((instructor) => {
      const key = pairKey(workshop, instructor);
      const trainedRow = trained.get(key);
      const current = pairs.get(key) || {
        workshop,
        instructor,
        count: 0,
        hasTraining: Boolean(trainedRow)
      };
      current.workshop = trainedRow?.workshop || current.workshop || workshop;
      current.instructor = trainedRow?.instructor || current.instructor || instructor;
      current.hasTraining = current.hasTraining || Boolean(trainedRow);
      current.count += 1;
      pairs.set(key, current);
      assignmentCount += 1;
    });
  });

  const rows = Array.from(pairs.values()).sort((a, b) => {
    const groupA = !a.hasTraining ? 0 : (a.count > 0 ? 1 : 2);
    const groupB = !b.hasTraining ? 0 : (b.count > 0 ? 1 : 2);
    if (groupA !== groupB) return groupA - groupB;
    const workshopCompare = a.workshop.localeCompare(b.workshop, 'he', { numeric: true });
    if (workshopCompare !== 0) return workshopCompare;
    return a.instructor.localeCompare(b.instructor, 'he', { numeric: true });
  });

  return {
    rows,
    assignmentCount,
    pairCount: rows.length,
    trainedPairCount: trained.size,
    assignedWithTrainingCount: rows.filter((row) => row.hasTraining && row.count > 0).length,
    assignedWithoutTrainingCount: rows.filter((row) => !row.hasTraining && row.count > 0).length,
    trainedAvailableCount: rows.filter((row) => row.hasTraining && row.count === 0).length
  };
}

function statusHtml(row) {
  if (row.hasTraining) {
    return '<span class="ops-training-list__status ops-training-list__status--ok"><span class="ops-training-list__symbol ops-training-list__symbol--ok">✓</span>קיבל הכשרה</span>';
  }
  return '<span class="ops-training-list__status ops-training-list__status--warn"><span class="ops-training-list__symbol ops-training-list__symbol--warn">!</span>ללא הכשרה</span>';
}

function modelHtml(model, from, to) {
  const rowsHtml = model.rows.map((row) => `<tr>
    <td class="ops-training-list__col-name" title="${escapeHtml(row.workshop)}"><span class="ops-training-list__name">${escapeHtml(row.workshop)}</span></td>
    <td class="ops-training-list__col-name" title="${escapeHtml(row.instructor)}"><span class="ops-training-list__name">${escapeHtml(row.instructor)}</span></td>
    <td class="ops-training-list__col-count"><span class="ops-training-list__count">${escapeHtml(String(row.count))}</span></td>
    <td class="ops-training-list__col-status">${statusHtml(row)}</td>
  </tr>`).join('');

  const tableHtml = model.rows.length
    ? `<div class="ops-training-list__wrap">
        <table class="ops-training-list__table" aria-label="טבלת הכשרות קיץ">
          <colgroup>
            <col class="ops-training-list__col-name">
            <col class="ops-training-list__col-name">
            <col class="ops-training-list__col-count">
            <col class="ops-training-list__col-status">
          </colgroup>
          <thead><tr><th>שם סדנה</th><th>שם מדריך</th><th>שיבוצים בטווח</th><th>סטטוס הכשרה</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`
    : '<div class="ops-training-list__empty">לא נמצאו רשומות הכשרה או שיבוצים בטווח התאריכים שנבחר</div>';

  return `<section class="ops-training-list" dir="rtl">
    <header class="ops-training-list__header">
      <div>
        <h2 class="ops-training-list__title">הכשרות קיץ</h2>
        <p class="ops-training-list__subtitle">התצוגה מציגה את מאגר ההכשרות הכללי וגם את השיבוצים בטווח. שורה עם 0 שיבוצים משמעה שהמדריך כבר עבר הכשרה לסדנה וניתן לשקול לשבץ אותו לפעילות עתידית. טווח שיבוצים: ${escapeHtml(from)} עד ${escapeHtml(to)}</p>
      </div>
    </header>
    <div class="ops-training-list__summary">
      <span class="ops-training-list__pill ops-training-list__pill--info">${model.trainedPairCount} הכשרות כלליות</span>
      <span class="ops-training-list__pill">${model.assignmentCount} שיבוצים בטווח</span>
      <span class="ops-training-list__pill ops-training-list__pill--ok">${model.assignedWithTrainingCount} צמדים משובצים עם הכשרה</span>
      <span class="ops-training-list__pill ops-training-list__pill--warn">${model.assignedWithoutTrainingCount} צמדים משובצים ללא הכשרה</span>
      <span class="ops-training-list__pill">${model.trainedAvailableCount} צמדים מוכנים לשיבוץ עתידי</span>
    </div>
    ${tableHtml}
    <div class="ops-training-list__legend">
      <span><strong class="ops-training-list__symbol ops-training-list__symbol--ok">✓</strong> קיבל הכשרה לסדנה גם אם כרגע לא משובץ</span>
      <span><strong class="ops-training-list__symbol ops-training-list__symbol--warn">!</strong> משובץ בטווח אך לא מופיעה לו הכשרה לסדנה</span>
      <span>0 בשיבוצים בטווח = הכשרה קיימת לשיבוץ עתידי</span>
    </div>
  </section>`;
}

function setActive(root, active) {
  root?.querySelectorAll?.('.ds-ops-mgmt-tab').forEach((btn) => {
    const mine = btn.hasAttribute('data-ops-training-tab');
    btn.classList.toggle('is-active', active && mine);
    if (active || mine) btn.setAttribute('aria-pressed', active && mine ? 'true' : 'false');
  });
}

async function render(root, force = false) {
  if (!root || rendering) return;
  const content = root.querySelector('.ds-ops-mgmt-content');
  if (!content) return;
  if (!force && content.querySelector('.ops-training-list')) return;

  const token = ++latestToken;
  rendering = true;
  addStyles();
  setActive(root, true);
  const { from, to } = getDateRange(root);
  content.innerHTML = '<section class="ops-training-list" dir="rtl"><div class="ops-training-list__loading">טוען הכשרות קיץ...</div></section>';

  try {
    const [activities, trainingRows] = await Promise.all([
      readSummerActivities(from, to),
      readTrainingRows()
    ]);
    if (token !== latestToken) return;
    content.innerHTML = modelHtml(buildModel(activities, trainingRows), from, to);
  } catch (error) {
    console.warn('[operations-summer-training-list] failed to render', error?.message || error);
    if (token !== latestToken) return;
    content.innerHTML = `<section class="ops-training-list" dir="rtl"><div class="ops-training-list__error">לא ניתן לטעון את נתוני הכשרות הקיץ כרגע. ${escapeHtml(error?.message || '')}</div></section>`;
  } finally {
    rendering = false;
  }
}

function ensureTab() {
  const root = document.querySelector('.ds-ops-mgmt-screen');
  const nav = root?.querySelector?.('.ds-ops-mgmt-tabs');
  if (!root || !nav) return;

  let button = nav.querySelector('[data-ops-training-tab]');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'ds-exceptions-tab ds-ops-mgmt-tab';
    button.textContent = 'הכשרות קיץ';
    button.setAttribute('data-ops-training-tab', '1');
    button.setAttribute('aria-pressed', 'false');
    nav.appendChild(button);
  }

  if (!button.dataset.opsTrainingBound) {
    button.dataset.opsTrainingBound = '1';
    button.addEventListener('click', () => {
      sessionStorage.setItem(STORAGE_KEY, '1');
      render(root, true);
    });
  }

  nav.querySelectorAll('[data-ops-tab]').forEach((existingButton) => {
    if (existingButton.dataset.opsTrainingClearBound) return;
    existingButton.dataset.opsTrainingClearBound = '1';
    existingButton.addEventListener('click', () => sessionStorage.removeItem(STORAGE_KEY), { capture: true });
  });

  root.querySelectorAll('[data-ops-date]').forEach((input) => {
    if (input.dataset.opsTrainingDateBound) return;
    input.dataset.opsTrainingDateBound = '1';
    input.addEventListener('change', () => {
      if (sessionStorage.getItem(STORAGE_KEY) === '1') render(root, true);
    });
  });

  if (sessionStorage.getItem(STORAGE_KEY) === '1') {
    setActive(root, true);
    render(root, false);
  }
}

function scheduleEnsure() {
  if (queued) return;
  queued = true;
  setTimeout(() => {
    queued = false;
    ensureTab();
  }, 80);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleEnsure, { once: true });
  else scheduleEnsure();
  new MutationObserver(scheduleEnsure).observe(document.documentElement, { childList: true, subtree: true });
}
