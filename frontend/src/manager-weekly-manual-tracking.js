import { state } from './state.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import { activitySeasonQueryValues } from './screens/shared/summer-activity.js';

export const MANUAL_METRICS = [
  ['activities', 'סה״כ פעילויות באחריותי'],
  ['schools', 'מספר בתי ספר'],
  ['unassigned', 'פעילויות ללא מדריך'],
  ['planned', 'קורסים צפויים להתחיל השבוע'],
  ['started', 'קורסים שהתחילו בפועל השבוע'],
  ['training', 'הכשרות מדריכים שצריך להשלים'],
  ['materials', 'חומרי הדרכה שצריך להשלים'],
  ['kits', 'ערכות שצריך להכין או להעביר'],
  ['issues', 'נושאים פתוחים שדורשים טיפול']
];
const READONLY_ROLES = new Set(['admin', 'operation_manager']);
const CLOSED = new Set(['בוטל', 'מבוטל', 'נמחק', 'סגור', 'cancelled', 'canceled', 'deleted', 'closed', 'inactive']);
const TRACKER_CLASS = 'mw-tracker';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const val = (value) => String(value ?? '').trim();
const isoDate = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const dateFromIso = (iso) => new Date(String(iso).slice(0, 10) + 'T12:00:00');

export function weekStartIso(date) {
  const d = date instanceof Date ? new Date(date.getTime()) : dateFromIso(date);
  d.setDate(d.getDate() - d.getDay());
  return isoDate(d);
}
export function shiftWeek(iso, steps) {
  const d = dateFromIso(iso);
  d.setDate(d.getDate() + steps * 7);
  return isoDate(d);
}
function initialWeek(ym) {
  const current = new Date();
  if (ym === isoDate(current).slice(0, 7)) return weekStartIso(current);
  return weekStartIso(ym + '-01');
}
function labelWeek(start) {
  const end = dateFromIso(start);
  end.setDate(end.getDate() + 6);
  const short = (d) => [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0')].join('.');
  return short(dateFromIso(start)) + '–' + short(end);
}
function nullReport(week) {
  return { week_start: week, status: 'draft', metrics: {}, openings: [], highlights: '', next_steps: '', blockers: '', instructor_notes: '', kit_notes: '' };
}
function validMetric(v) {
  return Number.isSafeInteger(Number(v)) && Number(v) >= 0;
}
export function validateWeeklyReport(report) {
  for (const [key, label] of MANUAL_METRICS) {
    if (!Object.prototype.hasOwnProperty.call(report.metrics || {}, key) || !validMetric(report.metrics[key])) {
      return 'יש למלא מספר תקין במדד: ' + label;
    }
  }
  const openings = Array.isArray(report.openings) ? report.openings : [];
  if (openings.length !== Number(report.metrics.planned)) return 'מספר שורות הפתיחה חייב להיות זהה למספר הקורסים הצפויים להיפתח.';
  for (const item of openings) {
    if (!val(item.school) || !val(item.program) || !/^\d{4}-\d{2}-\d{2}$/.test(val(item.start_date)) || !val(item.instructor)) {
      return 'בכל פתיחה יש למלא בית ספר, תוכנית, תאריך ומדריך (או "טרם שובץ").';
    }
    if (weekStartIso(item.start_date) !== report.week_start) return 'תאריך הפתיחה חייב להשתייך לשבוע המדווח.';
  }
  if (!val(report.highlights) || !val(report.next_steps)) return 'להגשה נדרש למלא את סיכום השבוע ואת התכנון לשבוע הבא.';
  return '';
}

let active = null;
const styles = [
  '.mw-tracker{direction:rtl;padding:20px 22px;margin-top:14px;border:1px solid #dce5ee;border-radius:16px;background:#fff;color:#253650;box-shadow:0 2px 9px #1f385309;font-size:13.5px}',
  '.mw-tracker *{box-sizing:border-box}.mw-tracker h2,.mw-tracker h3,.mw-tracker p{margin:0}',
  '.mw-header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}.mw-header h2{font-size:19px;font-weight:800}.mw-muted{color:#718096;font-size:12px}.mw-tag{display:inline-flex;padding:5px 10px;border:1px solid #b9dbe6;border-radius:8px;background:#f0f9fc;color:#17657d;font-size:12px;font-weight:700}',
  '.mw-intro{line-height:1.7;background:#f6fafc;border:1px solid #e1ecf0;border-radius:10px;padding:10px 13px;margin-bottom:14px}',
  '.mw-toolbar{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:14px 0}.mw-left{display:flex;gap:7px;align-items:center;flex-wrap:wrap}',
  '.mw-btn{border:1px solid #cad8e5;background:#fff;border-radius:8px;padding:8px 11px;color:#28445d;font-weight:650;cursor:pointer;font-family:inherit;font-size:12px}.mw-btn:hover{background:#eef7fa}.mw-btn:disabled{opacity:.5;cursor:not-allowed}.mw-primary{background:#2496b3;color:#fff;border-color:#2496b3}.mw-primary:hover{background:#1c819d;color:#fff}',
  '.mw-table-scroll{overflow:auto;max-width:100%;border:1px solid #e0e7ef;border-radius:11px;margin:11px 0 18px}.mw-table{width:100%;min-width:790px;border-collapse:collapse;text-align:right}.mw-table th,.mw-table td{padding:9px 10px;border-bottom:1px solid #e8edf3;vertical-align:middle}.mw-table th{background:#f5f8fb;font-size:12px;color:#586b7d;white-space:nowrap}.mw-table tr:last-child td{border-bottom:0}.mw-table th:first-child,.mw-table td:first-child{position:sticky;right:0;background:#fff;z-index:1;min-width:195px}.mw-table th:first-child{background:#f5f8fb;z-index:2}.mw-table .mw-focus{background:#edf9fc}.mw-week-btn{border:0;background:transparent;color:inherit;cursor:pointer;font-weight:700;padding:3px}.mw-week-btn:hover{text-decoration:underline}.mw-week-status{display:block;font-weight:400;color:#8494a1;font-size:10px;margin-top:3px}',
  '.mw-section{border-top:1px solid #e5ebf1;padding-top:17px;margin-top:16px}.mw-section-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}.mw-section h3{font-size:15px;font-weight:750}',
  '.mw-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.mw-field{display:flex;flex-direction:column;gap:5px;color:#506376;font-size:12px;font-weight:600}.mw-field input,.mw-field textarea,.mw-field select{border:1px solid #cad7e2;border-radius:8px;min-height:36px;padding:8px 10px;color:#1c3449;background:#fff;font-size:13px;font-family:inherit;width:100%;direction:rtl}.mw-field textarea{min-height:72px;resize:vertical}.mw-field input:focus,.mw-field textarea:focus{outline:2px solid #b3e5f0}.mw-textareas{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.mw-opening{display:grid;grid-template-columns:1fr 1fr 1fr 132px 1fr auto;gap:7px;align-items:end;padding:9px;border:1px solid #e3ebf1;border-radius:9px;margin-top:8px;background:#fcfdff}.mw-opening .mw-field{min-width:0}.mw-opening-extra{grid-column:1/-1}',
  '.mw-foot{display:flex;align-items:center;gap:9px;justify-content:flex-end;flex-wrap:wrap;margin-top:15px}.mw-error{color:#b42318;background:#fff1f1;border:1px solid #f2d0ce;padding:10px;border-radius:9px;margin:10px 0}.mw-notice{color:#135d4e;background:#eafaf3;border:1px solid #c9ecdc;padding:10px;border-radius:9px;margin:10px 0}.mw-verify{margin-top:12px;background:#f5fafc;border:1px solid #dceaf0;border-radius:10px;padding:11px}.mw-verify ul{margin:8px 20px 0 0;padding:0}.mw-empty{padding:24px;text-align:center;color:#64748b}.mw-program{border:1px solid #e3ebf1;border-radius:10px;margin:10px 0;padding:12px;background:#fbfdff}.mw-program-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:9px}.mw-progress{font-size:12px;color:#52657a}.mw-sr-only{position:absolute;left:-10000px}',
  '@media(max-width:950px){.mw-fields{grid-template-columns:repeat(2,minmax(0,1fr))}.mw-opening{grid-template-columns:repeat(2,minmax(0,1fr))}.mw-opening-extra{grid-column:auto}}',
  '@media(max-width:610px){.mw-tracker{padding:13px 11px}.mw-fields,.mw-textareas,.mw-program-grid,.mw-opening{grid-template-columns:1fr}.mw-header h2{font-size:17px}.mw-section{margin-top:12px}.mw-opening-extra{grid-column:auto}}'
].join('');
function ensureStyle() {
  if (document.getElementById('manager-weekly-manual-style')) return;
  const el = document.createElement('style');
  el.id = 'manager-weekly-manual-style';
  el.textContent = styles;
  document.head.appendChild(el);
}
function contextKey(ctx) { return [ctx.managerName, ctx.year, ctx.ym].join('|'); }
function isCurrent(ctx) { return active === ctx && ctx.host.isConnected; }
function setNotice(ctx, message, error = false) {
  ctx.notice = message ? { message, error } : null;
  const holder = ctx.host.querySelector('[data-mw-notice]');
  if (holder) holder.innerHTML = message ? '<div class="' + (error ? 'mw-error' : 'mw-notice') + '" role="status">' + esc(message) + '</div>' : '';
}
function safeOpening(row) {
  return {
    authority: val(row.authority), school: val(row.school), program: val(row.program),
    start_date: val(row.start_date), instructor: val(row.instructor),
    training: val(row.training), kits: val(row.kits), materials: val(row.materials), issue: val(row.issue)
  };
}
function currentReport(ctx) {
  return ctx.reports.find((r) => r.week_start === ctx.week) || nullReport(ctx.week);
}
function inputField(label, key, value, opts = {}) {
  return '<label class="mw-field"><span>' + esc(label) + '</span>' +
    (opts.textarea
      ? '<textarea data-mw-input="' + esc(key) + '" maxlength="3000" ' + (opts.disabled ? 'disabled' : '') + '>' + esc(value) + '</textarea>'
      : '<input data-mw-input="' + esc(key) + '" type="' + (opts.type || 'text') + '" ' +
          (opts.type === 'number' ? 'min="0" step="1" ' : '') + 'value="' + esc(value) + '" ' +
          (opts.disabled ? 'disabled' : '') + ' maxlength="300"/>') +
    '</label>';
}
function readForm(ctx) {
  const root = ctx.host;
  const prev = currentReport(ctx);
  const metrics = {};
  for (const [key] of MANUAL_METRICS) {
    const value = root.querySelector('[data-mw-metric="' + key + '"]')?.value ?? '';
    if (value !== '') metrics[key] = Number(value);
  }
  const openings = [...root.querySelectorAll('[data-mw-opening]')].map((el) => {
    const result = {};
    for (const field of ['authority', 'school', 'program', 'start_date', 'instructor', 'training', 'kits', 'materials', 'issue']) {
      result[field] = val(el.querySelector('[data-mw-field="' + field + '"]')?.value);
    }
    return safeOpening(result);
  });
  const report = { ...prev, metrics, openings };
  for (const key of ['highlights', 'next_steps', 'blockers', 'instructor_notes', 'kit_notes']) {
    report[key] = val(root.querySelector('[data-mw-input="' + key + '"]')?.value);
  }
  return report;
}
function tableMarkup(ctx) {
  const weeks = [-2, -1, 0, 1, 2, 3].map((i) => shiftWeek(ctx.week, i));
  const rows = MANUAL_METRICS.map(([metric, title]) => '<tr><td>' + esc(title) + '</td>' + weeks.map((week) => {
    const report = ctx.reports.find((r) => r.week_start === week);
    const number = report?.metrics?.[metric];
    return '<td class="' + (week === ctx.week ? 'mw-focus' : '') + '" style="text-align:center;font-variant-numeric:tabular-nums">' +
      (number == null ? '—' : esc(number)) + '</td>';
  }).join('') + '</tr>').join('');
  const headers = weeks.map((week) => {
    const report = ctx.reports.find((r) => r.week_start === week);
    const status = report?.status === 'submitted' ? 'הוגש' : report ? 'טיוטה' : 'לא מולא';
    return '<th class="' + (week === ctx.week ? 'mw-focus' : '') + '"><button type="button" class="mw-week-btn" data-mw-week="' + esc(week) + '">' + labelWeek(week) + '<span class="mw-week-status">' + status + '</span></button></th>';
  }).join('');
  return '<div class="mw-table-scroll"><table class="mw-table"><thead><tr><th>מדד שהמנהל ממלא</th>' + headers + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}
function openingMarkup(row, index, locked) {
  const editable = locked ? 'disabled' : '';
  const field = (name, title, type = 'text') =>
    '<label class="mw-field"><span>' + esc(title) + '</span><input type="' + type + '" data-mw-field="' + name + '" value="' + esc(row[name] || '') + '" ' + editable + ' maxlength="250"/></label>';
  const choice = (name, title) => '<label class="mw-field"><span>' + esc(title) + '</span><select data-mw-field="' + name + '" ' + editable + '>' +
      ['', 'מוכן', 'בטיפול', 'חסר', 'לא נדרש', 'טרם נבדק'].map((v) => '<option value="' + esc(v) + '"' + (v === (row[name] || '') ? ' selected' : '') + '>' + esc(v || 'בחרו מצב') + '</option>').join('') + '</select></label>';
  return '<div class="mw-opening" data-mw-opening><strong>' + (index + 1) + '.</strong>' +
    field('authority', 'רשות') + field('school', 'בית ספר *') +
    field('program', 'תוכנית *') + field('start_date', 'תאריך התחלה *', 'date') +
    '<button type="button" class="mw-btn" data-mw-remove="' + index + '" ' + editable + '>הסר</button>' +
    field('instructor', 'מדריך / טרם שובץ *') +
    choice('training', 'הכשרה') + choice('materials', 'חומרי הדרכה') + choice('kits', 'ערכות') +
    field('issue', 'חסם או פעולה נדרשת') + '</div>';
}
function formMarkup(ctx) {
  const report = currentReport(ctx);
  const locked = report.status === 'submitted' || !ctx.canEdit;
  const hasReport = !!ctx.reports.find((r) => r.week_start === ctx.week);
  const displayStatus = report.status === 'submitted' ? 'הוגש ' + new Date(report.submitted_at).toLocaleString('he-IL') : hasReport ? 'טיוטה שמורה' : 'טרם מולא';
  const metrics = '<div class="mw-fields">' + MANUAL_METRICS.map(([key, title]) =>
    '<label class="mw-field"><span>' + esc(title) + '</span><input type="number" min="0" step="1" ' +
    'data-mw-metric="' + esc(key) + '" value="' + esc(report.metrics?.[key] ?? '') + '" ' + (locked ? 'disabled' : '') + '/></label>').join('') + '</div>';
  const open = (Array.isArray(report.openings) ? report.openings : []).map((r, i) => openingMarkup(r, i, locked)).join('');
  const openings = '<div class="mw-section"><div class="mw-section-head"><div><h3>פירוט קורסים שצפויים להתחיל</h3><p class="mw-muted">יש להזין שורה לכל קורס. לא מועתקים נתונים אוטומטית ממסך הפעילויות.</p></div>' +
    (!locked ? '<button type="button" class="mw-btn" data-mw-add>+ הוספת פתיחה</button>' : '') + '</div><div data-mw-openings>' + open + '</div></div>';
  const noteFields = [
    ['highlights', 'מה הושלם ומה התחיל השבוע? *'],
    ['next_steps', 'מה מתוכנן לשבוע הבא? *'],
    ['blockers', 'בעיות, עיכובים ומה נדרש מההנהלה'],
    ['instructor_notes', 'מה למדתי על המדריכים וההכשרות?'],
    ['kit_notes', 'מוכנות תוכן, ציוד וערכות']
  ];
  const notes = '<div class="mw-section"><div class="mw-section-head"><h3>הבנה ניהולית וסיכום שבוע</h3></div><div class="mw-textareas">' +
    noteFields.map(([key, title]) => inputField(title, key, report[key], { textarea: true, disabled: locked })).join('') + '</div></div>';
  const buttons = locked ? '<span class="mw-muted">הדיווח הוגש ונעול לעריכה.</span>' : '<button type="button" class="mw-btn" data-mw-save>שמירת טיוטה</button>' +
    '<button type="button" class="mw-btn mw-primary" data-mw-submit>הגשת המעקב השבועי</button>';
  return '<div class="mw-section"><div class="mw-section-head"><h3>הזנה עצמאית – שבוע ' + esc(labelWeek(ctx.week)) + '</h3><span class="mw-tag">' + esc(displayStatus) + '</span></div>' +
    metrics + openings + notes + '<div class="mw-foot">' + buttons + '</div><div data-mw-verification></div></div>';
}
function programMarkup(ctx) {
  const locked = !ctx.canEdit;
  const items = ctx.programs.map((p, index) => {
    const fields = [
      ['purpose', 'מטרות התוכנית'], ['key_content', 'מה לומדים בתוכנית?'],
      ['instructor_training', 'איזה מדריכים מוכשרים ומה נדרש?'],
      ['required_kits', 'איזה חומרים וערכות נדרשים?'],
      ['risks', 'קשיים, בתי ספר ודגשים']
    ];
    return '<div class="mw-program" data-mw-program="' + index + '"><strong>' + esc(p.program_name) + '</strong><div class="mw-program-grid">' +
      fields.map(([key, title]) => '<label class="mw-field"><span>' + esc(title) + '</span><textarea data-mw-program-field="' + key + '" ' + (locked ? 'disabled' : '') + ' maxlength="3000">' + esc(p[key]) + '</textarea></label>').join('') +
      '</div>' + (!locked ? '<div class="mw-foot"><button class="mw-btn" type="button" data-mw-save-program="' + index + '">שמירת היכרות עם התוכנית</button></div>' : '') + '</div>';
  }).join('');
  return '<div class="mw-section"><div class="mw-section-head"><div><h3>היכרות עם תוכניות הלימוד</h3><p class="mw-muted">למלא פעם אחת לכל תוכנית, ולעדכן כאשר משתנה מידע.</p></div></div>' +
    (!locked ? '<div class="mw-left"><input aria-label="שם תוכנית חדשה" data-mw-program-name placeholder="שם תוכנית חדשה" maxlength="180" style="min-height:36px;border:1px solid #cad7e2;border-radius:8px;padding:8px"/><button type="button" class="mw-btn" data-mw-add-program>הוספת תוכנית</button></div>' : '') +
    (items || '<div class="mw-empty">עדיין לא הוזנו תוכניות. מנהל הפעילות יוסיף אותן בעצמו.</div>') + '</div>';
}
function bind(ctx) {
  const root = ctx.host;
  root.querySelector('[data-mw-prev]')?.addEventListener('click', () => changeWeek(ctx, shiftWeek(ctx.week, -1)));
  root.querySelector('[data-mw-next]')?.addEventListener('click', () => changeWeek(ctx, shiftWeek(ctx.week, 1)));
  root.querySelectorAll('[data-mw-week]').forEach((b) => b.addEventListener('click', () => changeWeek(ctx, b.dataset.mwWeek)));
  root.querySelector('[data-mw-save]')?.addEventListener('click', () => saveWeekly(ctx, false));
  root.querySelector('[data-mw-submit]')?.addEventListener('click', () => saveWeekly(ctx, true));
  root.querySelector('[data-mw-add]')?.addEventListener('click', () => adjustOpenings(ctx, null));
  root.querySelectorAll('[data-mw-remove]').forEach((b) => b.addEventListener('click', () => adjustOpenings(ctx, Number(b.dataset.mwRemove))));
  root.querySelector('[data-mw-add-program]')?.addEventListener('click', () => addProgram(ctx));
  root.querySelectorAll('[data-mw-save-program]').forEach((b) => b.addEventListener('click', () => saveProgram(ctx, Number(b.dataset.mwSaveProgram))));
  root.querySelector('[data-mw-check]')?.addEventListener('click', () => verifySubmitted(ctx));
  root.querySelectorAll('input, textarea, select').forEach((input) => input.addEventListener('input', () => { if (ctx.canEdit) ctx.dirty = true; }));
}
function changeWeek(ctx, week) {
  if (!isCurrent(ctx) || ctx.loading || ctx.busy) return;
  if (ctx.dirty && !window.confirm('יש שינויים שלא נשמרו. לעבור שבוע ולבטל אותם?')) return;
  if (ctx.dirty) ctx.reports = JSON.parse(JSON.stringify(ctx.savedReports || []));
  ctx.dirty = false;
  ctx.notice = null;
  ctx.week = week;
  render(ctx);
}
function adjustOpenings(ctx, remove) {
  const report = readForm(ctx);
  if (remove == null) report.openings.push(safeOpening({}));
  else report.openings.splice(remove, 1);
  const ix = ctx.reports.findIndex((r) => r.week_start === ctx.week);
  // Keep unsaved changes only in this in-memory editing state; never claim they are persisted.
  if (ix >= 0) ctx.reports[ix] = report;
  else ctx.reports.push(report);
  ctx.dirty = true;
  render(ctx);
  setNotice(ctx, 'השינויים טרם נשמרו. יש ללחוץ על שמירת טיוטה.');
}
function render(ctx) {
  if (!isCurrent(ctx)) return;
  const roleLabel = ctx.canEdit ? 'הזנה עצמאית למנהל הפעילות' : 'צפייה בדיווחי מנהל הפעילות';
  ctx.host.innerHTML = '<div class="' + TRACKER_CLASS + '">' +
    '<div class="mw-header"><div><h2>מעקב שבועי – פתיחות ומוכנות</h2><p class="mw-muted">' + esc(ctx.managerName) + ' · שנת פעילות ' + esc(ctx.year) + '</p></div><span class="mw-tag">' + esc(roleLabel) + '</span></div>' +
    '<div class="mw-intro"><strong>הנתונים מוזנים על ידי מנהל הפעילות.</strong> יש לעיין בלוח הפעילויות, לבדוק את התכנון ולמלא באופן עצמאי. המסך אינו משלים תשובות ממערכת המקור. בדיקת התאמה תתאפשר לאחר הגשה.</div>' +
    '<div class="mw-toolbar"><div class="mw-left"><button class="mw-btn" type="button" data-mw-prev>‹ שבוע קודם</button><strong>' + labelWeek(ctx.week) + '</strong><button class="mw-btn" type="button" data-mw-next>שבוע הבא ›</button></div><span class="mw-progress">' + ctx.reports.filter((r) => r.status === 'submitted').length + ' שבועות שהוגשו בשנת הפעילות</span></div>' +
    tableMarkup(ctx) + '<div data-mw-notice></div>' + formMarkup(ctx) + programMarkup(ctx) + '</div>';
  bind(ctx);
  if (currentReport(ctx).status === 'submitted') {
    const check = ctx.host.querySelector('[data-mw-verification]');
    if (check) check.innerHTML = '<button type="button" class="mw-btn" data-mw-check>בדיקת התאמה לנתוני המקור (לאחר הגשה)</button>';
    ctx.host.querySelector('[data-mw-check]')?.addEventListener('click', () => verifySubmitted(ctx));
  }
  if (ctx.notice) setNotice(ctx, ctx.notice.message, ctx.notice.error);
}
async function getDirectory() {
  const { data, error } = await supabase.rpc('manager_weekly_manager_directory');
  if (error) throw new Error(error.message || 'שגיאה בטעינת רשימת המנהלים');
  return Array.isArray(data) ? data : [];
}
async function load(ctx) {
  try {
    await waitForSupabaseAuthSession({ timeoutMs: 7000 });
    const directory = await getDirectory();
    if (!isCurrent(ctx)) return;
    const requestedName = val(ctx.managerName).replace(/[״"'׳']/g, '');
    const own = val(state?.user?.user_id);
    const found = directory.find((p) => val(p.manager_name).replace(/[״"'׳']/g, '') === requestedName) ||
      (state?.user?.role === 'activities_manager' ? directory.find((p) => val(p.manager_user_id) === own) : null);
    if (!found) throw new Error('לא נמצא שיוך מורשה למנהל שנבחר. יש לבדוק את שיוך המשתמש.');
    ctx.managerId = found.manager_user_id;
    ctx.managerName = found.manager_name;
    ctx.canEdit = state?.user?.role === 'activities_manager' && val(state?.user?.user_id) === val(found.manager_user_id);
    const [r, p] = await Promise.all([
      supabase.from('manager_weekly_reports').select('*').eq('manager_user_id', ctx.managerId).eq('school_year', ctx.year).order('week_start'),
      supabase.from('manager_program_learning').select('*').eq('manager_user_id', ctx.managerId).eq('school_year', ctx.year).order('program_name')
    ]);
    if (!isCurrent(ctx)) return;
    if (r.error || p.error) throw new Error(r.error?.message || p.error?.message);
    ctx.reports = r.data || [];
    ctx.savedReports = JSON.parse(JSON.stringify(ctx.reports));
    ctx.programs = p.data || [];
    ctx.loading = false;
    render(ctx);
  } catch (error) {
    if (!isCurrent(ctx)) return;
    ctx.host.innerHTML = '<div class="mw-tracker"><div class="mw-error">טעינת המעקב נכשלה: ' + esc(error.message) + '</div><button class="mw-btn" type="button" data-mw-retry>ניסיון חוזר</button></div>';
    ctx.host.querySelector('[data-mw-retry]')?.addEventListener('click', () => load(ctx));
  }
}
async function saveWeekly(ctx, submit) {
  if (!isCurrent(ctx) || !ctx.canEdit || ctx.busy) return;
  const report = readForm(ctx);
  if (submit) {
    const invalid = validateWeeklyReport(report);
    if (invalid) return setNotice(ctx, invalid, true);
  }
  for (const [key] of MANUAL_METRICS) {
    if (report.metrics[key] != null && !validMetric(report.metrics[key])) return setNotice(ctx, 'יש להזין מספרים שלמים שאינם שליליים.', true);
  }
  ctx.busy = true;
  ctx.host.querySelectorAll('[data-mw-save],[data-mw-submit]').forEach((b) => { b.disabled = true; });
  try {
    const payload = {
      manager_user_id: ctx.managerId, school_year: ctx.year, week_start: ctx.week,
      metrics: report.metrics, openings: report.openings,
      highlights: report.highlights, next_steps: report.next_steps, blockers: report.blockers,
      instructor_notes: report.instructor_notes, kit_notes: report.kit_notes,
      status: submit ? 'submitted' : 'draft', submitted_at: submit ? new Date().toISOString() : null
    };
    const { data, error } = await supabase.from('manager_weekly_reports')
      .upsert(payload, { onConflict: 'manager_user_id,school_year,week_start' }).select('*').single();
    if (error) throw error;
    if (!isCurrent(ctx)) return;
    const i = ctx.reports.findIndex((r) => r.week_start === ctx.week);
    if (i < 0) ctx.reports.push(data);
    else ctx.reports[i] = data;
    ctx.dirty = false;
    ctx.savedReports = JSON.parse(JSON.stringify(ctx.reports));
    render(ctx);
    setNotice(ctx, submit ? 'הדיווח הוגש וננעל לעריכה. כעת ניתן לבדוק התאמה לנתוני המקור.' : 'הטיוטה נשמרה בהצלחה.');
  } catch (error) {
    setNotice(ctx, 'השמירה נכשלה: ' + error.message, true);
  } finally {
    ctx.busy = false;
    ctx.host.querySelectorAll('[data-mw-save],[data-mw-submit]').forEach((b) => { b.disabled = false; });
  }
}
async function addProgram(ctx) {
  if (!isCurrent(ctx) || !ctx.canEdit) return;
  const name = val(ctx.host.querySelector('[data-mw-program-name]')?.value);
  if (!name) return setNotice(ctx, 'יש לרשום את שם התוכנית.', true);
  if (ctx.programs.some((p) => p.program_name === name)) return setNotice(ctx, 'תוכנית זו כבר מופיעה ברשימה.', true);
  const payload = { manager_user_id: ctx.managerId, school_year: ctx.year, program_name: name };
  const { data, error } = await supabase.from('manager_program_learning').insert(payload).select('*').single();
  if (error) return setNotice(ctx, 'הוספת התוכנית נכשלה: ' + error.message, true);
  if (!isCurrent(ctx)) return;
  ctx.programs.push(data);
  render(ctx);
  setNotice(ctx, 'התוכנית נוספה. כעת יש ללמוד את פרטיה ולהשלים את שדות ההיכרות.');
}
async function saveProgram(ctx, index) {
  if (!isCurrent(ctx) || !ctx.canEdit) return;
  const current = ctx.programs[index];
  const card = ctx.host.querySelector('[data-mw-program="' + index + '"]');
  if (!current || !card) return;
  const payload = {};
  for (const key of ['purpose', 'key_content', 'instructor_training', 'required_kits', 'risks']) {
    payload[key] = val(card.querySelector('[data-mw-program-field="' + key + '"]')?.value);
  }
  const { data, error } = await supabase.from('manager_program_learning').update(payload).eq('id', current.id).select('*').single();
  if (error) return setNotice(ctx, 'שמירת התוכנית נכשלה: ' + error.message, true);
  if (!isCurrent(ctx)) return;
  ctx.programs[index] = data;
  setNotice(ctx, 'פרטי ההיכרות עם התוכנית נשמרו.');
}
async function verifySubmitted(ctx) {
  if (!isCurrent(ctx) || currentReport(ctx).status !== 'submitted') return;
  const node = ctx.host.querySelector('[data-mw-verification]');
  if (!node) return;
  node.innerHTML = '<div class="mw-verify">בודק נתוני מקור…</div>';
  const period = ctx.year === '2027' ? 'school_2027' : 'school_2026';
  const { data, error } = await supabase.from('activities')
    .select('row_id,activity_manager,school,school_id,date_1,emp_id,status')
    .in('activity_season', activitySeasonQueryValues(period))
    .eq('activity_manager', ctx.managerName);
  if (!isCurrent(ctx) || !ctx.host.contains(node)) return;
  if (error) { node.innerHTML = '<div class="mw-error">בדיקת המקור לא זמינה: ' + esc(error.message) + '</div>'; return; }
  const rows = (data || []).filter((a) => !CLOSED.has(val(a.status).toLowerCase()));
  const unique = [...new Map(rows.map((a) => [a.row_id, a])).values()];
  const schoolKeys = new Set(unique.map((a) => a.school_id ? 'id:' + a.school_id : (val(a.school) ? 'name:' + val(a.school) : '')).filter(Boolean));
  const counts = {
    activities: unique.length,
    schools: schoolKeys.size,
    unassigned: unique.filter((a) => !a.emp_id).length,
    planned: unique.filter((a) => a.date_1 && weekStartIso(a.date_1) === ctx.week).length
  };
  const entry = currentReport(ctx);
  const details = Object.entries(counts).map(([key, n]) => {
    const label = MANUAL_METRICS.find((m) => m[0] === key)?.[1] || key;
    const entered = entry.metrics?.[key];
    return '<li>' + esc(label) + ': דיווח ' + esc(entered ?? 'חסר') + ' | מערכת ' + n + (Number(entered) === n ? ' ✓' : ' — לבדיקה') + '</li>';
  });
  node.innerHTML = '<div class="mw-verify"><strong>השוואה לנתוני הפעילויות אחרי הגשה</strong><p class="mw-muted">השוואת מקור נוכחי בלבד; אינה מתקנת את דיווח המנהל ולא מאמתת ביצוע מפגש ראשון.</p><ul>' + details.join('') + '</ul></div>';
}

/** Called only when the manager Gantt tab is active, never during initial board render. */
export function mountManagerWeeklyManual(host, context) {
  ensureStyle();
  const key = contextKey(context);
  if (active && active.host === host && active.key === key) return;
  const ctx = {
    ...context, key, host, week: initialWeek(context.ym), reports: [], programs: [],
    managerId: '', canEdit: false, loading: true, busy: false, dirty: false, notice: null
  };
  active = ctx;
  host.innerHTML = '<div class="mw-tracker"><div class="mw-empty">טוען סביבת מעקב שבועי…</div></div>';
  void load(ctx);
}
