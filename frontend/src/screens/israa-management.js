import { escapeHtml } from './shared/html.js';
import { dsScreenStack } from './shared/layout.js';

const ISRAA_AUTH_USER_ID = '92bfb9d9-1b17-4022-901a-5f7cf17a263a';
const SIM_GOAL = 1_000_000;

// ── Tab state ──────────────────────────────────────────────────────────────────
let _activeTab = 'table';

// ── Program-tracking table state ───────────────────────────────────────────────
let _rows      = [];
let _editingId = null;
let _editData  = {};
let _addingNew = false;
let _newData   = {};
let _error     = null;

// ── Simulator state ────────────────────────────────────────────────────────────
let _simRows      = [];
let _simLoaded    = false;
let _simLoading   = false;
let _simEditingId = null;
let _simEditData  = {};
let _simAddingNew = false;
let _simNewData   = {};
let _simError     = null;
let _simAvgPrice  = 9000;

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
  return '₪ ' + (Number(num) || 0).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(val) {
  if (!val) return '';
  try {
    const d = new Date(val);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  } catch { return String(val); }
}

// ══════════════════════════════════════════════════════════════════════════════
// PROGRAM TRACKING TABLE
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

function progRowHtml(row, editingId, editData, actNames) {
  const ed = row.id === editingId;
  const cells = PROG_COLS.map((col) => {
    const c = ed ? progCellEdit(col.key, editData[col.key] ?? row[col.key], col, actNames) : progCellView(row, col);
    return `<td class="israa-cell">${c}</td>`;
  }).join('');
  const actions = ed
    ? `<td class="israa-cell israa-cell--actions"><button class="israa-btn israa-btn--save" data-israa-save="${escapeHtml(row.id)}" title="שמירה">💾</button> <button class="israa-btn israa-btn--cancel" data-israa-cancel="${escapeHtml(row.id)}" title="ביטול">✕</button></td>`
    : `<td class="israa-cell israa-cell--actions"><button class="israa-btn israa-btn--edit" data-israa-edit="${escapeHtml(row.id)}" title="עריכה">✏️</button> <button class="israa-btn israa-btn--del" data-israa-del="${escapeHtml(row.id)}" title="מחיקה">🗑️</button></td>`;
  return `<tr class="israa-row${ed ? ' israa-row--editing' : ''}" data-row-id="${escapeHtml(row.id)}">${cells}${actions}</tr>`;
}

function progNewRowHtml(newData, actNames) {
  return `<tr class="israa-row israa-row--new">${PROG_COLS.map((col) =>
    `<td class="israa-cell">${progCellEdit(col.key, newData[col.key], col, actNames)}</td>`
  ).join('')}<td class="israa-cell israa-cell--actions"><button class="israa-btn israa-btn--save" data-israa-save-new title="שמירה">💾</button> <button class="israa-btn israa-btn--cancel" data-israa-cancel-new title="ביטול">✕</button></td></tr>`;
}

