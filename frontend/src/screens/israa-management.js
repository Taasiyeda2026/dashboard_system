import { escapeHtml } from './shared/html.js';
import { dsScreenStack } from './shared/layout.js';

const ISRAA_AUTH_USER_ID = '92bfb9d9-1b17-4022-901a-5f7cf17a263a';
const SIM_GOAL = 1_000_000;

// ── Tab state (persists across renders / navigations) ──────────────────────────
let _activeTab = 'table';

// ── Program-tracking table state ───────────────────────────────────────────────
let _rows      = [];
let _editingId = null;
let _editData  = {};
let _addingNew = false;
let _newData   = {};
let _error      = null;
let _expandedId = null; // which prog row has its contact details open

// ── Simulator state ────────────────────────────────────────────────────────────
// _simLoaded / _simLoading guard: data is fetched exactly once per session.
// Supabase is only called for explicit user actions (add / edit / delete).
let _simRows      = [];
let _simLoaded    = false;
let _simLoading   = false;
let _simEditingId = null;
let _simEditData  = {};
let _simAddingNew = false;
let _simNewData   = {};
let _simError     = null;
let _simCollab    = 0;    // session-local collaboration total, never persisted to DB

// ── Constants ──────────────────────────────────────────────────────────────────
const STATUS_OPTIONS = ['', 'נשלחה הצעה', 'גפן תשפ"ז', 'תוכנית קיץ'];

const PROG_COLS = [
  { key: 'authority',      label: 'רשות',        type: 'text' },
  { key: 'school_name',    label: 'שם ביה"ס',     type: 'text' },
  { key: 'contact_person', label: 'איש קשר',      type: 'text' },
  { key: 'phone',          label: 'טלפון',        type: 'tel' },
  { key: 'email',          label: 'אימייל',        type: 'email' },
  { key: 'program_name',   label: 'תוכנית',       type: 'program' },
  { key: 'quantity',       label: 'כמות',         type: 'number' },
  { key: 'total_cost',     label: 'סה"כ עלות',    type: 'text' },
  { key: 'activity_date',  label: 'תאריך',        type: 'date' },
  { key: 'status',         label: 'סטטוס',        type: 'status' },
  { key: 'notes',          label: 'הערות',        type: 'text' },
];

// Contact fields stay hidden in the outer row and appear only in the expandable detail row
const PROG_CONTACT_KEYS = new Set(['contact_person', 'phone', 'email']);
const PROG_MAIN_COL_DEFS    = PROG_COLS.filter((c) => !PROG_CONTACT_KEYS.has(c.key));
const PROG_CONTACT_COL_DEFS = PROG_COLS.filter((c) =>  PROG_CONTACT_KEYS.has(c.key));

// ── Access guard ───────────────────────────────────────────────────────────────
function isAllowedUser(state) {
  const userId = String(state?.user?.user_id || '');
  const authId = String(state?.user?.auth_user_id || '');
  const role   = String(state?.user?.display_role || state?.user?.role || '');
  return userId === '3030' || authId === ISRAA_AUTH_USER_ID || role === 'admin';
}

function getActivityNames(state) {
  const items = state?.clientSettings?.dropdown_options?.activity_names;
  if (!Array.isArray(items)) return [];
  return items.map((i) => String(i.label || i.value || '')).filter(Boolean);
}

