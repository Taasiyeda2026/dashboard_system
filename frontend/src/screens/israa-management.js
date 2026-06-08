import { escapeHtml } from './shared/html.js';
import { dsScreenStack } from './shared/layout.js';

const ISRAA_AUTH_USER_ID = '92bfb9d9-1b17-4022-901a-5f7cf17a263a';

// Module-level UI state persists across re-renders
let _activeTab = 'table';
let _editingId = null;
let _editData = {};
let _addingNew = false;
let _newData = {};
let _rows = [];
let _error = null;

const STATUS_OPTIONS = ['', 'נשלחה הצעה', 'גפן תשפ"ז', 'תוכנית קיץ'];

const COLUMNS = [
  { key: 'authority',      label: 'רשות',        width: '7%',   type: 'text' },
  { key: 'school_name',    label: 'שם ביה"ס',     width: '9%',   type: 'text' },
  { key: 'contact_person', label: 'איש קשר',      width: '8%',   type: 'text' },
  { key: 'phone',          label: 'טלפון',        width: '7%',   type: 'tel' },
  { key: 'email',          label: 'אימייל',        width: '8%',   type: 'email' },
  { key: 'program_name',   label: 'תוכנית',       width: '10%',  type: 'program' },
  { key: 'quantity',       label: 'כמות',         width: '4%',   type: 'number' },
  { key: 'total_cost',     label: 'סה"כ עלות',    width: '6%',   type: 'text' },
  { key: 'activity_date',  label: 'תאריך',        width: '7%',   type: 'date' },
  { key: 'status',         label: 'סטטוס',        width: '8%',   type: 'status' },
  { key: 'notes',          label: 'הערות',        width: 'auto', type: 'text' },
];

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

