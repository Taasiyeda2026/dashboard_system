import { supabase } from './supabase-client.js';
import { state, clearScreenDataCache } from './state.js';
import { showToast } from './screens/shared/toast.js';
import { escapeHtml } from './screens/shared/html.js';
import { createSharedInteractionLayer } from './screens/shared/interactions.js';

const ISRAA_AUTH_USER_ID = '92bfb9d9-1b17-4022-901a-5f7cf17a263a';
const ROOT_SELECTOR = '.israa-mgmt';
const CONTAINER_ATTR = 'data-israa-tracking-v2';
const PROBABILITY_OPTIONS = [30, 50, 100];
const NATURE_OPTIONS = ['ממוקדת', 'לבחירה', 'משולבת'];
const STATUS_OPTIONS = ['טיוטה','נשלחה','בטיפול','ממתינה לבחירת תוכן','ממתינה לתקציב','אושרה','נדחתה','נסגרה'];
const ui = createSharedInteractionLayer();

let timer;
let running = false;
let rows = [];
let courses = [];
let loaded = false;
let loading = false;
let errorMessage = '';
let openRowId = null;
let drawerMode = 'view';

const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
const numberValue = (value) => {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const integerValue = (value) => Math.max(0, Math.floor(numberValue(value) || 0));
const formatMoney = (value) => `₪${(numberValue(value) || 0).toLocaleString('he-IL', { maximumFractionDigits: 0 })}`;
const formatDate = (value) => {
  if (!value) return '—';
  const parts = String(value).slice(0, 10).split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : clean(value);
};
const realisticValue = (row) => numberValue(row?.realistic_value) ?? Math.round((numberValue(row?.total_amount) || 0) * (numberValue(row?.probability) || 0) / 100);
const proposalItems = (row) => Array.isArray(row?.proposal_items) && row.proposal_items.length ? row.proposal_items : [{
  program_name: row?.program_name, gefen_number: row?.gefen_numbers, quantity: row?.quantity,
  total_price: row?.total_amount, meetings_count: row?.meetings_count, hours_count: row?.hours_count
}].filter((item) => clean(item.program_name));
const itemPrograms = (row) => proposalItems(row).map((item) => clean(item.program_name || item.item_name)).filter(Boolean);
const totalGroups = (row) => proposalItems(row).reduce((sum, item) => sum + integerValue(item.quantity), 0) || integerValue(row?.quantity);

function canUseScreen() {
  const user = state?.user || {};
  return clean(user.auth_user_id) === ISRAA_AUTH_USER_ID || clean(user.user_id) === '3030' || clean(user.display_role || user.role) === 'admin';
}

function statusClass(status) {
  const value = clean(status);
  if (value === 'אושרה') return 'is-approved';
  if (value === 'נשלחה') return 'is-sent';
  if (value === 'נדחתה' || value === 'נסגרה') return 'is-closed';
  if (value.includes('ממתינה')) return 'is-waiting';
  if (value === 'טיוטה') return 'is-draft';
  return 'is-active';
}

function toast(message, type = 'success') {
  try { showToast(message, type); } catch { console[type === 'error' ? 'error' : 'info'](message); }
}

function injectStyles() {
  if (document.getElementById('israa-tracking-v2-styles')) return;
  const style = document.createElement('style');
  style.id = 'israa-tracking-v2-styles';
  style.textContent = `
    .israa-mgmt.israa-v2-active > .israa-toolbar,.israa-mgmt.israa-v2-active > .prog-section{display:none!important}
    .israa-mgmt.israa-v2-active{width:100%;max-width:100%;min-width:0;overflow-x:hidden;box-sizing:border-box}
    .israa-v2{direction:rtl;width:92%;max-width:1360px;min-width:0;margin:12px auto 0;box-sizing:border-box}
    .israa-v2__title-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.israa-v2__title{margin:0;font-size:1.08rem;font-weight:850;color:#0f172a}.israa-v2__sub{margin-top:3px;color:#64748b;font-size:.78rem}
    .israa-v2__toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 10px}.israa-v2__btn{border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;padding:7px 11px;font:inherit;font-size:.8rem;font-weight:750;cursor:pointer}.israa-v2__btn:hover{background:#f8fafc}.israa-v2__btn--primary{border-color:#0f766e;background:#0f766e;color:#fff}.israa-v2__btn--danger{color:#b91c1c;border-color:#fecaca}.israa-v2__btn[disabled]{opacity:.55;cursor:default}
    .israa-v2__kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;width:100%;margin:0 0 12px}.israa-v2__kpi{min-width:0;min-height:68px;display:flex;flex-direction:column;justify-content:center;border:1px solid #e2e8f0;border-radius:11px;background:#fff;padding:9px 12px;box-shadow:0 1px 4px rgba(15,23,42,.04)}.israa-v2__kpi-label{color:#64748b;font-size:.72rem;font-weight:700}.israa-v2__kpi-value{margin-top:3px;color:#0f172a;font-size:1.02rem;font-weight:850}
    .israa-v2__error{margin-bottom:8px;padding:8px 10px;border-radius:8px;background:#fee2e2;color:#991b1b;font-size:.8rem}.israa-v2__loading{padding:24px;text-align:center;color:#64748b}
    .israa-v2__wrap{width:100%;max-width:100%;min-width:0;overflow-x:auto;direction:rtl;box-sizing:border-box;overscroll-behavior-inline:contain;border:1px solid #dbe3ec;border-radius:11px;background:#fff;box-shadow:0 2px 8px rgba(26,51,88,.06)}
    .israa-v2__table{width:100%;min-width:1040px;table-layout:fixed;border-collapse:collapse;font-size:12px}.israa-v2__table th{padding:9px 8px;background:#f1f5f9;color:#334155;border-bottom:1px solid #cbd5e1;text-align:right;font-size:11px;font-weight:800;white-space:nowrap}.israa-v2__table td{height:66px;padding:10px 9px;border-bottom:1px solid #e8edf3;vertical-align:middle;color:#1e293b;overflow:hidden}.israa-v2__row{cursor:pointer}.israa-v2__row:hover td{background:#f8fafc}.israa-v2__center{text-align:center!important;font-variant-numeric:tabular-nums}.israa-v2__primary{font-weight:800;color:#0f172a}.israa-v2__secondary{margin-top:4px;color:#64748b;font-size:10.5px;line-height:1.3}.israa-v2__clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.israa-v2__program{display:grid;gap:3px;min-width:0}.israa-v2__tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:3px}.israa-v2__nature{width:max-content;padding:1px 6px;border-radius:999px;background:#e0f2fe;color:#075985;font-size:9px;font-weight:800}.israa-v2__status{display:inline-block;max-width:100%;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:800;white-space:normal}.israa-v2__status.is-approved{background:#dcfce7;color:#166534}.israa-v2__status.is-sent{background:#dbeafe;color:#1d4ed8}.israa-v2__status.is-waiting{background:#fef3c7;color:#92400e}.israa-v2__status.is-closed{background:#e5e7eb;color:#475569}.israa-v2__status.is-draft{background:#f1f5f9;color:#475569}.israa-v2__status.is-active{background:#ede9fe;color:#6d28d9}.israa-v2__actions{display:flex;justify-content:center}.israa-v2__open{width:32px;height:32px;display:grid;place-items:center;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;font-size:17px;cursor:pointer}.israa-v2__empty{padding:28px!important;text-align:center;color:#64748b}
    .ds-drawer.ds-drawer--israa{width:min(820px,55vw);max-width:calc(100vw - 32px)}.ds-drawer.ds-drawer--israa .ds-drawer__content{padding:0;overflow-y:auto}.israa-drawer{direction:rtl;color:#1e293b}.israa-drawer__hero{position:sticky;top:0;z-index:2;padding:14px 18px 12px;background:#fff;border-bottom:1px solid #e2e8f0}.israa-drawer__hero-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.israa-drawer__heading{margin:0;font-size:1.2rem;color:#0f172a}.israa-drawer__meta{display:flex;flex-wrap:wrap;gap:5px 12px;margin-top:5px;color:#64748b;font-size:.76rem}.israa-drawer__hero-actions{display:flex;gap:7px;flex-shrink:0}.israa-drawer__body{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:14px 18px 22px}.israa-drawer__section{min-width:0;border:1px solid #dbe3ec;border-radius:11px;background:#fff;overflow:hidden}.israa-drawer__section--wide{grid-column:1/-1}.israa-drawer__section h3{margin:0;padding:9px 11px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:.86rem}.israa-drawer__grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:11px}.israa-drawer__field{min-width:0}.israa-drawer__field--wide{grid-column:1/-1}.israa-drawer__label{display:block;margin-bottom:3px;color:#64748b;font-size:.68rem;font-weight:750}.israa-drawer__value{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.82rem;line-height:1.5}.israa-drawer__metric{padding:9px;border-radius:8px;background:#f8fafc}.israa-drawer__metric .israa-drawer__value{font-weight:800}.israa-drawer__table-wrap{overflow-x:auto;padding:10px}.israa-drawer__table{width:100%;min-width:610px;border-collapse:collapse;font-size:.76rem}.israa-drawer__table th,.israa-drawer__table td{padding:7px;border-bottom:1px solid #e2e8f0;text-align:right}.israa-drawer__table th{color:#64748b;background:#f8fafc}.israa-drawer__form{display:contents}.israa-v2__input,.israa-v2__select,.israa-v2__textarea{width:100%;min-width:0;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:7px;padding:7px;background:#fff;color:#0f172a;font:inherit;font-size:.78rem}.israa-v2__textarea{min-height:88px;resize:vertical}.israa-drawer__danger-row{display:flex;justify-content:flex-end;padding:0 18px 18px}.israa-drawer__error{grid-column:1/-1;color:#b91c1c;font-size:.78rem}
    @media(max-width:1100px){.israa-v2{width:94%}.israa-v2__table{min-width:980px}.ds-drawer.ds-drawer--israa{width:min(820px,72vw)}}
    @media(max-width:700px){.israa-v2{width:calc(100% - 24px)}.israa-v2__kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.israa-v2__table{min-width:980px}.ds-drawer.ds-drawer--israa{width:calc(100vw - 16px);max-width:calc(100vw - 16px)}.israa-drawer__body{grid-template-columns:1fr;padding-inline:12px}.israa-drawer__section--wide{grid-column:auto}.israa-drawer__grid{grid-template-columns:repeat(2,minmax(0,1fr))}.israa-drawer__hero{padding-inline:12px}}
    @media(max-width:430px){.israa-v2__kpis{grid-template-columns:1fr}.israa-drawer__grid{grid-template-columns:1fr}.israa-drawer__field--wide{grid-column:auto}.israa-drawer__hero-top{flex-direction:column}.israa-drawer__hero-actions{width:100%}}
  `;
  document.head.appendChild(style);
}

async function loadData(force = false) {
  if (!supabase || loading || (loaded && !force)) return;
  loading = true; errorMessage = '';
  try {
    const [tracking, catalog] = await Promise.all([
      supabase.from('israa_program_tracking').select('*').order('proposal_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }),
      supabase.from('proposal_gefen_courses').select('short_name,gefen_number,sort_order').eq('is_active', true).order('sort_order', { ascending: true })
    ]);
    if (tracking.error) throw tracking.error;
    if (catalog.error) throw catalog.error;
    rows = Array.isArray(tracking.data) ? tracking.data : [];
    courses = Array.isArray(catalog.data) ? catalog.data : [];
    loaded = true;
  } catch (error) {
    console.error('[israa-tracking-v2-load]', error);
    errorMessage = error?.message || 'שגיאה בטעינת טבלת המעקב';
  } finally { loading = false; }
}

function searchableRowText(row) {
  return [row.authority,row.school_name,row.semel_mosad,row.quote_number,row.program_name,row.gefen_numbers,row.contact_person,row.phone,row.email,row.status,row.next_action,row.notes,row.barriers,row.outreach_method,
    ...proposalItems(row).flatMap((item) => [item.program_name,item.item_name,item.gefen_number])].map(clean).filter(Boolean).join(' ');
}

function kpiHtml() {
  const total = rows.reduce((sum, row) => sum + (numberValue(row.total_amount) || 0), 0);
  const realistic = rows.reduce((sum, row) => sum + realisticValue(row), 0);
  const approved = rows.filter((row) => clean(row.status) === 'אושרה').reduce((sum, row) => sum + (numberValue(row.total_amount) || 0), 0);
  return `<div class="israa-v2__kpis">${[['מספר הצעות',rows.length.toLocaleString('he-IL')],['שווי הצעות כולל',formatMoney(total)],['שווי צבר ריאלי',formatMoney(realistic)],['שווי הצעות שאושרו',formatMoney(approved)]].map(([label,value]) => `<div class="israa-v2__kpi"><div class="israa-v2__kpi-label">${label}</div><div class="israa-v2__kpi-value">${escapeHtml(value)}</div></div>`).join('')}</div>`;
}

function rowHtml(row) {
  const programs = itemPrograms(row);
  const programMeta = `${programs.length > 1 ? `${programs.length} תוכניות · ` : ''}${totalGroups(row)} קבוצות`;
  return `<tr class="israa-v2__row" tabindex="0" data-v2-row-id="${escapeHtml(row.id)}" data-v2-open="${escapeHtml(row.id)}" data-v2-search-text="${escapeHtml(searchableRowText(row))}" data-v2-programs="${escapeHtml(programs.join('|'))}">
    <td><div class="israa-v2__primary israa-v2__clamp">${escapeHtml(clean(row.school_name) || '—')}</div><div class="israa-v2__secondary">סמל מוסד: ${escapeHtml(clean(row.semel_mosad) || '—')}</div></td>
    <td><div class="israa-v2__clamp">${escapeHtml(clean(row.authority) || '—')}</div></td>
    <td class="israa-v2__center"><span class="israa-v2__primary">${escapeHtml(clean(row.quote_number) || '—')}</span></td>
    <td><div class="israa-v2__program"><span class="israa-v2__primary israa-v2__clamp">${escapeHtml(programs[0] || clean(row.program_name) || '—')}</span><span class="israa-v2__secondary">${escapeHtml(programMeta)}</span><span class="israa-v2__nature">${escapeHtml(clean(row.proposal_nature) || 'ממוקדת')}</span></div></td>
    <td><div class="israa-v2__primary">${escapeHtml(formatMoney(row.total_amount))}</div><div class="israa-v2__secondary">סבירות ${numberValue(row.probability) || 0}% · צבר ${escapeHtml(formatMoney(realisticValue(row)))}</div></td>
    <td class="israa-v2__center"><span class="israa-v2__status ${statusClass(row.status)}">${escapeHtml(clean(row.status) || '—')}</span></td>
    <td><div class="israa-v2__primary">${escapeHtml(formatDate(row.follow_up_date))}</div><div class="israa-v2__secondary israa-v2__clamp" title="${escapeHtml(clean(row.next_action))}">${escapeHtml(clean(row.next_action) || '—')}</div></td>
    <td class="israa-v2__center"><div class="israa-v2__actions"><button type="button" class="israa-v2__open" data-v2-open-button="${escapeHtml(row.id)}" aria-label="פתיחת פרטי ההצעה" title="פתיחת פרטים">‹</button></div></td>
  </tr>`;
}

function tableHtml() {
  const body = rows.length ? rows.map(rowHtml).join('') : '<tr><td colspan="8" class="israa-v2__empty">אין הצעות במעקב.</td></tr>';
  return `<div class="israa-v2__wrap"><table class="israa-v2__table" dir="rtl"><colgroup><col style="width:15%"><col style="width:11%"><col style="width:10%"><col style="width:18%"><col style="width:14%"><col style="width:10%"><col style="width:16%"><col style="width:6%"></colgroup><thead><tr><th>בית ספר</th><th>רשות</th><th class="israa-v2__center">מס׳ הצעה</th><th>תוכניות</th><th>נתונים כספיים</th><th class="israa-v2__center">סטטוס</th><th>מעקב</th><th class="israa-v2__center">פעולות</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderContainer(container) {
  container.innerHTML = `<div class="israa-v2__title-row"><div><h2 class="israa-v2__title">מעקב הצעות גפ״ן – תשפ״ז</h2><div class="israa-v2__sub">לחיצה על שורה מציגה את מלוא פרטי ההצעה</div></div></div>${loading ? '<div class="israa-v2__loading">טוען נתונים…</div>' : `${kpiHtml()}<div class="israa-v2__toolbar"><button class="israa-v2__btn israa-v2__btn--primary" data-v2-add>הוספת הצעה</button><button class="israa-v2__btn" data-v2-export>ייצוא לאקסל</button><button class="israa-v2__btn" data-v2-refresh>רענון</button></div>${errorMessage ? `<div class="israa-v2__error">${escapeHtml(errorMessage)}</div>` : ''}${tableHtml()}`}`;
  window.dispatchEvent(new CustomEvent('israa-tracking-rendered'));
}

function valueField(label, value, className = '') {
  return `<div class="israa-drawer__field ${className}"><span class="israa-drawer__label">${escapeHtml(label)}</span><div class="israa-drawer__value">${escapeHtml(clean(value) || '—')}</div></div>`;
}

function inputField(label, key, value, type = 'text', className = '') {
  let control;
  if (type === 'textarea') control = `<textarea class="israa-v2__textarea" data-v2-field="${key}">${escapeHtml(value ?? '')}</textarea>`;
  else if (type === 'status') control = `<select class="israa-v2__select" data-v2-field="${key}">${STATUS_OPTIONS.map((option) => `<option${clean(value) === option ? ' selected' : ''}>${option}</option>`).join('')}</select>`;
  else if (type === 'nature') control = `<select class="israa-v2__select" data-v2-field="${key}">${NATURE_OPTIONS.map((option) => `<option${clean(value || 'ממוקדת') === option ? ' selected' : ''}>${option}</option>`).join('')}</select>`;
  else if (type === 'probability') control = `<select class="israa-v2__select" data-v2-field="${key}">${PROBABILITY_OPTIONS.map((option) => `<option value="${option}"${Number(value || 50) === option ? ' selected' : ''}>${option}%</option>`).join('')}</select>`;
  else control = `<input class="israa-v2__input" data-v2-field="${key}" type="${type}" value="${escapeHtml(value ?? '')}"${key === 'program_name' ? ' list="israa-v2-course-options" data-v2-program-input' : ''}>`;
  return `<label class="israa-drawer__field ${className}"><span class="israa-drawer__label">${escapeHtml(label)}</span>${control}</label>`;
}

function sectionHtml(title, content, wide = false) { return `<section class="israa-drawer__section${wide ? ' israa-drawer__section--wide' : ''}"><h3>${escapeHtml(title)}</h3>${content}</section>`; }
function programsTableHtml(row) {
  const items = proposalItems(row);
  return `<div class="israa-drawer__table-wrap"><table class="israa-drawer__table"><thead><tr><th>תוכנית</th><th>מס׳ גפ״ן</th><th>קבוצות</th><th>סכום</th><th>מפגשים</th><th>שעות</th></tr></thead><tbody>${items.length ? items.map((item) => `<tr><td>${escapeHtml(clean(item.program_name || item.item_name) || '—')}</td><td>${escapeHtml(clean(item.gefen_number) || '—')}</td><td>${escapeHtml(clean(item.quantity) || '—')}</td><td>${escapeHtml(formatMoney(item.total_price ?? item.amount))}</td><td>${escapeHtml(clean(item.meetings_count || item.meetings) || '—')}</td><td>${escapeHtml(clean(item.hours_count || item.hours) || '—')}</td></tr>`).join('') : '<tr><td colspan="6">לא הוגדרו תוכניות.</td></tr>'}</tbody></table></div>`;
}

function drawerContent(row, mode) {
  const editing = mode === 'edit' || mode === 'create';
  const draft = row || { proposal_nature: 'ממוקדת', probability: 50, status: 'טיוטה', proposal_items: [] };
  const fields = editing ? {
    snapshot: [inputField('תאריך ההצעה','proposal_date',draft.proposal_date,'date'),inputField('תוקף ההצעה','valid_until',draft.valid_until,'date'),inputField('מספר קבוצות','quantity',draft.quantity,'number'),inputField('סכום כולל','total_amount',draft.total_amount,'number'),inputField('סבירות','probability',draft.probability,'probability'),valueField('צבר ריאלי',formatMoney(realisticValue(draft)),'israa-drawer__metric')].join(''),
    proposal: [inputField('תוכנית ראשית','program_name',draft.program_name),inputField('מס׳ גפ״ן','gefen_numbers',draft.gefen_numbers),inputField('אופי ההצעה','proposal_nature',draft.proposal_nature,'nature')].join(''),
    tracking: [inputField('סטטוס','status',draft.status,'status'),inputField('תאריך המעקב','follow_up_date',draft.follow_up_date,'date'),inputField('הפעולה הבאה','next_action',draft.next_action,'textarea','israa-drawer__field--wide'),inputField('אופן הפנייה','outreach_method',draft.outreach_method),inputField('חסמים','barriers',draft.barriers,'textarea','israa-drawer__field--wide')].join(''),
    contact: [inputField('איש קשר','contact_person',draft.contact_person),inputField('טלפון','phone',draft.phone,'tel'),inputField('דוא״ל','email',draft.email,'email')].join(''),
    notes: inputField('הערות','notes',draft.notes,'textarea','israa-drawer__field--wide'),
    identity: [inputField('בית ספר','school_name',draft.school_name),inputField('סמל מוסד','semel_mosad',draft.semel_mosad),inputField('רשות','authority',draft.authority),inputField('מס׳ הצעה','quote_number',draft.quote_number)].join('')
  } : {
    snapshot: [valueField('תאריך ההצעה',formatDate(draft.proposal_date),'israa-drawer__metric'),valueField('תוקף ההצעה',formatDate(draft.valid_until),'israa-drawer__metric'),valueField('מספר קבוצות',String(totalGroups(draft)),'israa-drawer__metric'),valueField('סכום כולל',formatMoney(draft.total_amount),'israa-drawer__metric'),valueField('סבירות',`${numberValue(draft.probability) || 0}%`,'israa-drawer__metric'),valueField('צבר ריאלי',formatMoney(realisticValue(draft)),'israa-drawer__metric')].join(''),
    tracking: [valueField('סטטוס',draft.status),valueField('תאריך המעקב',formatDate(draft.follow_up_date)),valueField('הפעולה הבאה',draft.next_action,'israa-drawer__field--wide'),valueField('אופן הפנייה',draft.outreach_method),valueField('חסמים',draft.barriers,'israa-drawer__field--wide')].join(''),
    contact: [valueField('איש קשר',draft.contact_person),draft.phone ? `<div class="israa-drawer__field"><span class="israa-drawer__label">טלפון</span><a class="israa-drawer__value" href="tel:${escapeHtml(draft.phone)}">${escapeHtml(draft.phone)}</a></div>` : valueField('טלפון','—'),draft.email ? `<div class="israa-drawer__field"><span class="israa-drawer__label">דוא״ל</span><a class="israa-drawer__value" href="mailto:${escapeHtml(draft.email)}">${escapeHtml(draft.email)}</a></div>` : valueField('דוא״ל','—')].join(''),
    notes: valueField('הערות',draft.notes,'israa-drawer__field--wide')
  };
  const title = mode === 'create' ? 'הצעה חדשה' : clean(draft.school_name) || 'פרטי הצעה';
  const buttons = editing ? `<button type="button" class="israa-v2__btn" data-v2-drawer-cancel>ביטול</button><button type="submit" class="israa-v2__btn israa-v2__btn--primary" data-v2-drawer-save>${mode === 'create' ? 'יצירה' : 'שמירה'}</button>` : `<button type="button" class="israa-v2__btn israa-v2__btn--primary" data-v2-drawer-edit>עריכה</button>`;
  return `<form class="israa-drawer__form" data-v2-drawer-form data-v2-editor="${mode === 'create' ? '__new__' : escapeHtml(draft.id)}"><div class="israa-drawer"><header class="israa-drawer__hero"><div class="israa-drawer__hero-top"><div><h2 class="israa-drawer__heading">${escapeHtml(title)}</h2><div class="israa-drawer__meta">${mode === 'create' ? '' : `<span>${escapeHtml(clean(draft.authority) || '—')}</span><span>סמל ${escapeHtml(clean(draft.semel_mosad) || '—')}</span><span>הצעה ${escapeHtml(clean(draft.quote_number) || '—')}</span><span class="israa-v2__status ${statusClass(draft.status)}">${escapeHtml(clean(draft.status) || '—')}</span><span class="israa-v2__nature">${escapeHtml(clean(draft.proposal_nature) || 'ממוקדת')}</span>`}</div></div><div class="israa-drawer__hero-actions">${buttons}</div></div></header><div class="israa-drawer__body">${editing ? sectionHtml('פרטי ההצעה','<div class="israa-drawer__grid">'+fields.identity+'</div>',true) : ''}${sectionHtml('תמונת מצב','<div class="israa-drawer__grid">'+fields.snapshot+'</div>',true)}${editing ? sectionHtml('פרטי תוכנית','<div class="israa-drawer__grid">'+fields.proposal+'</div>',true) : sectionHtml('פירוט התוכניות',programsTableHtml(draft),true)}${sectionHtml('מעקב והתקדמות','<div class="israa-drawer__grid">'+fields.tracking+'</div>',true)}${sectionHtml('פרטי איש קשר','<div class="israa-drawer__grid">'+fields.contact+'</div>')}${sectionHtml('הערות','<div class="israa-drawer__grid">'+fields.notes+'</div>')}<div class="israa-drawer__error" data-v2-drawer-error></div></div>${!editing ? `<div class="israa-drawer__danger-row"><button type="button" class="israa-v2__btn israa-v2__btn--danger" data-v2-drawer-delete>מחיקת הצעה</button></div>` : ''}<datalist id="israa-v2-course-options">${courses.map((course) => `<option value="${escapeHtml(course.short_name)}">${escapeHtml(course.gefen_number)}</option>`).join('')}</datalist></div></form>`;
}

function openDrawer(row, mode = 'view') {
  const requestedId = row?.id || null;
  openRowId = requestedId; drawerMode = mode;
  ui.openDrawer({ title: mode === 'create' ? 'הוספת הצעה' : 'פרטי הצעה', content: drawerContent(row, mode), onClose: () => { document.querySelector('.ds-drawer--israa')?.classList.remove('ds-drawer--israa'); openRowId = null; drawerMode = 'view'; }, onOpen: (content) => {
    openRowId = requestedId; drawerMode = mode;
    const drawer = content.closest('.ds-drawer'); drawer?.classList.add('ds-drawer--israa');
    bindDrawer(content);
  }});
}

function collectDrawer(form) {
  const payload = {};
  form.querySelectorAll('[data-v2-field]').forEach((field) => { payload[field.dataset.v2Field] = field.value; });
  payload.quantity = integerValue(payload.quantity); payload.total_amount = numberValue(payload.total_amount);
  payload.total_cost = payload.total_amount == null ? '' : String(payload.total_amount);
  payload.probability = PROBABILITY_OPTIONS.includes(Number(payload.probability)) ? Number(payload.probability) : 50;
  payload.activity_date = payload.proposal_date || null; payload.proposal_date = payload.proposal_date || null;
  payload.valid_until = payload.valid_until || null; payload.follow_up_date = payload.follow_up_date || null;
  payload.updated_at = new Date().toISOString();
  return payload;
}

async function saveDrawer(form, button) {
  button.disabled = true;
  const payload = collectDrawer(form); const creating = drawerMode === 'create';
  try {
    const query = creating ? supabase.from('israa_program_tracking').insert([payload]) : supabase.from('israa_program_tracking').update(payload).eq('id', openRowId);
    const { data, error } = await query.select('*').single();
    if (error) throw error;
    rows = creating ? [data, ...rows] : rows.map((row) => row.id === data.id ? data : row);
    openRowId = data.id; drawerMode = 'view'; clearScreenDataCache();
    const container = document.querySelector(`[${CONTAINER_ATTR}]`); if (container) renderContainer(container);
    openDrawer(data, 'view'); toast(creating ? 'ההצעה נוספה.' : 'ההצעה נשמרה.');
  } catch (error) {
    console.error('[israa-tracking-v2-save]', error); const node = form.querySelector('[data-v2-drawer-error]'); if (node) node.textContent = error?.message || 'שגיאה בשמירה'; button.disabled = false;
  }
}

async function deleteRow(row) {
  if (!row || !window.confirm('למחוק את ההצעה הזו?')) return;
  const { error } = await supabase.from('israa_program_tracking').delete().eq('id', row.id);
  if (error) { toast(error.message || 'שגיאה במחיקה', 'error'); return; }
  rows = rows.filter((item) => item.id !== row.id); clearScreenDataCache(); ui.closeDrawer();
  const container = document.querySelector(`[${CONTAINER_ATTR}]`); if (container) renderContainer(container); toast('ההצעה נמחקה.');
}

function bindDrawer(content) {
  content.addEventListener('click', async (event) => {
    if (event.target.closest('[data-v2-drawer-edit]')) { openDrawer(rows.find((row) => row.id === openRowId), 'edit'); return; }
    if (event.target.closest('[data-v2-drawer-cancel]')) { if (drawerMode === 'create') ui.closeDrawer(); else openDrawer(rows.find((row) => row.id === openRowId), 'view'); return; }
    if (event.target.closest('[data-v2-drawer-delete]')) await deleteRow(rows.find((row) => row.id === openRowId));
  });
  content.querySelector('[data-v2-drawer-form]')?.addEventListener('submit', (event) => { event.preventDefault(); saveDrawer(event.currentTarget, event.submitter || event.currentTarget.querySelector('[data-v2-drawer-save]')); });
  content.addEventListener('change', (event) => {
    const input = event.target.closest('[data-v2-program-input]'); if (!input) return;
    const course = courses.find((item) => clean(item.short_name).toLowerCase() === clean(input.value).toLowerCase());
    const gefen = content.querySelector('[data-v2-field="gefen_numbers"]'); if (course && gefen && !clean(gefen.value)) gefen.value = clean(course.gefen_number);
  });
}

function exportCsv() {
  const columns = [['quote_number','מס׳ הצעה'],['school_name','בית ספר'],['semel_mosad','סמל מוסד'],['authority','רשות'],['contact_person','איש קשר'],['phone','טלפון'],['email','דוא״ל'],['program_name','תוכנית'],['gefen_numbers','מס׳ גפ״ן'],['proposal_nature','אופי ההצעה'],['quantity','קבוצות'],['proposal_date','תאריך הצעה'],['valid_until','תוקף'],['total_amount','סכום'],['probability','סבירות'],['realistic_value','צבר ריאלי'],['status','סטטוס'],['next_action','הפעולה הבאה'],['follow_up_date','תאריך מעקב'],['outreach_method','אופן הפנייה'],['notes','הערות'],['barriers','חסמים'],['proposal_items','פירוט תוכניות']];
  const quote = (value) => `"${String(value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : value).replace(/"/g, '""')}"`;
  const lines = [columns.map(([, label]) => quote(label)).join(','), ...rows.map((row) => columns.map(([key]) => quote(key === 'realistic_value' ? realisticValue(row) : row[key])).join(','))];
  const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `מעקב-הצעות-גפן-תשפז-${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
}

function bindContainer(container) {
  if (container.dataset.bound === 'true') return; container.dataset.bound = 'true';
  container.addEventListener('click', async (event) => {
    if (event.target.closest('[data-v2-add]')) return openDrawer(null, 'create');
    if (event.target.closest('[data-v2-export]')) return exportCsv();
    if (event.target.closest('[data-v2-refresh]')) { loaded = false; await loadData(true); renderContainer(container); return; }
    const button = event.target.closest('[data-v2-open-button]');
    const rowElement = event.target.closest('[data-v2-open]');
    if (button || (rowElement && !event.target.closest('button,a,input,select,textarea'))) { const id = button?.dataset.v2OpenButton || rowElement.dataset.v2Open; openDrawer(rows.find((row) => String(row.id) === String(id))); }
  });
  container.addEventListener('keydown', (event) => { const row = event.target.closest('[data-v2-open]'); if (row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openDrawer(rows.find((item) => String(item.id) === row.dataset.v2Open)); } });
}

async function enhance(forceReload = false) {
  if (running) return; running = true;
  try {
    injectStyles(); const mgmt = document.querySelector(`#app ${ROOT_SELECTOR}`); if (!mgmt || !canUseScreen()) return;
    const active = mgmt.querySelector('[data-israa-tab].is-active');
    if (active && clean(active.dataset.israaTab) !== 'table') { mgmt.classList.remove('israa-v2-active'); mgmt.querySelector(`[${CONTAINER_ATTR}]`)?.remove(); return; }
    mgmt.classList.add('israa-v2-active'); let container = mgmt.querySelector(`[${CONTAINER_ATTR}]`); let created = false;
    if (!container) { container = document.createElement('section'); container.className = 'israa-v2'; container.setAttribute(CONTAINER_ATTR,'true'); const tabbar = mgmt.querySelector('.israa-tabbar'); if (tabbar) tabbar.insertAdjacentElement('afterend',container); else mgmt.prepend(container); bindContainer(container); created = true; }
    if (!loaded || forceReload) { renderContainer(container); await loadData(forceReload); renderContainer(container); } else if (created) renderContainer(container);
  } finally { running = false; }
}

function schedule(force = false) { clearTimeout(timer); timer = setTimeout(() => enhance(force).catch((error) => console.error('[israa-tracking-v2]', error)), 90); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => schedule(), { once:true }); else schedule();
new MutationObserver(() => schedule()).observe(document.documentElement, { childList:true, subtree:true });
window.addEventListener('hashchange', () => schedule());
window.addEventListener('israa-tracking-updated', () => { loaded = false; schedule(true); });
