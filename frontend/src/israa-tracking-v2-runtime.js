import { supabase } from './supabase-client.js';
import { state, clearScreenDataCache } from './state.js';
import { showToast } from './screens/shared/toast.js';
import { escapeHtml } from './screens/shared/html.js';

const ISRAA_AUTH_USER_ID = '92bfb9d9-1b17-4022-901a-5f7cf17a263a';
const ROOT_SELECTOR = '.israa-mgmt';
const CONTAINER_ATTR = 'data-israa-tracking-v2';
const DEBOUNCE_MS = 90;
const PROBABILITY_OPTIONS = [30, 50, 100];
const NATURE_OPTIONS = ['ממוקדת', 'לבחירה', 'משולבת'];
const STATUS_OPTIONS = [
  'טיוטה',
  'נשלחה',
  'בטיפול',
  'ממתינה לבחירת תוכן',
  'ממתינה לתקציב',
  'אושרה',
  'נדחתה',
  'נסגרה'
];

const MAIN_COLUMNS = [
  { key: 'school_name', label: 'בית ספר', width: 155, type: 'text' },
  { key: 'semel_mosad', label: 'סמל מוסד', width: 82, type: 'text', center: true },
  { key: 'authority', label: 'רשות', width: 105, type: 'text' },
  { key: 'quote_number', label: 'מס׳ הצעה', width: 80, type: 'text', center: true },
  { key: 'program_name', label: 'תוכנית', width: 185, type: 'program' },
  { key: 'gefen_numbers', label: 'מס׳ גפ״ן', width: 94, type: 'text', center: true },
  { key: 'quantity', label: 'קבוצות', width: 66, type: 'number', center: true },
  { key: 'total_amount', label: 'סכום', width: 94, type: 'money', center: true },
  { key: 'probability', label: 'סבירות', width: 74, type: 'probability', center: true },
  { key: 'realistic_value', label: 'צבר ריאלי', width: 98, type: 'calculated', center: true },
  { key: 'status', label: 'סטטוס', width: 112, type: 'status', center: true },
  { key: 'follow_up_date', label: 'תאריך מעקב', width: 96, type: 'date', center: true },
  { key: 'next_action', label: 'הפעולה הבאה', width: 205, type: 'text' }
];

const DETAIL_COLUMNS = [
  { key: 'contact_person', label: 'איש קשר', type: 'text' },
  { key: 'phone', label: 'טלפון', type: 'tel' },
  { key: 'email', label: 'דוא״ל', type: 'email' },
  { key: 'proposal_date', label: 'תאריך הצעה', type: 'date' },
  { key: 'proposal_nature', label: 'אופי ההצעה', type: 'nature' },
  { key: 'notes', label: 'הערות / חסמים', type: 'textarea' }
];

let timer = null;
let running = false;
let rows = [];
let courses = [];
let loaded = false;
let loading = false;
let errorMessage = '';
let editingId = null;
let expandedId = null;
let addingNew = false;
let newDraft = {};

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function truthy(value) {
  return value === true || value === 1 || value === '1' || value === 'yes' || value === 'true';
}

function canUseScreen() {
  const user = state?.user || {};
  const role = clean(user.display_role || user.role);
  return clean(user.auth_user_id) === ISRAA_AUTH_USER_ID
    || clean(user.user_id) === '3030'
    || role === 'admin';
}

function toast(message, type = 'success') {
  try {
    showToast(message, type);
  } catch {
    console[type === 'error' ? 'error' : 'info'](message);
  }
}