function cellViewHtml(row, col) {
  const val = row?.[col.key];
  if (col.key === 'activity_date') {
    if (!val) return '';
    try {
      const d = new Date(val);
      return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()}`;
    } catch { return String(val); }
  }
  return escapeHtml(String(val ?? ''));
}

function cellEditHtml(key, value, col, activityNames) {
  const v = escapeHtml(String(value ?? ''));
  if (col.type === 'status') {
    const opts = STATUS_OPTIONS.map((s) =>
      `<option value="${escapeHtml(s)}" ${s === (value ?? '') ? 'selected' : ''}>${escapeHtml(s || '(ריק)')}</option>`
    ).join('');
    return `<select class="israa-inp" name="${key}">${opts}</select>`;
  }
  if (col.type === 'program') {
    if (activityNames.length) {
      const opts = ['', ...activityNames].map((s) =>
        `<option value="${escapeHtml(s)}" ${s === (value ?? '') ? 'selected' : ''}>${escapeHtml(s || '(ריק)')}</option>`
      ).join('');
      return `<select class="israa-inp" name="${key}">${opts}</select>`;
    }
    return `<input class="israa-inp" name="${key}" type="text" value="${v}" />`;
  }
  if (col.type === 'number') {
    return `<input class="israa-inp" name="${key}" type="number" min="1" max="999" value="${v}" />`;
  }
  if (col.type === 'date') {
    return `<input class="israa-inp" name="${key}" type="date" value="${v}" />`;
  }
  return `<input class="israa-inp" name="${key}" type="text" value="${v}" />`;
}

function rowHtml(row, editingId, editData, activityNames) {
  const isEditing = row.id === editingId;
  const rowClass = isEditing ? 'israa-row israa-row--editing' : 'israa-row';
  const cells = COLUMNS.map((col) => {
    const content = isEditing
      ? cellEditHtml(col.key, editData[col.key] ?? row[col.key], col, activityNames)
      : cellViewHtml(row, col);
    return `<td class="israa-cell">${content}</td>`;
  }).join('');

  const actions = isEditing
    ? `<td class="israa-cell israa-cell--actions">
         <button class="israa-btn israa-btn--save" data-israa-save="${escapeHtml(row.id)}" title="שמירה">💾</button>
         <button class="israa-btn israa-btn--cancel" data-israa-cancel="${escapeHtml(row.id)}" title="ביטול">✕</button>
       </td>`
    : `<td class="israa-cell israa-cell--actions">
         <button class="israa-btn israa-btn--edit" data-israa-edit="${escapeHtml(row.id)}" title="עריכה">✏️</button>
         <button class="israa-btn israa-btn--del" data-israa-del="${escapeHtml(row.id)}" title="מחיקה">🗑️</button>
       </td>`;

  return `<tr class="${rowClass}" data-row-id="${escapeHtml(row.id)}">${cells}${actions}</tr>`;
}

function newRowHtml(newData, activityNames) {
  const cells = COLUMNS.map((col) => {
    const content = cellEditHtml(col.key, newData[col.key], col, activityNames);
    return `<td class="israa-cell">${content}</td>`;
  }).join('');
  const actions = `<td class="israa-cell israa-cell--actions">
    <button class="israa-btn israa-btn--save" data-israa-save-new title="שמירה">💾</button>
    <button class="israa-btn israa-btn--cancel" data-israa-cancel-new title="ביטול">✕</button>
  </td>`;
  return `<tr class="israa-row israa-row--new">${cells}${actions}</tr>`;
}

function tableBodyHtml(rows, editingId, editData, addingNew, newData, activityNames) {
  const bodyRows = rows.map((r) => rowHtml(r, editingId, editData, activityNames)).join('');
  const newRow = addingNew ? newRowHtml(newData, activityNames) : '';
  const emptyNotice = !rows.length && !addingNew
    ? `<tr><td colspan="${COLUMNS.length + 1}" class="israa-empty">אין רשומות עדיין. לחצי "הוספת שורה" להתחיל.</td></tr>`
    : '';
  return `${emptyNotice}${bodyRows}${newRow}`;
}

function fullHtml(rows, editingId, editData, addingNew, newData, error, activeTab, activityNames) {
  const headerCells = COLUMNS.map((col) =>
    `<th class="israa-th">${escapeHtml(col.label)}</th>`
  ).join('');

  const tabBar = `<div class="israa-tabbar" role="tablist" dir="rtl">
    <button class="israa-tab${activeTab === 'table' ? ' is-active' : ''}" data-israa-tab="table" role="tab">טבלת תוכניות</button>
    <button class="israa-tab${activeTab === 'simulator' ? ' is-active' : ''}" data-israa-tab="simulator" role="tab">סימולטור</button>
  </div>`;

  if (activeTab === 'simulator') {
    return `${tabBar}<div class="israa-simulator-placeholder">
      <span class="israa-simulator-icon">🚧</span>
      <p class="israa-simulator-msg">הסימולטור יתווסף בהמשך</p>
    </div>`;
  }

  const errorHtml = error ? `<div class="israa-error">${escapeHtml(error)}</div>` : '';
  return `${tabBar}
  <div class="israa-toolbar">
    <button class="israa-btn israa-btn--primary" data-israa-action="add-row"${addingNew ? ' disabled' : ''}>+ הוספת שורה</button>
    <button class="israa-btn" data-israa-action="export-csv">📥 ייצוא לאקסל</button>
  </div>
  ${errorHtml}
  <div class="israa-table-wrap">
    <table class="israa-table" dir="rtl">
      <thead><tr>${headerCells}<th class="israa-th israa-th--actions">פעולות</th></tr></thead>
      <tbody>${tableBodyHtml(rows, editingId, editData, addingNew, newData, activityNames)}</tbody>
    </table>
  </div>`;
}

function collectFormData(tr) {
  const data = {};
  COLUMNS.forEach((col) => {
    const inp = tr.querySelector(`[name="${col.key}"]`);
    if (!inp) return;
    const raw = inp.value;
    if (col.type === 'number') {
      data[col.key] = raw === '' ? null : parseInt(raw, 10);
    } else if (col.type === 'date') {
      data[col.key] = raw || null;
    } else {
      data[col.key] = raw;
    }
  });
  return data;
}

function exportToCsv(rows) {
  const headers = COLUMNS.map((c) => c.label);
  const csvRows = [headers.join(',')];
  rows.forEach((row) => {
    const vals = COLUMNS.map((col) => {
      let v = String(row[col.key] ?? '');
      if (v.includes(',') || v.includes('"') || v.includes('\n')) {
        v = '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    });
    csvRows.push(vals.join(','));
  });
  const blob = new Blob(['﻿' + csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'israa-program-tracking.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const ISRAA_CSS = `<style data-israa-styles>
.israa-mgmt{direction:rtl}
.israa-tabbar{display:flex;gap:4px;margin-bottom:12px;border-bottom:2px solid var(--ds-border,#e2e8f0)}
.israa-tab{background:none;border:none;border-bottom:3px solid transparent;padding:8px 16px;font-size:14px;cursor:pointer;color:var(--ds-text-secondary,#64748b);margin-bottom:-2px;transition:color .15s,border-color .15s}
.israa-tab.is-active{color:var(--ds-accent,#1a3358);border-bottom-color:var(--ds-accent,#1a3358);font-weight:600}
.israa-toolbar{display:flex;gap:8px;margin-bottom:10px;align-items:center}
.israa-table-wrap{overflow-x:auto;border:1px solid var(--ds-border,#e2e8f0);border-radius:6px}
.israa-table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}
.israa-th{background:var(--ds-table-head-bg,#f1f5f9);padding:5px 6px;text-align:right;font-weight:600;white-space:nowrap;border-bottom:1px solid var(--ds-border,#e2e8f0);font-size:12px}
.israa-th--actions{width:72px;text-align:center}
.israa-cell{padding:3px 5px;border-bottom:1px solid var(--ds-border,#f1f5f9);vertical-align:middle;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.israa-cell--actions{text-align:center;white-space:nowrap;overflow:visible;width:72px}
.israa-row:last-child .israa-cell{border-bottom:none}
.israa-row:hover .israa-cell{background:var(--ds-row-hover,#f8fafc)}
.israa-row--editing .israa-cell{background:#fffbeb}
.israa-row--new .israa-cell{background:#f0fdf4}
.israa-empty{text-align:center;padding:28px;color:var(--ds-text-secondary,#94a3b8);font-size:13px}
.israa-inp{width:100%;min-width:0;padding:2px 4px;font-size:11px;border:1px solid #cbd5e1;border-radius:3px;background:#fff;box-sizing:border-box}
.israa-inp:focus{outline:2px solid var(--ds-accent,#1a3358);outline-offset:0}
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
.israa-error{background:#fef2f2;border:1px solid #fca5a5;color:#b91c1c;border-radius:4px;padding:8px 12px;margin-bottom:8px;font-size:13px}
.israa-simulator-placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 24px;gap:12px}
.israa-simulator-icon{font-size:40px}
.israa-simulator-msg{font-size:16px;color:var(--ds-text-secondary,#64748b);margin:0}
</style>`;

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
    const activityNames = getActivityNames(state);
    return dsScreenStack(
      ISRAA_CSS +
      '<div class="israa-mgmt">' +
      fullHtml(_rows, _editingId, _editData, _addingNew, _newData, _error, _activeTab, activityNames) +
      '</div>'
    );
  },

  bind({ root, state, api }) {
    function repaint() {
      const mgmt = root.querySelector('.israa-mgmt');
      if (!mgmt) return;
      const activityNames = getActivityNames(state);
      mgmt.innerHTML = fullHtml(_rows, _editingId, _editData, _addingNew, _newData, _error, _activeTab, activityNames);
      bindEvents();
    }

    function bindEvents() {
      const mgmt = root.querySelector('.israa-mgmt') || root;

      // Tab switching
      mgmt.querySelectorAll('[data-israa-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          _activeTab = btn.dataset.israaTab;
          repaint();
        });
      });

      // Add row
      const addBtn = mgmt.querySelector('[data-israa-action="add-row"]');
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          if (_addingNew) return;
          _addingNew = true;
          _newData = {};
          _editingId = null;
          repaint();
        });
      }

      // Export CSV
      const exportBtn = mgmt.querySelector('[data-israa-action="export-csv"]');
      if (exportBtn) {
        exportBtn.addEventListener('click', () => exportToCsv(_rows));
      }

      // Edit row buttons
      mgmt.querySelectorAll('[data-israa-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.israaEdit;
          const row = _rows.find((r) => r.id === id);
          if (!row) return;
          _editingId = id;
          _editData = { ...row };
          _addingNew = false;
          repaint();
        });
      });

      // Cancel edit
      mgmt.querySelectorAll('[data-israa-cancel]').forEach((btn) => {
        btn.addEventListener('click', () => {
          _editingId = null;
          _editData = {};
          repaint();
        });
      });

      // Cancel new row
      const cancelNewBtn = mgmt.querySelector('[data-israa-cancel-new]');
      if (cancelNewBtn) {
        cancelNewBtn.addEventListener('click', () => {
          _addingNew = false;
          _newData = {};
          repaint();
        });
      }

      // Save edit
      mgmt.querySelectorAll('[data-israa-save]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.israaSave;
          const tr = mgmt.querySelector(`[data-row-id="${id}"]`);
          if (!tr) return;
          const changes = collectFormData(tr);
          btn.disabled = true;
          btn.textContent = '...';
          try {
            const result = await api.israaUpdateRow(id, changes);
            const updated = result?.row || { ...(_rows.find((r) => r.id === id) || {}), ...changes };
            _rows = _rows.map((r) => r.id === id ? updated : r);
            _editingId = null;
            _editData = {};
            _error = null;
          } catch (e) {
            _error = e.message || 'שגיאה בשמירה';
          }
          repaint();
        });
      });

      // Save new row
      const saveNewBtn = mgmt.querySelector('[data-israa-save-new]');
      if (saveNewBtn) {
        saveNewBtn.addEventListener('click', async () => {
          const tr = mgmt.querySelector('.israa-row--new');
          if (!tr) return;
          const data = collectFormData(tr);
          saveNewBtn.disabled = true;
          saveNewBtn.textContent = '...';
          try {
            const result = await api.israaInsertRow(data);
            const newRow = result?.row || { id: String(Date.now()), ...data };
            _rows = [..._rows, newRow];
            _addingNew = false;
            _newData = {};
            _error = null;
          } catch (e) {
            _error = e.message || 'שגיאה בהוספה';
          }
          repaint();
        });
      }

      // Delete row
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
          } catch (e) {
            _error = e.message || 'שגיאה במחיקה';
          }
          repaint();
        });
      });
    }

    bindEvents();
  }
};