function progTableHtml(rows, editingId, editData, addingNew, newData, error, actNames) {
  const hdr = PROG_COLS.map((c) => `<th class="israa-th">${escapeHtml(c.label)}</th>`).join('');
  const body = [
    !rows.length && !addingNew ? `<tr><td colspan="${PROG_COLS.length+1}" class="israa-empty">אין רשומות. לחצי "+ הוספת שורה" להתחיל.</td></tr>` : '',
    rows.map((r) => progRowHtml(r, editingId, editData, actNames)).join(''),
    addingNew ? progNewRowHtml(newData, actNames) : ''
  ].join('');
  return `<div class="israa-toolbar">
    <button class="israa-btn israa-btn--primary" data-israa-action="add-row"${addingNew ? ' disabled' : ''}>+ הוספת שורה</button>
    <button class="israa-btn" data-israa-action="export-csv">📥 ייצוא לאקסל</button>
  </div>
  ${error ? `<div class="israa-error">${escapeHtml(error)}</div>` : ''}
  <div class="israa-table-wrap">
    <table class="israa-table" dir="rtl">
      <thead><tr>${hdr}<th class="israa-th israa-th--actions">פעולות</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// SIMULATOR
// ══════════════════════════════════════════════════════════════════════════════
function simCalc(rows) {
  const total    = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const remaining = Math.max(0, SIM_GOAL - total);
  const rawPct   = (total / SIM_GOAL) * 100;
  const overGoal = total > SIM_GOAL;
  const overAmt  = total - SIM_GOAL;
  return { total, remaining, rawPct, overGoal, overAmt };
}

function goalOptionsText(calc, avgPrice) {
  if (calc.overGoal || calc.remaining === 0) {
    return 'היעד הושג. אין צורך בקורסים נוספים כדי להגיע ליעד.';
  }
  const price = Math.max(1, avgPrice);
  const count = Math.ceil(calc.remaining / price);
  return `להגעה ליעד אפשר להביא עוד ${count.toLocaleString('he-IL')} קורסים במחיר ממוצע של ${fmtIls(price)} לקורס.`;
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
  const label = calc.rawPct.toFixed(1) + '%';
  return `<div class="sim-progress">
    <div class="sim-progress__track"><div class="sim-progress__fill${calc.overGoal ? ' sim-progress__fill--over' : ''}" style="width:${fill}%"></div></div>
    <span class="sim-progress__pct">${label}</span>
  </div>`;
}

function simGoalOptionsHtml(calc, avgPrice) {
  const safePrice = Math.max(1, avgPrice || 9000);
  return `<div class="sim-goal-opts">
    <div class="sim-goal-opts__header">
      <span class="sim-goal-opts__title">אפשרויות להגעה ליעד</span>
      <label class="sim-goal-opts__price-label">מחיר ממוצע לקורס:
        <input class="israa-inp sim-goal-opts__price-inp" type="number" min="1" step="100"
               value="${escapeHtml(String(safePrice))}" data-sim-avg-price />
        <span class="sim-goal-opts__ils">₪</span>
      </label>
    </div>
    <div class="sim-goal-opts__result" data-sim-goal-result>${escapeHtml(goalOptionsText(calc, safePrice))}</div>
  </div>`;
}

function simRowHtml(row, editingId, editData) {
  const ed = row.id === editingId;
  const payerV  = ed ? escapeHtml(String(editData.payer_name ?? row.payer_name ?? '')) : escapeHtml(String(row.payer_name ?? ''));
  const amtRaw  = ed ? (editData.amount ?? row.amount ?? '') : (row.amount ?? '');
  const payerCell = ed
    ? `<td class="israa-cell"><input class="israa-inp" name="payer_name" type="text" value="${payerV}" /></td>`
    : `<td class="israa-cell">${payerV}</td>`;
  const amtCell = ed
    ? `<td class="israa-cell sim-cell--amt"><input class="israa-inp sim-inp--amt" name="amount" type="number" min="0" step="1" value="${escapeHtml(String(amtRaw))}" /></td>`
    : `<td class="israa-cell sim-cell--amt">${amtRaw !== '' && amtRaw != null ? escapeHtml(fmtIls(amtRaw)) : ''}</td>`;
  const actions = ed
    ? `<td class="israa-cell israa-cell--actions"><button class="israa-btn israa-btn--save" data-sim-save="${escapeHtml(row.id)}" title="שמירה">💾</button> <button class="israa-btn israa-btn--cancel" data-sim-cancel="${escapeHtml(row.id)}" title="ביטול">✕</button></td>`
    : `<td class="israa-cell israa-cell--actions"><button class="israa-btn israa-btn--edit" data-sim-edit="${escapeHtml(row.id)}" title="עריכה">✏️</button> <button class="israa-btn israa-btn--del" data-sim-del="${escapeHtml(row.id)}" title="מחיקה">🗑️</button></td>`;
  return `<tr class="israa-row${ed ? ' israa-row--editing' : ''}" data-sim-row-id="${escapeHtml(row.id)}">${payerCell}${amtCell}${actions}</tr>`;
}

function simNewRowHtml(newData) {
  return `<tr class="israa-row israa-row--new">
    <td class="israa-cell"><input class="israa-inp" name="payer_name" type="text" value="${escapeHtml(String(newData.payer_name ?? ''))}" placeholder="גורם משלם" /></td>
    <td class="israa-cell sim-cell--amt"><input class="israa-inp sim-inp--amt" name="amount" type="number" min="0" step="1" value="${escapeHtml(String(newData.amount ?? ''))}" placeholder="0" /></td>
    <td class="israa-cell israa-cell--actions"><button class="israa-btn israa-btn--save" data-sim-save-new title="שמירה">💾</button> <button class="israa-btn israa-btn--cancel" data-sim-cancel-new title="ביטול">✕</button></td>
  </tr>`;
}

function simPanelHtml(rows, editingId, editData, addingNew, newData, error, loading, avgPrice) {
  if (loading) return `<div class="sim-loading">טוען נתוני סימולטור…</div>`;
  const calc = simCalc(rows);
  const body = [
    !rows.length && !addingNew ? `<tr><td colspan="3" class="israa-empty">אין הכנסות עדיין. לחצי "+ הוספת הכנסה" להתחיל.</td></tr>` : '',
    rows.map((r) => simRowHtml(r, editingId, editData)).join(''),
    addingNew ? simNewRowHtml(newData) : ''
  ].join('');
  return `
  ${simCardsHtml(calc)}
  ${simProgressHtml(calc)}
  ${simGoalOptionsHtml(calc, avgPrice)}
  <div class="sim-table-section">
    <div class="israa-toolbar">
      <button class="israa-btn israa-btn--primary" data-sim-action="add-row"${addingNew ? ' disabled' : ''}>+ הוספת הכנסה</button>
    </div>
    ${error ? `<div class="israa-error">${escapeHtml(error)}</div>` : ''}
    <div class="israa-table-wrap">
      <table class="israa-table sim-table" dir="rtl">
        <thead><tr><th class="israa-th">גורם משלם</th><th class="israa-th sim-th--amt">סכום (₪)</th><th class="israa-th israa-th--actions">פעולות</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>`;
}

// ── Tab bar ────────────────────────────────────────────────────────────────────
function tabBarHtml(activeTab) {
  return `<div class="israa-tabbar" role="tablist" dir="rtl">
    <button class="israa-tab${activeTab === 'table' ? ' is-active' : ''}" data-israa-tab="table" role="tab">טבלת תוכניות</button>
    <button class="israa-tab${activeTab === 'simulator' ? ' is-active' : ''}" data-israa-tab="simulator" role="tab">סימולטור</button>
  </div>`;
}

function fullHtml(activeTab, actNames) {
  if (activeTab === 'simulator') {
    return tabBarHtml(activeTab) +
      `<div class="sim-panel">${simPanelHtml(_simRows, _simEditingId, _simEditData, _simAddingNew, _simNewData, _simError, _simLoading, _simAvgPrice)}</div>`;
  }
  return tabBarHtml(activeTab) + progTableHtml(_rows, _editingId, _editData, _addingNew, _newData, _error, actNames);
}

// ── CSV export ─────────────────────────────────────────────────────────────────
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

// ── form collectors ────────────────────────────────────────────────────────────
function collectProgForm(tr) {
  const data = {};
  PROG_COLS.forEach((col) => {
    const inp = tr.querySelector(`[name="${col.key}"]`);
    if (!inp) return;
    data[col.key] = col.type === 'number' ? (inp.value === '' ? null : parseInt(inp.value, 10))
                  : col.type === 'date'   ? (inp.value || null)
                  : inp.value;
  });
  return data;
}

function collectSimForm(tr) {
  return {
    payer_name: tr.querySelector('[name="payer_name"]')?.value ?? '',
    amount: (() => { const v = tr.querySelector('[name="amount"]')?.value ?? ''; return v === '' ? null : parseFloat(v); })()
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// CSS
// ══════════════════════════════════════════════════════════════════════════════
const ISRAA_CSS = `<style data-israa-styles>
.israa-mgmt{direction:rtl}
.israa-tabbar{display:flex;gap:4px;margin-bottom:14px;border-bottom:2px solid var(--ds-border,#e2e8f0)}
.israa-tab{background:none;border:none;border-bottom:3px solid transparent;padding:8px 18px;font-size:14px;cursor:pointer;color:var(--ds-text-secondary,#64748b);margin-bottom:-2px;transition:color .15s,border-color .15s}
.israa-tab.is-active{color:var(--ds-accent,#1a3358);border-bottom-color:var(--ds-accent,#1a3358);font-weight:600}
.israa-toolbar{display:flex;gap:8px;margin-bottom:10px;align-items:center}
.israa-table-wrap{overflow-x:auto;border:1px solid var(--ds-border,#e2e8f0);border-radius:6px}
.israa-table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}
.israa-th{background:var(--ds-table-head-bg,#f1f5f9);padding:5px 8px;text-align:right;font-weight:600;white-space:nowrap;border-bottom:1px solid var(--ds-border,#e2e8f0);font-size:12px}
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
/* ── simulator ── */
.sim-panel{direction:rtl}
.sim-loading{padding:28px;text-align:center;color:var(--ds-text-secondary,#64748b);font-size:14px}
.sim-cards{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}
.sim-card{background:#fff;border:1px solid var(--ds-border,#e2e8f0);border-radius:8px;padding:12px 16px;min-width:110px;flex:1;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.sim-card--highlight{border-color:var(--ds-accent,#1a3358);background:#f0f4ff}
.sim-card--over-banner{border-color:#16a34a;background:#f0fdf4}
.sim-card__lbl{font-size:11px;color:var(--ds-text-secondary,#64748b);margin-bottom:4px;white-space:nowrap}
.sim-card__val{font-size:17px;font-weight:700;color:var(--ds-text,#1e293b)}
.sim-card__val--goal{color:#1a3358}
.sim-card__val--over{color:#16a34a}
.sim-progress{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.sim-progress__track{flex:1;height:10px;background:#e2e8f0;border-radius:99px;overflow:hidden}
.sim-progress__fill{height:100%;background:var(--ds-accent,#1a3358);border-radius:99px;transition:width .4s ease}
.sim-progress__fill--over{background:#16a34a}
.sim-progress__pct{font-size:12px;font-weight:600;white-space:nowrap;min-width:40px}
.sim-goal-opts{background:#f8fafc;border:1px solid var(--ds-border,#e2e8f0);border-radius:8px;padding:10px 14px;margin-bottom:14px}
.sim-goal-opts__header{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px}
.sim-goal-opts__title{font-size:13px;font-weight:600;color:var(--ds-text,#1e293b)}
.sim-goal-opts__price-label{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--ds-text-secondary,#64748b);margin-right:auto}
.sim-goal-opts__price-inp{width:90px!important;text-align:left}
.sim-goal-opts__ils{font-size:12px}
.sim-goal-opts__result{font-size:13px;color:var(--ds-text,#1e293b);line-height:1.6}
.sim-table-section{margin-top:4px}
.sim-table{table-layout:auto}
.sim-th--amt{width:130px;text-align:left}
.sim-cell--amt{text-align:left;font-variant-numeric:tabular-nums}
.sim-inp--amt{text-align:left}
</style>`;

// ══════════════════════════════════════════════════════════════════════════════
// SCREEN EXPORT
// ══════════════════════════════════════════════════════════════════════════════
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
    function repaint() {
      const mgmt = root.querySelector('.israa-mgmt');
      if (!mgmt) return;
      mgmt.innerHTML = fullHtml(_activeTab, getActivityNames(state));
      bindEvents();
    }

    async function loadSimIfNeeded() {
      if (_simLoaded || _simLoading) return;
      _simLoading = true;
      repaint();
      try {
        const result = await api.israaSimulatorEntries();
        _simRows  = Array.isArray(result?.rows) ? result.rows : [];
        _simLoaded = true;
        _simError  = null;
      } catch (e) {
        _simError = e.message || 'שגיאה בטעינת נתוני סימולטור';
      } finally {
        _simLoading = false;
      }
      repaint();
    }

    function bindEvents() {
      const mgmt = root.querySelector('.israa-mgmt') || root;

      // ── tabs ────────────────────────────────────────────────────────────────
      mgmt.querySelectorAll('[data-israa-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          _activeTab = btn.dataset.israaTab;
          repaint();
          if (_activeTab === 'simulator') loadSimIfNeeded();
        });
      });

      // ── program table ───────────────────────────────────────────────────────
      mgmt.querySelector('[data-israa-action="add-row"]')?.addEventListener('click', () => {
        if (_addingNew) return;
        _addingNew = true; _newData = {}; _editingId = null; repaint();
      });
      mgmt.querySelector('[data-israa-action="export-csv"]')?.addEventListener('click', () => exportToCsv(_rows));

      mgmt.querySelectorAll('[data-israa-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const row = _rows.find((r) => r.id === btn.dataset.israaEdit);
          if (!row) return;
          _editingId = row.id; _editData = { ...row }; _addingNew = false; repaint();
        });
      });
      mgmt.querySelectorAll('[data-israa-cancel]').forEach((btn) => {
        btn.addEventListener('click', () => { _editingId = null; _editData = {}; repaint(); });
      });
      mgmt.querySelector('[data-israa-cancel-new]')?.addEventListener('click', () => {
        _addingNew = false; _newData = {}; repaint();
      });

      mgmt.querySelectorAll('[data-israa-save]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.israaSave;
          const tr = mgmt.querySelector(`[data-row-id="${id}"]`);
          if (!tr) return;
          btn.disabled = true; btn.textContent = '…';
          try {
            const changes = collectProgForm(tr);
            const res = await api.israaUpdateRow(id, changes);
            const updated = res?.row || { ...(_rows.find((r) => r.id === id) || {}), ...changes };
            _rows = _rows.map((r) => r.id === id ? updated : r);
            _editingId = null; _editData = {}; _error = null;
          } catch (e) { _error = e.message || 'שגיאה בשמירה'; }
          repaint();
        });
      });
      mgmt.querySelector('[data-israa-save-new]')?.addEventListener('click', async function () {
        const tr = mgmt.querySelector('.israa-row--new');
        if (!tr) return;
        this.disabled = true; this.textContent = '…';
        try {
          const data = collectProgForm(tr);
          const res = await api.israaInsertRow(data);
          _rows = [..._rows, res?.row || { id: String(Date.now()), ...data }];
          _addingNew = false; _newData = {}; _error = null;
        } catch (e) { _error = e.message || 'שגיאה בהוספה'; }
        repaint();
      });
      mgmt.querySelectorAll('[data-israa-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.israaDel;
          if (!window.confirm('למחוק את השורה הזו?')) return;
          btn.disabled = true;
          try {
            await api.israaDeleteRow(id);
            _rows = _rows.filter((r) => r.id !== id);
            if (_editingId === id) { _editingId = null; _editData = {}; }
            _error = null;
          } catch (e) { _error = e.message || 'שגיאה במחיקה'; }
          repaint();
        });
      });

      // ── simulator ──────────────────────────────────────────────────────────
      // Average price input — live update of result text only (no repaint, no focus loss)
      const avgPriceInp = mgmt.querySelector('[data-sim-avg-price]');
      if (avgPriceInp) {
        avgPriceInp.addEventListener('input', () => {
          const v = parseFloat(avgPriceInp.value) || 9000;
          _simAvgPrice = Math.max(1, v);
          const resultEl = mgmt.querySelector('[data-sim-goal-result]');
          if (resultEl) resultEl.textContent = goalOptionsText(simCalc(_simRows), _simAvgPrice);
        });
        avgPriceInp.addEventListener('change', () => {
          _simAvgPrice = Math.max(1, parseFloat(avgPriceInp.value) || 9000);
          avgPriceInp.value = _simAvgPrice;
        });
      }

      mgmt.querySelector('[data-sim-action="add-row"]')?.addEventListener('click', () => {
        if (_simAddingNew) return;
        _simAddingNew = true; _simNewData = {}; _simEditingId = null; repaint();
      });

      mgmt.querySelectorAll('[data-sim-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const row = _simRows.find((r) => r.id === btn.dataset.simEdit);
          if (!row) return;
          _simEditingId = row.id; _simEditData = { ...row }; _simAddingNew = false; repaint();
        });
      });
      mgmt.querySelectorAll('[data-sim-cancel]').forEach((btn) => {
        btn.addEventListener('click', () => { _simEditingId = null; _simEditData = {}; repaint(); });
      });
      mgmt.querySelector('[data-sim-cancel-new]')?.addEventListener('click', () => {
        _simAddingNew = false; _simNewData = {}; repaint();
      });

      mgmt.querySelectorAll('[data-sim-save]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.simSave;
          const tr = mgmt.querySelector(`[data-sim-row-id="${id}"]`);
          if (!tr) return;
          btn.disabled = true; btn.textContent = '…';
          const changes = collectSimForm(tr);
          try {
            const res = await api.israaSimUpdateRow(id, changes);
            const updated = res?.row || { ...(_simRows.find((r) => r.id === id) || {}), ...changes };
            _simRows = _simRows.map((r) => r.id === id ? updated : r);
            _simEditingId = null; _simEditData = {}; _simError = null;
          } catch (e) { _simError = e.message || 'שגיאה בשמירה'; }
          repaint();
        });
      });
      mgmt.querySelector('[data-sim-save-new]')?.addEventListener('click', async function () {
        const tr = mgmt.querySelector('.sim-panel .israa-row--new');
        if (!tr) return;
        this.disabled = true; this.textContent = '…';
        const entry = collectSimForm(tr);
        try {
          const res = await api.israaSimInsertRow(entry);
          _simRows = [..._simRows, res?.row || { id: String(Date.now()), ...entry }];
          _simAddingNew = false; _simNewData = {}; _simError = null;
        } catch (e) { _simError = e.message || 'שגיאה בהוספה'; }
        repaint();
      });
      mgmt.querySelectorAll('[data-sim-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.simDel;
          if (!window.confirm('למחוק את הרשומה הזו?')) return;
          btn.disabled = true;
          try {
            await api.israaSimDeleteRow(id);
            _simRows = _simRows.filter((r) => r.id !== id);
            if (_simEditingId === id) { _simEditingId = null; _simEditData = {}; }
            _simError = null;
          } catch (e) { _simError = e.message || 'שגיאה במחיקה'; }
          repaint();
        });
      });
    }

    bindEvents();
    if (_activeTab === 'simulator') loadSimIfNeeded();
  }
};