function numberValue(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).replace(/[^0-9.\-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerValue(value) {
  const parsed = numberValue(value);
  return parsed == null ? null : Math.max(0, Math.floor(parsed));
}

function formatMoney(value) {
  const parsed = numberValue(value) || 0;
  return `${parsed.toLocaleString('he-IL', { maximumFractionDigits: 0 })} ₪`;
}

function formatDate(value) {
  if (!value) return '';
  const parts = String(value).slice(0, 10).split('-');
  if (parts.length !== 3) return clean(value);
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function realisticValue(row) {
  const saved = numberValue(row?.realistic_value);
  if (saved != null) return saved;
  return Math.round((numberValue(row?.total_amount) || 0) * (numberValue(row?.probability) || 0) / 100);
}

function statusClass(status) {
  const value = clean(status);
  if (value === 'אושרה') return 'is-approved';
  if (value === 'נדחתה' || value === 'נסגרה') return 'is-closed';
  if (value.includes('ממתינה')) return 'is-waiting';
  if (value === 'נשלחה') return 'is-sent';
  return 'is-active';
}

function courseByName(name) {
  const normalized = clean(name).toLowerCase();
  return courses.find((course) => clean(course.short_name).toLowerCase() === normalized) || null;
}

function injectStyles() {
  if (document.getElementById('israa-tracking-v2-styles')) return;
  const style = document.createElement('style');
  style.id = 'israa-tracking-v2-styles';
  style.textContent = `
    .israa-mgmt.israa-v2-active > .israa-toolbar,
    .israa-mgmt.israa-v2-active > .prog-section { display: none !important; }
    .israa-mgmt,
    .israa-mgmt.israa-v2-active,
    .israa-mgmt .israa-v2,
    .israa-mgmt [data-israa-tracking-v2] {
      width:100%; max-width:100%; min-width:0; box-sizing:border-box;
    }
    .israa-v2 { direction:rtl; margin-top:10px; overflow:visible; }
    .israa-v2__title-row {
      display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px;
    }
    .israa-v2__title { margin:0; font-size:1.05rem; font-weight:850; color:#0f172a; }
    .israa-v2__sub { color:#64748b; font-size:.76rem; }
    .israa-v2__toolbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
    .israa-v2__btn {
      border:1px solid #cbd5e1; border-radius:8px; background:#fff; color:#334155;
      padding:6px 10px; font:inherit; font-size:.78rem; font-weight:750; cursor:pointer;
    }
    .israa-v2__btn:hover { background:#f8fafc; }
    .israa-v2__btn--primary { border-color:#0f766e; background:#0f766e; color:#fff; }
    .israa-v2__btn--danger { color:#b91c1c; }
    .israa-v2__btn[disabled] { opacity:.55; cursor:default; }
    .israa-v2__kpis {
      display:grid; grid-template-columns:repeat(4,minmax(120px,1fr)); gap:8px; margin-bottom:10px;
    }
    .israa-v2__kpi {
      border:1px solid #e2e8f0; border-radius:10px; background:#fff; padding:8px 10px;
      box-shadow:0 1px 4px rgba(15,23,42,.04);
    }
    .israa-v2__kpi-label { color:#64748b; font-size:.7rem; font-weight:700; }
    .israa-v2__kpi-value { margin-top:2px; color:#0f172a; font-size:1rem; font-weight:850; }
    .israa-v2__error { margin-bottom:8px; padding:8px 10px; border-radius:8px; background:#fee2e2; color:#991b1b; font-size:.78rem; }
    .israa-v2__loading { padding:22px; text-align:center; color:#64748b; }
    .israa-v2__wrap {
      width:100%; max-width:100%; min-width:0; overflow-x:auto; overflow-y:visible;
      direction:rtl; box-sizing:border-box; overscroll-behavior-inline:contain;
      border:1px solid #dbe3ec; border-radius:10px; background:#fff;
      box-shadow:0 2px 8px rgba(26,51,88,.06);
    }
    .israa-v2__table { width:100%; min-width:1510px; table-layout:fixed; border-collapse:collapse; font-size:11.5px; }
    .israa-v2__table th {
      position:sticky; top:0; z-index:1; padding:7px 6px; background:#f1f5f9; color:#334155;
      border-bottom:1px solid #cbd5e1; border-inline-start:1px solid #e2e8f0;
      text-align:right; font-size:10.5px; font-weight:800; white-space:nowrap;
    }
    .israa-v2__table td {
      padding:6px; border-bottom:1px solid #e8edf3; border-inline-start:1px solid #eef2f6;
      vertical-align:middle; color:#1e293b; overflow:hidden;
    }
    .israa-v2__row[data-v2-toggle] { cursor:pointer; }
    .israa-v2__row[data-v2-toggle]:hover td { background:#f8fafc; }
    .israa-v2__row.is-editing td, .israa-v2__row.is-new td { background:#fffbeb; }
    .israa-v2__center { text-align:center !important; font-variant-numeric:tabular-nums; }
    .israa-v2__text { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .israa-v2__program { display:grid; gap:3px; min-width:0; }
    .israa-v2__program-name { line-height:1.25; white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .israa-v2__nature { justify-self:start; padding:1px 6px; border-radius:999px; background:#e0f2fe; color:#075985; font-size:9px; font-weight:800; }
    .israa-v2__status { display:inline-block; max-width:100%; padding:2px 7px; border-radius:999px; font-size:9.5px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .israa-v2__status.is-approved { background:#dcfce7; color:#166534; }
    .israa-v2__status.is-sent { background:#dbeafe; color:#1d4ed8; }
    .israa-v2__status.is-waiting { background:#fef3c7; color:#92400e; }
    .israa-v2__status.is-closed { background:#e5e7eb; color:#475569; }
    .israa-v2__status.is-active { background:#ede9fe; color:#6d28d9; }
    .israa-v2__actions { display:flex; justify-content:center; gap:4px; }
    .israa-v2__icon {
      width:28px; height:28px; display:inline-grid; place-items:center; border:1px solid #cbd5e1;
      border-radius:7px; background:#fff; font-size:13px; cursor:pointer;
    }
    .israa-v2__icon[disabled] { opacity:.5; cursor:default; }
    .israa-v2__input, .israa-v2__select, .israa-v2__textarea {
      width:100%; min-width:0; box-sizing:border-box; border:1px solid #cbd5e1; border-radius:6px;
      padding:4px 5px; background:#fff; color:#0f172a; font:inherit; font-size:10.5px;
    }
    .israa-v2__textarea { min-height:58px; resize:vertical; }
    .israa-v2__detail td { padding:0; background:#f8fafc; }
    .israa-v2__detail-panel {
      display:grid; grid-template-columns:repeat(5,minmax(120px,1fr)); gap:8px 12px;
      padding:10px 12px; border-top:1px solid #e2e8f0;
    }
    .israa-v2__detail-item { min-width:0; }
    .israa-v2__detail-item--wide { grid-column:span 2; }
    .israa-v2__detail-label { display:block; margin-bottom:2px; color:#64748b; font-size:9.5px; font-weight:800; }
    .israa-v2__detail-value { color:#1e293b; font-size:11px; white-space:normal; overflow-wrap:anywhere; }
    .israa-v2__proposal-items { grid-column:1 / -1; border-top:1px dashed #cbd5e1; padding-top:7px; }
    .israa-v2__proposal-items-list { display:flex; flex-wrap:wrap; gap:5px 10px; font-size:10.5px; color:#475569; }
    .israa-v2__empty { padding:24px !important; text-align:center; color:#64748b; }
    @media (max-width:1000px) {
      .israa-v2__kpis { grid-template-columns:repeat(2,minmax(120px,1fr)); }
      .israa-v2__detail-panel { grid-template-columns:repeat(2,minmax(120px,1fr)); }
    }
    @media (max-width:600px) {
      .israa-v2__kpis { grid-template-columns:1fr 1fr; }
      .israa-v2__title-row { align-items:flex-start; flex-direction:column; }
      .israa-v2__detail-panel { grid-template-columns:1fr; }
      .israa-v2__detail-item--wide { grid-column:auto; }
    }
  `;
  document.head.appendChild(style);
}

function activeTableTab(mgmt) {
  const active = mgmt.querySelector('[data-israa-tab].is-active');
  return !active || clean(active.dataset.israaTab) === 'table';
}

async function loadData(force = false) {
  if (!supabase || loading || (loaded && !force)) return;
  loading = true;
  errorMessage = '';
  try {
    const [rowsResult, coursesResult] = await Promise.all([
      supabase
        .from('israa_program_tracking')
        .select('*')
        .order('proposal_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('proposal_gefen_courses')
        .select('short_name,gefen_number,sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
    ]);
    if (rowsResult.error) throw rowsResult.error;
    if (coursesResult.error) throw coursesResult.error;
    rows = Array.isArray(rowsResult.data) ? rowsResult.data : [];
    courses = Array.isArray(coursesResult.data) ? coursesResult.data : [];
    loaded = true;
  } catch (error) {
    console.error('[israa-tracking-v2-load]', error);
    errorMessage = error?.message || 'שגיאה בטעינת טבלת המעקב';
  } finally {
    loading = false;
  }
}

function kpiHtml() {
  const total = rows.reduce((sum, row) => sum + (numberValue(row.total_amount) || 0), 0);
  const realistic = rows.reduce((sum, row) => sum + realisticValue(row), 0);
  const approved = rows
    .filter((row) => clean(row.status) === 'אושרה')
    .reduce((sum, row) => sum + (numberValue(row.total_amount) || 0), 0);
  const cards = [
    ['מספר הצעות', rows.length.toLocaleString('he-IL')],
    ['שווי הצעות כולל', formatMoney(total)],
    ['שווי צבר ריאלי', formatMoney(realistic)],
    ['שווי הצעות שאושרו', formatMoney(approved)]
  ];
  return `<div class="israa-v2__kpis">${cards.map(([label, value]) => `
    <div class="israa-v2__kpi">
      <div class="israa-v2__kpi-label">${escapeHtml(label)}</div>
      <div class="israa-v2__kpi-value">${escapeHtml(value)}</div>
    </div>`).join('')}</div>`;
}

function optionHtml(options, value, emptyLabel = '') {
  const current = clean(value);
  const all = [...options];
  if (current && !all.map(clean).includes(current)) all.unshift(current);
  return `${emptyLabel ? `<option value="">${escapeHtml(emptyLabel)}</option>` : ''}${all.map((option) => {
    const raw = typeof option === 'number' ? String(option) : option;
    return `<option value="${escapeHtml(raw)}"${clean(raw) === current ? ' selected' : ''}>${escapeHtml(raw)}</option>`;
  }).join('')}`;
}

function inputHtml(field, value, type = 'text', extra = '') {
  const v = value == null ? '' : String(value);
  if (type === 'textarea') {
    return `<textarea class="israa-v2__textarea" data-v2-field="${escapeHtml(field)}" ${extra}>${escapeHtml(v)}</textarea>`;
  }
  if (type === 'status') {
    return `<select class="israa-v2__select" data-v2-field="${escapeHtml(field)}">${optionHtml(STATUS_OPTIONS, v, '(ריק)')}</select>`;
  }
  if (type === 'probability') {
    return `<select class="israa-v2__select israa-v2__center" data-v2-field="${escapeHtml(field)}">${PROBABILITY_OPTIONS.map((option) => `<option value="${option}"${Number(v || 30) === option ? ' selected' : ''}>${option}%</option>`).join('')}</select>`;
  }
  if (type === 'nature') {
    return `<select class="israa-v2__select" data-v2-field="${escapeHtml(field)}">${optionHtml(NATURE_OPTIONS, v || 'ממוקדת')}</select>`;
  }
  const htmlType = type === 'money' ? 'number' : type;
  const step = type === 'money' ? ' step="1" min="0"' : type === 'number' ? ' step="1" min="0"' : '';
  const list = type === 'program' ? ' list="israa-v2-course-options" data-v2-program-input' : '';
  return `<input class="israa-v2__input${type === 'money' || type === 'number' ? ' israa-v2__center' : ''}" data-v2-field="${escapeHtml(field)}" type="${escapeHtml(htmlType)}" value="${escapeHtml(v)}"${step}${list} ${extra}>`;
}

function displayProgram(row) {
  const name = clean(row.program_name);
  const nature = clean(row.proposal_nature) || 'ממוקדת';
  return `<div class="israa-v2__program" title="${escapeHtml(name)}">
    <span class="israa-v2__program-name">${escapeHtml(name || '—')}</span>
    <span class="israa-v2__nature">${escapeHtml(nature)}</span>
  </div>`;
}

function displayCell(row, column) {
  const value = row?.[column.key];
  if (column.key === 'program_name') return displayProgram(row);
  if (column.key === 'total_amount' || column.key === 'realistic_value') return escapeHtml(formatMoney(column.key === 'realistic_value' ? realisticValue(row) : value));
  if (column.key === 'probability') return `${escapeHtml(String(numberValue(value) || 0))}%`;
  if (column.key === 'status') return `<span class="israa-v2__status ${statusClass(value)}">${escapeHtml(clean(value) || '—')}</span>`;
  if (column.key === 'follow_up_date') return escapeHtml(formatDate(value) || '—');
  return `<div class="israa-v2__text" title="${escapeHtml(clean(value))}">${escapeHtml(clean(value) || '—')}</div>`;
}

function editCell(row, column) {
  if (column.type === 'calculated') return escapeHtml(formatMoney(realisticValue(row)));
  return inputHtml(column.key, row?.[column.key], column.type);
}

function proposalItemsHtml(row) {
  const items = Array.isArray(row?.proposal_items) ? row.proposal_items : [];
  if (!items.length) return '';
  return `<div class="israa-v2__proposal-items">
    <span class="israa-v2__detail-label">פירוט התוכניות בהצעה</span>
    <div class="israa-v2__proposal-items-list">${items.map((item) => {
      const parts = [
        clean(item.program_name || item.item_name),
        clean(item.gefen_number) ? `גפ״ן ${clean(item.gefen_number)}` : '',
        Number(item.quantity) > 0 ? `${Number(item.quantity)} קבוצות` : '',
        numberValue(item.total_price) != null ? formatMoney(item.total_price) : ''
      ].filter(Boolean);
      return `<span>${escapeHtml(parts.join(' · '))}</span>`;
    }).join('')}</div>
  </div>`;
}

function detailHtml(row, editing, rowKey) {
  const detail = DETAIL_COLUMNS.map((field) => {
    const wide = field.key === 'notes' ? ' israa-v2__detail-item--wide' : '';
    const content = editing
      ? inputHtml(field.key, row?.[field.key], field.type)
      : `<div class="israa-v2__detail-value">${escapeHtml(field.key.includes('date') ? (formatDate(row?.[field.key]) || '—') : (clean(row?.[field.key]) || '—'))}</div>`;
    return `<div class="israa-v2__detail-item${wide}">
      <span class="israa-v2__detail-label">${escapeHtml(field.label)}</span>
      ${content}
    </div>`;
  }).join('');

  return `<tr class="israa-v2__detail" data-v2-detail-for="${escapeHtml(rowKey)}">
    <td colspan="${MAIN_COLUMNS.length + 1}">
      <div class="israa-v2__detail-panel" data-v2-editor="${escapeHtml(rowKey)}">
        ${detail}
        ${editing ? '' : proposalItemsHtml(row)}
      </div>
    </td>
  </tr>`;
}

function searchableRowText(row) {
  return [
    row.authority, row.school_name, row.semel_mosad, row.program_name,
    row.quote_number, row.contact_person, row.phone, row.email, row.status,
    row.notes,
    ...(Array.isArray(row.proposal_items) ? row.proposal_items.flatMap((item) => [
      item.program_name, item.item_name, item.gefen_number
    ]) : [])
  ].map(clean).filter(Boolean).join(' ');
}

function rowHtml(row) {
  const editing = editingId === row.id;
  const expanded = editing || expandedId === row.id;
  const cells = MAIN_COLUMNS.map((column) => {
    const content = editing ? editCell(row, column) : displayCell(row, column);
    return `<td class="${column.center ? 'israa-v2__center' : ''}">${content}</td>`;
  }).join('');
  const actions = editing
    ? `<button class="israa-v2__icon" data-v2-save="${escapeHtml(row.id)}" title="שמירה">💾</button>
       <button class="israa-v2__icon" data-v2-cancel title="ביטול">✕</button>`
    : `<button class="israa-v2__icon" data-v2-edit="${escapeHtml(row.id)}" title="עריכה">✏️</button>
       <button class="israa-v2__icon israa-v2__btn--danger" data-v2-delete="${escapeHtml(row.id)}" title="מחיקה">🗑️</button>`;
  const main = `<tr class="israa-v2__row${editing ? ' is-editing' : ''}" data-v2-row-id="${escapeHtml(row.id)}" data-v2-search-text="${escapeHtml(searchableRowText(row))}"${editing ? '' : ` data-v2-toggle="${escapeHtml(row.id)}"`}>
    ${cells}<td><div class="israa-v2__actions">${actions}</div></td>
  </tr>`;
  return main + (expanded ? detailHtml(row, editing, row.id) : '');
}

function newRowHtml() {
  const draft = {
    proposal_nature: 'ממוקדת',
    probability: 50,
    status: 'טיוטה',
    ...newDraft
  };
  const cells = MAIN_COLUMNS.map((column) => {
    const content = column.type === 'calculated' ? escapeHtml(formatMoney(realisticValue(draft))) : editCell(draft, column);
    return `<td class="${column.center ? 'israa-v2__center' : ''}">${content}</td>`;
  }).join('');
  return `<tr class="israa-v2__row is-new" data-v2-row-id="__new__">
    ${cells}<td><div class="israa-v2__actions">
      <button class="israa-v2__icon" data-v2-save-new title="שמירה">💾</button>
      <button class="israa-v2__icon" data-v2-cancel-new title="ביטול">✕</button>
    </div></td>
  </tr>${detailHtml(draft, true, '__new__')}`;
}

function datalistHtml() {
  return `<datalist id="israa-v2-course-options">${courses.map((course) => `<option value="${escapeHtml(clean(course.short_name))}">${escapeHtml(clean(course.gefen_number))}</option>`).join('')}</datalist>`;
}

function tableHtml() {
  const header = MAIN_COLUMNS.map((column) => `<th class="${column.center ? 'israa-v2__center' : ''}">${escapeHtml(column.label)}</th>`).join('');
  const colgroup = MAIN_COLUMNS.map((column) => `<col style="width:${column.width}px">`).join('') + '<col style="width:72px">';
  const body = [
    rows.map(rowHtml).join(''),
    addingNew ? newRowHtml() : '',
    !rows.length && !addingNew ? `<tr><td colspan="${MAIN_COLUMNS.length + 1}" class="israa-v2__empty">אין הצעות במעקב.</td></tr>` : ''
  ].join('');
  return `<div class="israa-v2__wrap">
    <table class="israa-v2__table" dir="rtl">
      <colgroup>${colgroup}</colgroup>
      <thead><tr>${header}<th class="israa-v2__center">פעולות</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>${datalistHtml()}`;
}

function renderContainer(container) {
  container.innerHTML = `
    <div class="israa-v2__title-row">
      <div>
        <h2 class="israa-v2__title">מעקב הצעות גפ״ן – תשפ״ז</h2>
        <div class="israa-v2__sub">הצעות בתחום E בלבד · שמות קצרים ומספרי גפ״ן מתוך המערכת</div>
      </div>
    </div>
    ${loading ? '<div class="israa-v2__loading">טוען נתונים…</div>' : `
      ${kpiHtml()}
      <div class="israa-v2__toolbar">
        <button class="israa-v2__btn israa-v2__btn--primary" data-v2-add${addingNew ? ' disabled' : ''}>+ הוספת שורה</button>
        <button class="israa-v2__btn" data-v2-export>📥 ייצוא לאקסל</button>
        <button class="israa-v2__btn" data-v2-refresh>רענון</button>
      </div>
      ${errorMessage ? `<div class="israa-v2__error">${escapeHtml(errorMessage)}</div>` : ''}
      ${tableHtml()}
    `}
  `;
}

function collectEditor(container, rowKey) {
  const main = container.querySelector(`[data-v2-row-id="${CSS.escape(rowKey)}"]`);
  const detail = container.querySelector(`[data-v2-editor="${CSS.escape(rowKey)}"]`);
  const elements = [...(main?.querySelectorAll('[data-v2-field]') || []), ...(detail?.querySelectorAll('[data-v2-field]') || [])];
  const payload = {};
  elements.forEach((element) => {
    payload[element.dataset.v2Field] = element.value;
  });

  payload.quantity = integerValue(payload.quantity);
  payload.total_amount = numberValue(payload.total_amount);
  payload.total_cost = payload.total_amount == null ? '' : String(payload.total_amount);
  payload.probability = PROBABILITY_OPTIONS.includes(Number(payload.probability)) ? Number(payload.probability) : 30;
  payload.activity_date = payload.proposal_date || null;
  payload.proposal_date = payload.proposal_date || null;
  payload.follow_up_date = payload.follow_up_date || null;
  payload.updated_at = new Date().toISOString();
  return payload;
}

function exportCsv() {
  const columns = [
    ['quote_number', 'מס׳ הצעה'],
    ['school_name', 'בית ספר'],
    ['semel_mosad', 'סמל מוסד'],
    ['authority', 'רשות'],
    ['contact_person', 'איש קשר'],
    ['phone', 'טלפון'],
    ['email', 'דוא״ל'],
    ['program_name', 'תוכנית'],
    ['gefen_numbers', 'מס׳ גפ״ן'],
    ['proposal_nature', 'אופי ההצעה'],
    ['quantity', 'קבוצות'],
    ['proposal_date', 'תאריך הצעה'],
    ['total_amount', 'סכום'],
    ['probability', 'סבירות'],
    ['realistic_value', 'צבר ריאלי'],
    ['status', 'סטטוס'],
    ['next_action', 'הפעולה הבאה'],
    ['follow_up_date', 'תאריך מעקב'],
    ['notes', 'הערות / חסמים']
  ];
  const quote = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  const lines = [columns.map(([, label]) => quote(label)).join(',')];
  rows.forEach((row) => {
    lines.push(columns.map(([key]) => quote(key === 'realistic_value' ? realisticValue(row) : row[key])).join(','));
  });
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `מעקב-הצעות-גפן-תשפז-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function saveExisting(container, id, button) {
  const payload = collectEditor(container, id);
  button.disabled = true;
  try {
    const { data, error } = await supabase
      .from('israa_program_tracking')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    rows = rows.map((row) => row.id === id ? data : row);
    editingId = null;
    errorMessage = '';
    clearScreenDataCache();
    toast('השורה נשמרה.');
  } catch (error) {
    console.error('[israa-tracking-v2-update]', error);
    errorMessage = error?.message || 'שגיאה בשמירה';
  }
}

async function saveNew(container, button) {
  const payload = collectEditor(container, '__new__');
  button.disabled = true;
  try {
    const { data, error } = await supabase
      .from('israa_program_tracking')
      .insert([payload])
      .select('*')
      .single();
    if (error) throw error;
    rows = [data, ...rows];
    addingNew = false;
    newDraft = {};
    errorMessage = '';
    clearScreenDataCache();
    toast('השורה נוספה.');
  } catch (error) {
    console.error('[israa-tracking-v2-insert]', error);
    errorMessage = error?.message || 'שגיאה בהוספה';
  }
}

async function deleteRow(id) {
  if (!window.confirm('למחוק את השורה הזו?')) return;
  try {
    const { error } = await supabase.from('israa_program_tracking').delete().eq('id', id);
    if (error) throw error;
    rows = rows.filter((row) => row.id !== id);
    if (editingId === id) editingId = null;
    if (expandedId === id) expandedId = null;
    clearScreenDataCache();
    toast('השורה נמחקה.');
  } catch (error) {
    console.error('[israa-tracking-v2-delete]', error);
    errorMessage = error?.message || 'שגיאה במחיקה';
  }
}

function bindContainer(container) {
  if (container.dataset.bound === 'true') return;
  container.dataset.bound = 'true';

  container.addEventListener('click', async (event) => {
    const target = event.target;
    if (target.closest('[data-v2-add]')) {
      addingNew = true;
      editingId = null;
      newDraft = { proposal_nature: 'ממוקדת', probability: 50, status: 'טיוטה' };
      renderContainer(container);
      return;
    }
    if (target.closest('[data-v2-export]')) {
      exportCsv();
      return;
    }
    if (target.closest('[data-v2-refresh]')) {
      loaded = false;
      await loadData(true);
      renderContainer(container);
      return;
    }
    const editButton = target.closest('[data-v2-edit]');
    if (editButton) {
      editingId = editButton.dataset.v2Edit;
      addingNew = false;
      expandedId = editingId;
      renderContainer(container);
      return;
    }
    if (target.closest('[data-v2-cancel]')) {
      editingId = null;
      renderContainer(container);
      return;
    }
    if (target.closest('[data-v2-cancel-new]')) {
      addingNew = false;
      newDraft = {};
      renderContainer(container);
      return;
    }
    const saveButton = target.closest('[data-v2-save]');
    if (saveButton) {
      await saveExisting(container, saveButton.dataset.v2Save, saveButton);
      renderContainer(container);
      return;
    }
    const saveNewButton = target.closest('[data-v2-save-new]');
    if (saveNewButton) {
      await saveNew(container, saveNewButton);
      renderContainer(container);
      return;
    }
    const deleteButton = target.closest('[data-v2-delete]');
    if (deleteButton) {
      await deleteRow(deleteButton.dataset.v2Delete);
      renderContainer(container);
      return;
    }
    const toggle = target.closest('[data-v2-toggle]');
    if (toggle && !target.closest('.israa-v2__actions')) {
      const id = toggle.dataset.v2Toggle;
      expandedId = expandedId === id ? null : id;
      renderContainer(container);
    }
  });

  container.addEventListener('change', (event) => {
    const programInput = event.target.closest('[data-v2-program-input]');
    if (!programInput) return;
    const matched = courseByName(programInput.value);
    if (!matched) return;
    const editor = programInput.closest('[data-v2-row-id]') || container.querySelector(`[data-v2-row-id="${CSS.escape(programInput.closest('[data-v2-editor]')?.dataset.v2Editor || '')}"]`);
    const rowKey = editor?.dataset.v2RowId || programInput.closest('[data-v2-editor]')?.dataset.v2Editor;
    if (!rowKey) return;
    const gefen = container.querySelector(`[data-v2-row-id="${CSS.escape(rowKey)}"] [data-v2-field="gefen_numbers"]`);
    if (gefen && !clean(gefen.value)) gefen.value = clean(matched.gefen_number);
  });
}

async function enhance(forceReload = false) {
  if (running) return;
  running = true;
  try {
    injectStyles();
    const mgmt = document.querySelector(`#app ${ROOT_SELECTOR}`);
    if (!mgmt || !canUseScreen()) return;

    if (!activeTableTab(mgmt)) {
      mgmt.classList.remove('israa-v2-active');
      mgmt.querySelector(`[${CONTAINER_ATTR}]`)?.remove();
      return;
    }

    mgmt.classList.add('israa-v2-active');
    let container = mgmt.querySelector(`[${CONTAINER_ATTR}]`);
    let created = false;
    if (!container) {
      container = document.createElement('section');
      container.className = 'israa-v2';
      container.setAttribute(CONTAINER_ATTR, 'true');
      const tabbar = mgmt.querySelector('.israa-tabbar');
      if (tabbar) tabbar.insertAdjacentElement('afterend', container);
      else mgmt.prepend(container);
      bindContainer(container);
      created = true;
    }

    if (!loaded || forceReload) {
      renderContainer(container);
      await loadData(forceReload);
      renderContainer(container);
    } else if (created) {
      renderContainer(container);
    }
  } finally {
    running = false;
  }
}

function schedule(forceReload = false) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    enhance(forceReload).catch((error) => console.error('[israa-tracking-v2]', error));
  }, DEBOUNCE_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => schedule(), { once: true });
} else {
  schedule();
}

new MutationObserver(() => schedule()).observe(document.documentElement, {
  childList: true,
  subtree: true
});

window.addEventListener('hashchange', () => schedule());
window.addEventListener('israa-tracking-updated', () => {
  loaded = false;
  schedule(true);
});