// ── Formatting helpers ─────────────────────────────────────────────────────────
function fmtIls(num) {
  const formatted = (Number(num) || 0).toLocaleString('he-IL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  // Keep the number and currency sign together in the correct visual order inside RTL text.
  return `<span class="money money--ils" dir="ltr">${formatted}&nbsp;₪</span>`;
}

function fmtDate(val) {
  if (!val) return '';
  try {
    const d = new Date(val);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  } catch { return String(val); }
}

// ══════════════════════════════════════════════════════════════════════════════
// PROGRAM TRACKING TABLE — HTML builders (pure, no side effects)
// ══════════════════════════════════════════════════════════════════════════════
function progCellView(row, col) {
  if (col.key === 'activity_date') return escapeHtml(fmtDate(row?.[col.key]));
  return escapeHtml(String(row?.[col.key] ?? ''));
}

function progCellEdit(key, value, col, actNames) {
  const v = escapeHtml(String(value ?? ''));
  if (col.type === 'status') {
    return `<select class="israa-inp" name="${key}">${STATUS_OPTIONS.map((s) =>
      `<option value="${escapeHtml(s)}"${s === (value ?? '') ? ' selected' : ''}>${escapeHtml(s || '(ריק)')}</option>`
    ).join('')}</select>`;
  }
  if (col.type === 'program') {
    if (actNames.length) {
      return `<select class="israa-inp" name="${key}">${['', ...actNames].map((s) =>
        `<option value="${escapeHtml(s)}"${s === (value ?? '') ? ' selected' : ''}>${escapeHtml(s || '(ריק)')}</option>`
      ).join('')}</select>`;
    }
    return `<input class="israa-inp" name="${key}" type="text" value="${v}" />`;
  }
  if (col.type === 'number') return `<input class="israa-inp" name="${key}" type="number" min="1" max="999" value="${v}" />`;
  if (col.type === 'date')   return `<input class="israa-inp" name="${key}" type="date" value="${v}" />`;
  return `<input class="israa-inp" name="${key}" type="text" value="${v}" />`;
}

function progRowHtml(row, editingId, editData, expandedId, actNames) {
  const ed         = row.id === editingId;
  const isExpanded = ed || row.id === expandedId;

  const mainCells = PROG_MAIN_COL_DEFS.map((col) => {
    const c = ed ? progCellEdit(col.key, editData[col.key] ?? row[col.key], col, actNames) : progCellView(row, col);
    return `<td class="israa-cell${col.key === 'notes' ? ' israa-cell--notes' : ''}">${c}</td>`;
  }).join('');

  const actions = ed
    ? `<td class="israa-cell israa-cell--actions"><button class="israa-btn israa-btn--save" data-israa-save="${escapeHtml(row.id)}" title="שמירה">💾</button> <button class="israa-btn israa-btn--cancel" data-israa-cancel="${escapeHtml(row.id)}" title="ביטול">✕</button></td>`
    : `<td class="israa-cell israa-cell--actions"><button class="israa-btn israa-btn--edit" data-israa-edit="${escapeHtml(row.id)}" title="עריכה">✏️</button> <button class="israa-btn israa-btn--del" data-israa-del="${escapeHtml(row.id)}" title="מחיקה">🗑️</button></td>`;

  const mainRow = `<tr class="israa-row${ed ? ' israa-row--editing' : ''}" data-row-id="${escapeHtml(row.id)}"${!ed ? ` data-prog-toggle="${escapeHtml(row.id)}"` : ''}>${mainCells}${actions}</tr>`;

  if (!isExpanded) return mainRow;

  let detailContent;
  if (ed) {
    detailContent = PROG_CONTACT_COL_DEFS.map((col) => {
      const inp = progCellEdit(col.key, editData[col.key] ?? row[col.key], col, actNames);
      return `<div class="prog-detail__field"><span class="prog-detail__lbl">${escapeHtml(col.label)}:</span>${inp}</div>`;
    }).join('');
  } else {
    const parts = PROG_CONTACT_COL_DEFS.map((col) => {
      const val = String(row[col.key] ?? '');
      return val ? `<span class="prog-detail__item"><span class="prog-detail__lbl">${escapeHtml(col.label)}:</span> <span>${escapeHtml(val)}</span></span>` : '';
    }).join('');
    detailContent = parts || `<span class="prog-detail__empty">אין פרטי איש קשר</span>`;
  }

  return mainRow + `<tr class="prog-detail-row" data-detail-for="${escapeHtml(row.id)}"><td colspan="${PROG_MAIN_COL_DEFS.length + 1}" class="prog-detail-cell${ed ? ' prog-detail-cell--edit' : ''}">${detailContent}</td></tr>`;
}

function progNewRowHtml(newData, actNames) {
  const mainCells = PROG_MAIN_COL_DEFS.map((col) =>
    `<td class="israa-cell${col.key === 'notes' ? ' israa-cell--notes' : ''}">${progCellEdit(col.key, newData[col.key], col, actNames)}</td>`
  ).join('');
  const contactCells = PROG_CONTACT_COL_DEFS.map((col) => {
    const inp = progCellEdit(col.key, newData[col.key], col, actNames);
    return `<div class="prog-detail__field"><span class="prog-detail__lbl">${escapeHtml(col.label)}:</span>${inp}</div>`;
  }).join('');
  return `<tr class="israa-row israa-row--new" data-row-id="__new__">${mainCells}<td class="israa-cell israa-cell--actions"><button class="israa-btn israa-btn--save" data-israa-save-new title="שמירה">💾</button> <button class="israa-btn israa-btn--cancel" data-israa-cancel-new title="ביטול">✕</button></td></tr><tr class="prog-detail-row"><td colspan="${PROG_MAIN_COL_DEFS.length + 1}" class="prog-detail-cell prog-detail-cell--edit">${contactCells}</td></tr>`;
}

function progTableHtml(rows, editingId, editData, addingNew, newData, error, expandedId, actNames) {
  const hdr = PROG_MAIN_COL_DEFS.map((c) =>
    `<th class="israa-th${c.key === 'notes' ? ' israa-th--notes' : ''}">${escapeHtml(c.label)}</th>`
  ).join('');
  const colCount = PROG_MAIN_COL_DEFS.length + 1;
  const body = [
    !rows.length && !addingNew ? `<tr><td colspan="${colCount}" class="israa-empty">אין רשומות. לחצי "+ הוספת שורה" להתחיל.</td></tr>` : '',
    rows.map((r) => progRowHtml(r, editingId, editData, expandedId, actNames)).join(''),
    addingNew ? progNewRowHtml(newData, actNames) : ''
  ].join('');
  return `<div class="israa-toolbar">
    <button class="israa-btn israa-btn--primary" data-israa-action="add-row"${addingNew ? ' disabled' : ''}>+ הוספת שורה</button>
    <button class="israa-btn" data-israa-action="export-csv">📥 ייצוא לאקסל</button>
  </div>
  <div class="prog-section">
    ${error ? `<div class="israa-error">${escapeHtml(error)}</div>` : ''}
    <div class="israa-table-wrap">
      <table class="israa-table prog-table" dir="rtl">
        <thead><tr>${hdr}<th class="israa-th israa-th--actions">פעולות</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// SIMULATOR — all calculations are LOCAL, no network calls
// ══════════════════════════════════════════════════════════════════════════════

// Pure local computation — never triggers a network request
function simCalc(rows, collab) {
  const collabAmt = Number(collab) || 0;
  const total     = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const reached   = total + collabAmt;
  const balance   = SIM_GOAL - reached;
  const remaining = Math.max(0, balance);
  const rawPct    = (reached / SIM_GOAL) * 100;
  const overGoal  = balance <= 0;
  const overAmt   = Math.max(0, reached - SIM_GOAL);
  return { total, collabAmt, reached, balance, remaining, rawPct, overGoal, overAmt };
}

// Pure local calculation — no network calls. Returns safe HTML (numbers + fixed strings only).
function simGoalLines(calc) {
  if (calc.overGoal || calc.balance <= 0) {
    const lines = ['<strong class="sim-goal-opts__highlight">היעד הושג.</strong> אין צורך בקורסים או סדנאות נוספים כדי להגיע ליעד.'];
    if (calc.overAmt > 0) lines.push(`מעבר ליעד: <strong class="sim-goal-opts__highlight">+${fmtIls(calc.overAmt)}</strong>`);
    return lines.join('<br>');
  }
  const courses   = Math.ceil(calc.balance * 0.7 / 9000);
  const workshops = Math.ceil(calc.balance * 0.3 / 500);
  const coursesText = courses.toLocaleString('he-IL');
  const workshopsText = workshops.toLocaleString('he-IL');
  return [
    `להגעה ליעד אפשר להביא עוד <strong class="sim-goal-opts__highlight">${coursesText} קורסים</strong> במחיר ממוצע של <strong class="sim-goal-opts__highlight">${fmtIls(9000)}</strong> לקורס.`,
    `להגעה ליעד אפשר להביא עוד <strong class="sim-goal-opts__highlight">${workshopsText} סדנאות מייקרים</strong> במחיר ממוצע של <strong class="sim-goal-opts__highlight">${fmtIls(500)}</strong> לסדנה.`
  ].join('<br>');
}

function simCardsHtml(calc) {
  const { total, remaining, rawPct, overGoal, overAmt } = calc;
  const pctStr = rawPct.toFixed(1) + '%';
  return `<div class="sim-cards">
    <div class="sim-card"><div class="sim-card__lbl">יעד הכנסות</div><div class="sim-card__val sim-card__val--goal">${fmtIls(SIM_GOAL)}</div></div>
    <div class="sim-card"><div class="sim-card__lbl">סה"כ הכנסות</div><div class="sim-card__val">${fmtIls(total)}</div></div>
    <div class="sim-card"><div class="sim-card__lbl">נותר ליעד</div><div class="sim-card__val${overGoal ? ' sim-card__val--over' : ''}">${overGoal ? fmtIls(0) : fmtIls(remaining)}</div></div>
    <div class="sim-card${overGoal ? ' sim-card--highlight' : ''}"><div class="sim-card__lbl">התקדמות</div><div class="sim-card__val${overGoal ? ' sim-card__val--over' : ''}">${pctStr}${overGoal ? ' 🎉' : ''}</div></div>
    ${overGoal ? `<div class="sim-card sim-card--over-banner"><div class="sim-card__lbl">מעבר ליעד</div><div class="sim-card__val sim-card__val--over">+${fmtIls(overAmt)}</div></div>` : ''}
  </div>`;
}

function simProgressHtml(calc) {
  const fill = Math.min(calc.rawPct, 100).toFixed(2);
  return `<div class="sim-progress" dir="rtl">
    <div class="sim-progress__head"><span class="sim-progress__pct">${calc.rawPct.toFixed(1)}%</span></div>
    <div class="sim-progress__track"><div class="sim-progress__fill${calc.overGoal ? ' sim-progress__fill--over' : ''}" style="width:${fill}%"></div></div>
  </div>`;
}

function simGoalOptionsHtml(calc, collab) {
  const collabAmt = Number(collab) || 0;
  return `<div class="sim-goal-opts">
    <div class="sim-goal-opts__title">אפשרויות להגעה ליעד</div>
    <div class="sim-goal-opts__collab-row">
      <label class="sim-goal-opts__collab-label">
        <span>סה"כ שיתופי פעולה:</span>
        <input class="israa-inp sim-goal-opts__collab-inp" type="number" min="0" step="1"
               value="${escapeHtml(String(collabAmt))}" data-sim-collab placeholder="0" />
        <span class="sim-goal-opts__formatted" data-sim-collab-formatted>${fmtIls(collabAmt)}</span>
      </label>
    </div>
    <div class="sim-goal-opts__result" data-sim-goal-result>${simGoalLines(calc)}</div>
  </div>`;
}

function simRowHtml(row, editingId, editData) {
  const ed      = row.id === editingId;
  const dateRaw = ed ? (editData.revenue_date ?? row.revenue_date ?? '') : (row.revenue_date ?? '');
  const payerV  = ed ? escapeHtml(String(editData.payer_name ?? row.payer_name ?? '')) : escapeHtml(String(row.payer_name ?? ''));
  const amtRaw  = ed ? (editData.amount ?? row.amount ?? '') : (row.amount ?? '');
  const comm    = Number(amtRaw) > 0 ? Number(amtRaw) * 0.1 : null;
  const dateCell  = ed
    ? `<td class="israa-cell sim-cell--date"><input class="israa-inp" name="revenue_date" type="date" value="${escapeHtml(String(dateRaw))}" /></td>`
    : `<td class="israa-cell sim-cell--date">${escapeHtml(fmtDate(dateRaw))}</td>`;
  const payerCell = ed
    ? `<td class="israa-cell"><input class="israa-inp" name="payer_name" type="text" value="${payerV}" /></td>`
    : `<td class="israa-cell">${payerV}</td>`;
  const amtCell   = ed
    ? `<td class="israa-cell sim-cell--amt"><input class="israa-inp sim-inp--amt" name="amount" type="number" min="0" step="1" value="${escapeHtml(String(amtRaw))}" /></td>`
    : `<td class="israa-cell sim-cell--amt">${amtRaw !== '' && amtRaw != null ? fmtIls(amtRaw) : ''}</td>`;
  const commCell  = `<td class="israa-cell sim-cell--comm">${comm != null ? fmtIls(comm) : ''}</td>`;
  const actions   = ed
    ? `<td class="israa-cell israa-cell--actions"><button class="israa-btn israa-btn--save" data-sim-save="${escapeHtml(row.id)}" title="שמירה">💾</button> <button class="israa-btn israa-btn--cancel" data-sim-cancel="${escapeHtml(row.id)}" title="ביטול">✕</button></td>`
    : `<td class="israa-cell israa-cell--actions"><button class="israa-btn israa-btn--edit" data-sim-edit="${escapeHtml(row.id)}" title="עריכה">✏️</button> <button class="israa-btn israa-btn--del" data-sim-del="${escapeHtml(row.id)}" title="מחיקה">🗑️</button></td>`;
  return `<tr class="israa-row${ed ? ' israa-row--editing' : ''}" data-sim-row-id="${escapeHtml(row.id)}">${dateCell}${payerCell}${amtCell}${commCell}${actions}</tr>`;
}

function simNewRowHtml(newData) {
  return `<tr class="israa-row israa-row--new">
    <td class="israa-cell sim-cell--date"><input class="israa-inp" name="revenue_date" type="date" value="${escapeHtml(String(newData.revenue_date ?? ''))}" /></td>
    <td class="israa-cell"><input class="israa-inp" name="payer_name" type="text" value="${escapeHtml(String(newData.payer_name ?? ''))}" placeholder="גורם משלם" /></td>
    <td class="israa-cell sim-cell--amt"><input class="israa-inp sim-inp--amt" name="amount" type="number" min="0" step="1" value="${escapeHtml(String(newData.amount ?? ''))}" placeholder="0" /></td>
    <td class="israa-cell sim-cell--comm"></td>
    <td class="israa-cell israa-cell--actions"><button class="israa-btn israa-btn--save" data-sim-save-new title="שמירה">💾</button> <button class="israa-btn israa-btn--cancel" data-sim-cancel-new title="ביטול">✕</button></td>
  </tr>`;
}

function simPanelHtml(rows, editingId, editData, addingNew, newData, error, loading, collab) {
  if (loading) return `<div class="sim-loading">טוען נתוני סימולטור…</div>`;
  const calc = simCalc(rows, collab);
  const body = [
    !rows.length && !addingNew ? `<tr><td colspan="5" class="israa-empty">אין הכנסות. לחצי "+ הוספת הכנסה" להתחיל.</td></tr>` : '',
    rows.map((r) => simRowHtml(r, editingId, editData)).join(''),
    addingNew ? simNewRowHtml(newData) : ''
  ].join('');
  return `
  ${simCardsHtml(calc)}
  ${simProgressHtml(calc)}
  ${simGoalOptionsHtml(calc, collab)}
  <div class="sim-table-section">
    <div class="israa-toolbar">
      <button class="israa-btn israa-btn--primary" data-sim-action="add-row"${addingNew ? ' disabled' : ''}>+ הוספת הכנסה</button>
    </div>
    ${error ? `<div class="israa-error">${escapeHtml(error)}</div>` : ''}
    <div class="israa-table-wrap">
      <table class="israa-table sim-table" dir="rtl">
        <thead><tr>
          <th class="israa-th sim-th--date">תאריך</th>
          <th class="israa-th">גורם משלם</th>
          <th class="israa-th sim-th--amt">סכום (₪)</th>
          <th class="israa-th sim-th--comm">עמלות (₪)</th>
          <th class="israa-th israa-th--actions">פעולות</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>`;
}

// ── Tab bar + full HTML ─────────────────────────────────────
function tabBarHtml(activeTab) {
  return `<div class="israa-tabbar" role="tablist" dir="rtl">
    <button class="israa-tab${activeTab === 'table' ? ' is-active' : ''}" data-israa-tab="table" role="tab">טבלת תוכניות</button>
    <button class="israa-tab${activeTab === 'simulator' ? ' is-active' : ''}" data-israa-tab="simulator" role="tab">סימולטור</button>
  </div>`;
}

function fullHtml(activeTab, actNames) {
  if (activeTab === 'simulator') {
    return tabBarHtml(activeTab) +
      `<div class="sim-panel">${simPanelHtml(_simRows, _simEditingId, _simEditData, _simAddingNew, _simNewData, _simError, _simLoading, _simCollab)}</div>`;
  }
  return tabBarHtml(activeTab) + progTableHtml(_rows, _editingId, _editData, _addingNew, _newData, _error, _expandedId, actNames);
}

// ── CSV export ──────────────────────────────────────────────
function exportToCsv(rows) {
  const hdr = PROG_COLS.map((c) => c.label);
  const csvRows = [hdr.join(','), ...rows.map((row) =>
    PROG_COLS.map((col) => {
      let v = String(row[col.key] ?? '');
      if (v.includes(',') || v.includes('"') || v.includes('\n')) v = '"' + v.replace(/"/g, '""') + '"';
      return v;
    }).join(',')
  )];
  const blob = new Blob(['﻿' + csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'israa-program-tracking.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ── Form data collectors ────────────────────────────────────
function collectProgForm(mainTr) {
  // Contact fields live in the adjacent prog-detail-row; check there too
  const detailTr = mainTr.nextElementSibling?.classList.contains('prog-detail-row')
    ? mainTr.nextElementSibling : null;
  const data = {};
  PROG_COLS.forEach((col) => {
    const inp = mainTr.querySelector(`[name="${col.key}"]`)
             || (detailTr ? detailTr.querySelector(`[name="${col.key}"]`) : null);
    if (!inp) return;
    data[col.key] = col.type === 'number' ? (inp.value === '' ? null : parseInt(inp.value, 10))
                  : col.type === 'date'   ? (inp.value || null)
                  : inp.value;
  });
  return data;
}

function collectSimForm(tr) {
  const amtVal  = tr.querySelector('[name="amount"]')?.value ?? '';
  const dateVal = tr.querySelector('[name="revenue_date"]')?.value ?? '';
  return {
    revenue_date: dateVal || null,
    payer_name:   tr.querySelector('[name="payer_name"]')?.value ?? '',
    amount:       amtVal === '' ? null : parseFloat(amtVal)
  };
}

// ═════════════════════════════════════════════════════════════
// CSS
// ═════════════════════════════════════════════════════════════
const ISRAA_CSS = `<style data-israa-styles>
.israa-mgmt{direction:rtl}
.israa-tabbar{display:flex;gap:4px;margin-bottom:14px;border-bottom:2px solid var(--ds-border,#e2e8f0)}
.israa-tab{background:none;border:none;border-bottom:3px solid transparent;padding:8px 18px;font-size:14px;cursor:pointer;color:var(--ds-text-secondary,#64748b);margin-bottom:-2px;transition:color .15s,border-color .15s}
.israa-tab.is-active{color:var(--ds-accent,#1a3358);border-bottom-color:var(--ds-accent,#1a3358);font-weight:600}
.israa-toolbar{display:flex;gap:8px;margin-bottom:10px;align-items:center}
.israa-table-wrap{overflow-x:auto;border:1px solid var(--ds-border,#e2e8f0);border-radius:6px;background:#fff}
.israa-table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed;background:#fff}
.israa-th{background:var(--ds-table-head-bg,#f1f5f9);padding:5px 8px;text-align:right;font-weight:600;white-space:nowrap;border-bottom:1px solid var(--ds-border,#e2e8f0);font-size:12px}
.money{display:inline-block;direction:ltr;unicode-bidi:isolate;white-space:nowrap;font-variant-numeric:tabular-nums}
.israa-th--actions{width:72px;text-align:center}
.israa-cell{padding:3px 6px;border-bottom:1px solid var(--ds-border,#f1f5f9);vertical-align:middle;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.israa-cell--actions{text-align:center;white-space:nowrap;overflow:visible;width:72px}
.israa-row:last-child .israa-cell{border-bottom:none}
.israa-row:hover .israa-cell{background:var(--ds-row-hover,#f8fafc)}
.israa-row--editing .israa-cell{background:#fffbeb}
.israa-row--new .israa-cell{background:#f0fdf4}
.israa-empty{text-align:center;padding:28px;color:var(--ds-text-secondary,#94a3b8);font-size:13px}
.israa-inp{width:100%;min-width:0;padding:2px 5px;font-size:11px;border:1px solid #cbd5e1;border-radius:3px;background:#fff;box-sizing:border-box}
.israa-inp:focus{outline:2px solid var(--ds-accent,#1a3358);outline-offset:0}
.israa-error{background:#fef2f2;border:1px solid #fca5a5;color:#b91c1c;border-radius:4px;padding:8px 12px;margin-bottom:8px;font-size:13px}
.israa-btn{padding:3px 7px;font-size:11px;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer;background:#fff;color:var(--ds-text,#1e293b);line-height:1.4;white-space:nowrap}
.israa-btn:hover{background:#f1f5f9}
.israa-btn:disabled{opacity:.5;cursor:default}
.israa-btn--primary{background:var(--ds-accent,#1a3358);color:#fff;border-color:var(--ds-accent,#1a3358);font-size:12px;padding:4px 10px}
.israa-btn--primary:hover:not(:disabled){opacity:.88}
.israa-btn--save{background:#16a34a;color:#fff;border-color:#16a34a}
.israa-btn--save:hover:not(:disabled){opacity:.85}
.israa-btn--del{background:#dc2626;color:#fff;border-color:#dc2626}
.israa-btn--del:hover:not(:disabled){opacity:.85}
.israa-btn--cancel{background:#64748b;color:#fff;border-color:#64748b}
.israa-btn--edit{background:var(--ds-accent,#1a3358);color:#fff;border-color:var(--ds-accent,#1a3358)}
.sim-panel{direction:rtl}
.sim-loading{padding:28px;text-align:center;color:var(--ds-text-secondary,#64748b);font-size:14px}
.sim-cards{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px;justify-content:center}
.sim-card{background:#fff;border:1px solid var(--ds-border,#e2e8f0);border-radius:8px;padding:10px 14px;min-width:120px;max-width:200px;flex:0 1 auto;box-shadow:0 1px 2px rgba(0,0,0,.04);text-align:center}
.sim-card--highlight{border-color:var(--ds-accent,#1a3358);background:#f0f4ff}
.sim-card--over-banner{border-color:#16a34a;background:#f0fdf4}
.sim-card__lbl{font-size:13px;color:var(--ds-text-secondary,#64748b);margin-bottom:4px;white-space:nowrap}
.sim-card__val{font-size:17px;font-weight:700;color:var(--ds-text,#1e293b);white-space:nowrap}
.sim-card__val--goal{color:#1a3358}
.sim-card__val--over{color:#16a34a}
.sim-progress{max-width:680px;margin:0 auto 16px;direction:rtl}
.sim-progress__head{display:flex;justify-content:flex-start;margin-bottom:5px}
.sim-progress__track{height:10px;background:#e2e8f0;border-radius:99px;overflow:hidden;display:flex;justify-content:flex-start;direction:rtl}
.sim-progress__fill{height:100%;background:var(--ds-accent,#1a3358);border-radius:99px;transition:width .4s ease}
.sim-progress__fill--over{background:#16a34a}
.sim-progress__pct{font-size:12px;font-weight:700;white-space:nowrap;min-width:40px;color:var(--ds-text,#1e293b)}
.sim-goal-opts{background:#fff;border:1.5px solid #cbd5e1;border-radius:10px;padding:14px 18px;margin:0 auto 16px;max-width:880px;box-shadow:0 2px 8px rgba(26,51,88,.05)}
.sim-goal-opts__title{font-size:17px;font-weight:800;color:var(--ds-text,#1e293b);margin-bottom:10px;text-align:right}
.sim-goal-opts__collab-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.sim-goal-opts__collab-label{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:var(--ds-text,#1e293b);flex-wrap:wrap}
.sim-goal-opts__collab-inp{width:120px!important;text-align:left;direction:ltr}
.sim-goal-opts__formatted{font-size:14px;font-weight:700;color:var(--ds-text,#1e293b)}
.sim-goal-opts__result{font-size:15px;font-weight:600;color:var(--ds-text,#1e293b);line-height:1.9}
.sim-goal-opts__highlight{font-weight:800;color:var(--ds-accent,#1a3358)}
.sim-table-section{margin-top:6px;display:flex;flex-direction:column;align-items:flex-end}
.sim-table-section .israa-toolbar{width:fit-content;min-width:520px;max-width:100%;justify-content:flex-start}
.sim-table-section .israa-table-wrap{width:fit-content;min-width:520px;max-width:100%;background:#fff;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 2px 8px rgba(26,51,88,.06)}
@media (max-width:700px){.sim-table-section .israa-toolbar,.sim-table-section .israa-table-wrap{width:100%;min-width:0}}
.sim-table{table-layout:auto;width:auto;background:#fff;border-collapse:separate;border-spacing:0}
.sim-table .israa-th{background:#f8fafc;border-bottom:1px solid #cbd5e1;border-inline-start:1px solid #e2e8f0;font-weight:700}
.sim-table .israa-th:first-child{border-inline-start:none}
.sim-table .israa-cell{background:#fff;border-bottom:1px solid #e2e8f0;border-inline-start:1px solid #eef2f7}
.sim-table .israa-cell:first-child{border-inline-start:none}
.sim-table .israa-row:nth-child(even) .israa-cell{background:#fbfdff}
.sim-table .israa-row:hover .israa-cell{background:#f8fafc}
.sim-th--date{width:90px;text-align:right}
.sim-th--amt{width:112px;text-align:right}
.sim-th--comm{width:106px;text-align:right}
.sim-cell--date{text-align:right;white-space:nowrap}
.sim-cell--amt{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.sim-cell--comm{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--ds-text-secondary,#64748b)}
.sim-inp--amt{text-align:left;direction:ltr}
.prog-section{max-width:80%}
@media (max-width:768px){.prog-section{max-width:100%}}
.prog-section .israa-table-wrap{background:#fff;box-shadow:0 2px 8px rgba(26,51,88,.07)}
.prog-table{table-layout:auto}
.israa-th--notes{min-width:140px}
.israa-cell--notes{white-space:normal;word-break:break-word}
.prog-table .israa-row[data-prog-toggle]{cursor:pointer}
.prog-detail-row .prog-detail-cell{background:#eef2fa;padding:8px 14px;border-bottom:1px solid var(--ds-border,#e2e8f0)}
.prog-detail__item{display:inline-flex;gap:4px;align-items:center;font-size:12px;color:var(--ds-text,#1e293b);margin-left:18px}
.prog-detail__lbl{font-weight:600;color:var(--ds-text-secondary,#64748b);white-space:nowrap}
.prog-detail__empty{color:var(--ds-text-secondary,#94a3b8);font-size:12px;font-style:italic}
.prog-detail-cell--edit{background:#fffbeb!important}
.prog-detail-cell--edit .prog-detail__field{display:inline-flex;align-items:center;gap:6px;font-size:12px;margin-left:14px}
.prog-detail-cell--edit .prog-detail__field .israa-inp{width:150px!important}
</style>`;

// ═════════════════════════════════════════════════════════════
// SCREEN EXPORT
// ═════════════════════════════════════════════════════════════
export const israaManagementScreen = {
  load: async ({ api, state }) => {
    if (!isAllowedUser(state)) return { rows: [] };
    const result = await api.israaProgramTracking();
    _rows = Array.isArray(result?.rows) ? result.rows : [];
    return { rows: _rows };
  },

  render(data, { state } = {}) {
    if (!isAllowedUser(state)) {
      return dsScreenStack('<div style="padding:24px;color:#b91c1c;direction:rtl">אין גישה לעמוד זה.</div>');
    }
    if (data?.rows) _rows = Array.isArray(data.rows) ? data.rows : _rows;
    return dsScreenStack(ISRAA_CSS + '<div class="israa-mgmt">' + fullHtml(_activeTab, getActivityNames(state)) + '</div>');
  },

  bind({ root, state, api }) {
    const mgmt = root.querySelector('.israa-mgmt');
    if (!mgmt) return;

    // repaint() replaces only mgmt's innerHTML.
    // The delegated listeners on mgmt itself are NOT removed — they persist.
    function repaint() {
      if (!root.contains(mgmt)) return; // screen unmounted — bail silently
      mgmt.innerHTML = fullHtml(_activeTab, getActivityNames(state));
    }

    async function loadSimIfNeeded() {
      if (_simLoaded || _simLoading) return; // exactly-once guard
      _simLoading = true;
      repaint(); // show loading spinner
      try {
        const result = await api.israaSimulatorEntries(); // single network call
        _simRows   = Array.isArray(result?.rows) ? result.rows : [];
        _simLoaded = true;
        _simError  = null;
      } catch (e) {
        _simError = e.message || 'שגיאה בטעינת נתוני סימולטור';
      } finally {
        _simLoading = false;
      }
      repaint();
    }

    // ── Single delegated click handler (bound ONCE, survives repaints) ────────
    mgmt.addEventListener('click', async (e) => {
      const t = e.target;

      // Tab switching
      const tabBtn = t.closest('[data-israa-tab]');
      if (tabBtn) {
        _activeTab = tabBtn.dataset.israaTab;
        repaint();
        if (_activeTab === 'simulator') loadSimIfNeeded();
        return;
      }

      // ── Program table ──────────────────────────────────────────────────────
      if (t.closest('[data-israa-action="add-row"]')) {
        if (!_addingNew) { _addingNew = true; _newData = {}; _editingId = null; repaint(); }
        return;
      }
      if (t.closest('[data-israa-action="export-csv"]')) { exportToCsv(_rows); return; }

      const editBtn = t.closest('[data-israa-edit]');
      if (editBtn) {
        const row = _rows.find((r) => r.id === editBtn.dataset.israaEdit);
        if (row) { _editingId = row.id; _editData = { ...row }; _addingNew = false; repaint(); }
        return;
      }

      if (t.closest('[data-israa-cancel]')) { _editingId = null; _editData = {}; repaint(); return; }
      if (t.closest('[data-israa-cancel-new]')) { _addingNew = false; _newData = {}; repaint(); return; }

      const saveBtn = t.closest('[data-israa-save]');
      if (saveBtn) {
        const id = saveBtn.dataset.israaSave;
        const tr = mgmt.querySelector(`[data-row-id="${id}"]`);
        if (!tr) return;
        saveBtn.disabled = true; saveBtn.textContent = '…';
        try {
          const changes = collectProgForm(tr);
          const res = await api.israaUpdateRow(id, changes);
          _rows = _rows.map((r) => r.id === id ? (res?.row || { ...r, ...changes }) : r);
          _editingId = null; _editData = {}; _error = null;
        } catch (e) { _error = e.message || 'שגיאה בשמירה'; }
        repaint(); return;
      }

      const saveNewBtn = t.closest('[data-israa-save-new]');
      if (saveNewBtn) {
        const tr = mgmt.querySelector('.israa-row--new');
        if (!tr) return;
        saveNewBtn.disabled = true; saveNewBtn.textContent = '…';
        try {
          const data = collectProgForm(tr);
          const res = await api.israaInsertRow(data);
          _rows = [..._rows, res?.row || { id: String(Date.now()), ...data }];
          _addingNew = false; _newData = {}; _error = null;
        } catch (e) { _error = e.message || 'שגיאה בהוספה'; }
        repaint(); return;
      }

      const delBtn = t.closest('[data-israa-del]');
      if (delBtn) {
        const id = delBtn.dataset.israaDel;
        if (!window.confirm('למחוק את השורה הזו?')) return;
        delBtn.disabled = true;
        try {
          await api.israaDeleteRow(id);
          _rows = _rows.filter((r) => r.id !== id);
          if (_editingId === id) { _editingId = null; _editData = {}; }
          if (_expandedId === id) { _expandedId = null; }
          _error = null;
        } catch (e) { _error = e.message || 'שגיאה במחיקה'; }
        repaint(); return;
      }

      // Row expand/collapse — fires only after all action buttons have been checked above
      const progToggle = t.closest('[data-prog-toggle]');
      if (progToggle && !t.closest('.israa-cell--actions')) {
        const id = progToggle.dataset.progToggle;
        _expandedId = (_expandedId === id) ? null : id;
        repaint();
        return;
      }

      // ── Simulator table ────────────────────────────────────────────────────
      if (t.closest('[data-sim-action="add-row"]')) {
        if (!_simAddingNew) { _simAddingNew = true; _simNewData = {}; _simEditingId = null; repaint(); }
        return;
      }

      const simEditBtn = t.closest('[data-sim-edit]');
      if (simEditBtn) {
        const row = _simRows.find((r) => r.id === simEditBtn.dataset.simEdit);
        if (row) { _simEditingId = row.id; _simEditData = { ...row }; _simAddingNew = false; repaint(); }
        return;
      }

      if (t.closest('[data-sim-cancel]')) { _simEditingId = null; _simEditData = {}; repaint(); return; }
      if (t.closest('[data-sim-cancel-new]')) { _simAddingNew = false; _simNewData = {}; repaint(); return; }

      const simSaveBtn = t.closest('[data-sim-save]');
      if (simSaveBtn) {
        const id = simSaveBtn.dataset.simSave;
        const tr = mgmt.querySelector(`[data-sim-row-id="${id}"]`);
        if (!tr) return;
        simSaveBtn.disabled = true; simSaveBtn.textContent = '…';
        const changes = collectSimForm(tr);
        try {
          const res = await api.israaSimUpdateRow(id, changes);
          _simRows = _simRows.map((r) => r.id === id ? (res?.row || { ...r, ...changes }) : r);
          _simEditingId = null; _simEditData = {}; _simError = null;
        } catch (e) { _simError = e.message || 'שגיאה בשמירה'; }
        repaint(); return;
      }

      const simSaveNewBtn = t.closest('[data-sim-save-new]');
      if (simSaveNewBtn) {
        const tr = mgmt.querySelector('.sim-panel .israa-row--new');
        if (!tr) return;
        simSaveNewBtn.disabled = true; simSaveNewBtn.textContent = '…';
        const entry = collectSimForm(tr);
        try {
          const res = await api.israaSimInsertRow(entry);
          _simRows = [..._simRows, res?.row || { id: String(Date.now()), ...entry }];
          _simAddingNew = false; _simNewData = {}; _simError = null;
        } catch (e) { _simError = e.message || 'שגיאה בהוספה'; }
        repaint(); return;
      }

      const simDelBtn = t.closest('[data-sim-del]');
      if (simDelBtn) {
        const id = simDelBtn.dataset.simDel;
        if (!window.confirm('למחוק את הרשומה הזו?')) return;
        simDelBtn.disabled = true;
        try {
          await api.israaSimDeleteRow(id);
          _simRows = _simRows.filter((r) => r.id !== id);
          if (_simEditingId === id) { _simEditingId = null; _simEditData = {}; }
          _simError = null;
        } catch (e) { _simError = e.message || 'שגיאה במחיקה'; }
        repaint(); return;
      }
    }); // end single click delegation

    // ── Collab amount: live goal-lines update on input, full repaint on confirm ─
    // Uses delegation so it survives innerHTML replacement on mgmt.
    mgmt.addEventListener('input', (e) => {
      if (!e.target.matches('[data-sim-collab]')) return;
      const val = Math.max(0, parseFloat(e.target.value) || 0);
      // Update only the result/formatted nodes directly — zero DOM churn, zero network call
      const resultEl = mgmt.querySelector('[data-sim-goal-result]');
      if (resultEl) resultEl.innerHTML = simGoalLines(simCalc(_simRows, val));
      const formattedEl = mgmt.querySelector('[data-sim-collab-formatted]');
      if (formattedEl) formattedEl.innerHTML = fmtIls(val);
    });

    // On blur: commit value and repaint cards/progress — no focus loss (change fires after blur)
    mgmt.addEventListener('change', (e) => {
      if (!e.target.matches('[data-sim-collab]')) return;
      _simCollab = Math.max(0, parseFloat(e.target.value) || 0);
      e.target.value = _simCollab;
      repaint();
    });

    // Load simulator data if already on that tab (e.g. preserved state from prev visit)
    if (_activeTab === 'simulator') loadSimIfNeeded();
  }
};
