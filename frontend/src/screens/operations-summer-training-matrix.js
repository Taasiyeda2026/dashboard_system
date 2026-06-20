import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';
import { getActivityName, activityMatchesPeriod, activityOverlapsDateRange, isActivityDeleted } from './shared/operations-activity-helpers.js';
import { ACTIVITY_SEASON_SUMMER_2026 } from './shared/summer-activity.js';

const KEY = 'opsSummerTrainingActive';
const FROM = '2026-06-15';
const TO = '2026-09-01';
let queued = false;
let busy = false;
let token = 0;

const clean = (v) => String(v || '').trim();
const norm = (v) => clean(v).replace(/[״"]/g, '').replace(/[׳']/g, '').replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').toLowerCase();
const keyOf = (workshop, instructor) => `${norm(workshop)}|${norm(instructor)}`;
const sortHe = (arr) => Array.from(new Set(arr.map(clean).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'he', { numeric: true }));
const validInstructor = (v) => clean(v) && !['לא משויך', 'ללא שיוך', '-'].includes(clean(v));

function workshopName(row) {
  return clean(getActivityName(row) || row.activity_name || row.name || row.title || row.program_name);
}

function instructorNames(row) {
  return sortHe([row.instructor_name, row.instructor_name_2, row.instructor, row.guide_name, row.guide].filter(validInstructor));
}

function dateRange(root) {
  const f = root?.querySelector?.('[data-ops-date="from"]')?.value || FROM;
  const t = root?.querySelector?.('[data-ops-date="to"]')?.value || TO;
  return { from: f < FROM ? FROM : f, to: t > TO ? TO : t };
}

function addStyle() {
  if (document.getElementById('ops-training-matrix-style')) return;
  const s = document.createElement('style');
  s.id = 'ops-training-matrix-style';
  s.textContent = `
    .ops-trx{direction:rtl;background:#fff;border:1px solid #d8e5ee;border-radius:16px;overflow:hidden;width:min(1160px,96%);margin:0 auto;box-shadow:0 1px 2px rgba(15,23,42,.04)}
    .ops-trx-h{padding:14px 16px;background:#f8fbfd;border-bottom:1px solid #e2e8f0}.ops-trx-h h2{margin:0;font-size:18px;color:#0f172a}.ops-trx-h p{margin:3px 0 0;color:#64748b;font-size:12px}
    .ops-trx-s{display:flex;flex-wrap:wrap;gap:8px;padding:10px 16px;border-bottom:1px solid #e2e8f0}.ops-trx-pill{border:1px solid #dbe7ef;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:700;white-space:nowrap}.ops-trx-okp{background:#ecfdf5;border-color:#bbf7d0;color:#166534}.ops-trx-warnp{background:#fff7ed;border-color:#fed7aa;color:#9a3412}.ops-trx-infop{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}
    .ops-trx-wrap{overflow:auto;max-height:70vh}.ops-trx table{border-collapse:collapse;table-layout:fixed;background:#fff;font-size:12px}.ops-trx th,.ops-trx td{border:1px solid #cbd5e1;height:44px;line-height:44px;padding:0;text-align:center;vertical-align:middle;box-sizing:border-box;overflow:hidden;background:#fff}.ops-trx th{background:#f1f5f9;font-weight:800;color:#111827}.ops-trx tr:nth-child(even) td{background:#f8fafc}
    .ops-trx-workshop{position:sticky;right:0;z-index:2;width:260px;min-width:260px;max-width:260px;text-align:right!important;padding-inline:10px!important;font-weight:800;color:#0f172a;background:#fff!important}.ops-trx th.ops-trx-workshop{z-index:4;text-align:center!important;background:#f1f5f9!important}.ops-trx-guide{width:92px;min-width:92px;max-width:92px}.ops-trx-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:44px}
    .ops-trx-mark{font-size:24px;font-weight:900;line-height:44px;display:inline-flex;width:100%;height:44px;align-items:center;justify-content:center}.ops-trx-ok{color:#16a34a}.ops-trx-warn{color:#ef4444}
    .ops-trx-legend{display:flex;gap:12px;flex-wrap:wrap;padding:10px 16px;color:#475569;font-size:12px;border-top:1px solid #e2e8f0;background:#f8fbfd}.ops-trx-msg{padding:20px;text-align:center;font-weight:700;color:#475569}.ops-trx-err{color:#b91c1c;background:#fef2f2}
  `;
  document.head.appendChild(s);
}

async function loadTrainings() {
  const { data, error } = await supabase.from('summer_workshop_trainings').select('workshop_name,instructor_name,is_trained').eq('is_trained', true);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function loadActivities(from, to) {
  const { data, error } = await supabase.from('activities').select('*');
  if (error) throw error;
  return (Array.isArray(data) ? data : [])
    .filter((row) => !isActivityDeleted(row))
    .filter((row) => !['בוטל', 'מבוטל', 'נמחק'].includes(clean(row.status)))
    .filter((row) => activityMatchesPeriod(row, ACTIVITY_SEASON_SUMMER_2026))
    .filter((row) => activityOverlapsDateRange(row, from, to));
}

function buildModel(activities, trainings) {
  const trained = new Set();
  const assigned = new Map();
  const workshops = [];
  const instructors = [];
  let assignments = 0;
  const addWorkshop = (v) => { if (clean(v)) workshops.push(clean(v)); };
  const addInstructor = (v) => { if (validInstructor(v)) instructors.push(clean(v)); };

  trainings.forEach((row) => {
    const w = clean(row.workshop_name);
    const i = clean(row.instructor_name);
    if (!w || !validInstructor(i)) return;
    addWorkshop(w);
    addInstructor(i);
    trained.add(keyOf(w, i));
  });

  activities.forEach((row) => {
    const w = workshopName(row);
    if (!w) return;
    addWorkshop(w);
    instructorNames(row).forEach((i) => {
      addInstructor(i);
      const k = keyOf(w, i);
      assigned.set(k, (assigned.get(k) || 0) + 1);
      assignments += 1;
    });
  });

  const assignedKeys = Array.from(assigned.keys());
  return {
    workshops: sortHe(workshops),
    instructors: sortHe(instructors),
    trained,
    assigned,
    assignments,
    trainedCount: trained.size,
    assignedWithTraining: assignedKeys.filter((k) => trained.has(k)).length,
    assignedWithoutTraining: assignedKeys.filter((k) => !trained.has(k)).length
  };
}

function cell(model, w, i) {
  const k = keyOf(w, i);
  const count = model.assigned.get(k) || 0;
  if (model.trained.has(k)) {
    const note = count ? `${count} שיבוצים בטווח` : 'ללא שיבוץ בטווח';
    return `<td class="ops-trx-guide" title="${escapeHtml(`${w} — ${i}: עבר הכשרה · ${note}`)}"><span class="ops-trx-mark ops-trx-ok">✓</span></td>`;
  }
  if (count > 0) {
    return `<td class="ops-trx-guide" title="${escapeHtml(`${w} — ${i}: משובץ ללא הכשרה · ${count} שיבוצים בטווח`)}"><span class="ops-trx-mark ops-trx-warn">!</span></td>`;
  }
  return '<td class="ops-trx-guide"></td>';
}

function html(model, from, to) {
  const width = 260 + model.instructors.length * 92;
  const head = `<tr><th class="ops-trx-workshop">סדנה</th>${model.instructors.map((i) => `<th class="ops-trx-guide" title="${escapeHtml(i)}"><span class="ops-trx-name">${escapeHtml(i)}</span></th>`).join('')}</tr>`;
  const body = model.workshops.map((w) => `<tr><td class="ops-trx-workshop" title="${escapeHtml(w)}"><span class="ops-trx-name">${escapeHtml(w)}</span></td>${model.instructors.map((i) => cell(model, w, i)).join('')}</tr>`).join('');
  const table = model.workshops.length && model.instructors.length
    ? `<div class="ops-trx-wrap"><table style="min-width:${width}px;width:${width}px"><thead>${head}</thead><tbody>${body}</tbody></table></div>`
    : '<div class="ops-trx-msg">לא נמצאו הכשרות או שיבוצים להצגה</div>';
  return `<section class="ops-trx" dir="rtl">
    <div class="ops-trx-h"><h2>הכשרות קיץ</h2><p>סדנאות מול מדריכים. ✓ מציין הכשרה כללית גם אם אין שיבוץ כרגע. ! מציין שיבוץ בטווח ללא הכשרה. טווח שיבוצים: ${escapeHtml(from)} עד ${escapeHtml(to)}</p></div>
    <div class="ops-trx-s"><span class="ops-trx-pill ops-trx-infop">${model.trainedCount} הכשרות כלליות</span><span class="ops-trx-pill">${model.assignments} שיבוצים בטווח</span><span class="ops-trx-pill ops-trx-okp">${model.assignedWithTraining} צמדים משובצים עם הכשרה</span><span class="ops-trx-pill ops-trx-warnp">${model.assignedWithoutTraining} צמדים משובצים ללא הכשרה</span></div>
    ${table}
    <div class="ops-trx-legend"><span><strong class="ops-trx-mark ops-trx-ok">✓</strong> עבר הכשרה לסדנה</span><span><strong class="ops-trx-mark ops-trx-warn">!</strong> משובץ ללא הכשרה</span><span>תא ריק = אין הכשרה ואין שיבוץ בטווח</span></div>
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
  if (!root || busy) return;
  const container = root.querySelector('.ds-ops-mgmt-content');
  if (!container) return;
  if (!force && container.querySelector('.ops-trx')) return;
  const current = ++token;
  busy = true;
  addStyle();
  setActive(root, true);
  const { from, to } = dateRange(root);
  container.innerHTML = '<section class="ops-trx" dir="rtl"><div class="ops-trx-msg">טוען הכשרות קיץ...</div></section>';
  try {
    const [activities, trainings] = await Promise.all([loadActivities(from, to), loadTrainings()]);
    if (current !== token) return;
    container.innerHTML = html(buildModel(activities, trainings), from, to);
  } catch (e) {
    if (current !== token) return;
    console.warn('[summer-training-matrix]', e?.message || e);
    container.innerHTML = `<section class="ops-trx" dir="rtl"><div class="ops-trx-msg ops-trx-err">לא ניתן לטעון את נתוני הכשרות הקיץ כרגע. ${escapeHtml(e?.message || '')}</div></section>`;
  } finally {
    busy = false;
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
    button.addEventListener('click', () => { sessionStorage.setItem(KEY, '1'); render(root, true); });
  }
  nav.querySelectorAll('[data-ops-tab]').forEach((b) => {
    if (b.dataset.opsTrainingClearBound) return;
    b.dataset.opsTrainingClearBound = '1';
    b.addEventListener('click', () => sessionStorage.removeItem(KEY), { capture: true });
  });
  root.querySelectorAll('[data-ops-date]').forEach((input) => {
    if (input.dataset.opsTrainingDateBound) return;
    input.dataset.opsTrainingDateBound = '1';
    input.addEventListener('change', () => { if (sessionStorage.getItem(KEY) === '1') render(root, true); });
  });
  if (sessionStorage.getItem(KEY) === '1') { setActive(root, true); render(root, false); }
}

function schedule() {
  if (queued) return;
  queued = true;
  setTimeout(() => { queued = false; ensureTab(); }, 80);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
}
