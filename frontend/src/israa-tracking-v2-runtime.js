import { supabase } from './supabase-client.js';
import { state, clearScreenDataCache } from './state.js';
import { showToast } from './screens/shared/toast.js';
import { canViewIsraaManagement } from './permissions.js';
import { escapeHtml } from './screens/shared/html.js';
import { createSharedInteractionLayer } from './screens/shared/interactions.js';
import { activitiesTable } from './israa-proposal-items.js';
import { exportIsraaWorkbook } from './israa-excel-export.js';

const ROOT_SELECTOR = '.israa-mgmt';
const CONTAINER_ATTR = 'data-israa-tracking-v2';
const PROBABILITY_OPTIONS = [30, 50, 100];
const NATURE_OPTIONS = ['תוכנית מוגדרת', 'חלופות לבחירה'];
const STATUS_OPTIONS = ['טיוטה','נשלחה','בטיפול','ממתינה לבחירת תוכן','ממתינה לתקציב','אושרה','נדחתה','נסגרה'];
const ui = createSharedInteractionLayer();

const EXTERNAL_COLUMNS = [
  'מסד',
  'מספר הצעה',
  'בית ספר',
  'סמל מוסד',
  'רשות',
  'סכום ההצעה',
  'הערכת סגירה',
  'תחזית כספית',
  'סטטוס',
  'פעולה להמשך',
  'תאריך מעקב',
];

let timer;
let running = false;
let rows = [];
let availableProposals = [];
let loaded = false;
let loading = false;
let errorMessage = '';
let openRowId = null;
let drawerMode = 'view';
let multiSelectOutsideClickBound = false;

const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
const numberValue = (value) => {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const formatMoney = (value) => `₪${(numberValue(value) || 0).toLocaleString('he-IL', { maximumFractionDigits: 0 })}`;
const formatDate = (value) => {
  if (!value) return '—';
  const parts = String(value).slice(0, 10).split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : clean(value);
};
const realisticValue = (row) => numberValue(row?.realistic_value)
  ?? Math.round((numberValue(row?.total_amount) || 0) * (numberValue(row?.probability) || 0) / 100);
const activityNames = (row) => {
  if (Array.isArray(row?.proposal_items) && row.proposal_items.length) {
    return row.proposal_items.map((item) => clean(item?.program_name)).filter(Boolean);
  }
  return clean(row?.program_name).split(/\s*[•;]\s*/).map(clean).filter(Boolean);
};

function canUseScreen() {
  return canViewIsraaManagement(state?.user);
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
    .israa-v2{direction:rtl;width:94%;max-width:1540px;min-width:0;margin:12px auto 0;box-sizing:border-box}
    .israa-v2__title-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.israa-v2__title{margin:0;font-size:1.08rem;font-weight:850;color:#0f172a}
    .israa-v2__toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 10px}.israa-v2__toolbar>.israa-v2__btn{width:fit-content;height:32px;padding:5px 10px;border-radius:7px;font-size:12px;line-height:1}.israa-v2__btn{border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;padding:7px 11px;font:inherit;font-size:.8rem;font-weight:750;cursor:pointer}.israa-v2__btn:hover{background:#f8fafc}.israa-v2__btn--primary{border-color:#0f766e;background:#0f766e;color:#fff}.israa-v2__btn--danger{color:#b91c1c;border-color:#fecaca}.israa-v2__btn[disabled]{opacity:.55;cursor:default}
    .israa-v2__kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;width:52%;max-width:760px;margin:0 0 12px auto}.israa-v2__kpi{min-width:0;min-height:68px;display:flex;flex-direction:column;justify-content:center;border:1px solid #e2e8f0;border-radius:11px;background:#fff;padding:9px 12px;box-shadow:0 1px 4px rgba(15,23,42,.04)}.israa-v2__kpi-label{color:#64748b;font-size:.72rem;font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.israa-v2__kpi-value{margin-top:3px;color:#0f172a;font-size:1.02rem;font-weight:850;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .israa-v2__error{margin-bottom:8px;padding:8px 10px;border-radius:8px;background:#fee2e2;color:#991b1b;font-size:.8rem}.israa-v2__loading{padding:24px;text-align:center;color:#64748b}
    .israa-v2__wrap{width:100%;max-width:100%;min-width:0;overflow:hidden;direction:rtl;box-sizing:border-box;border:1px solid #dbe3ec;border-radius:11px;background:#fff;box-shadow:0 2px 8px rgba(26,51,88,.06)}
    .israa-v2__table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px}.israa-v2__table th{padding:7px 4px;background:#f1f5f9;color:#334155;border-bottom:1px solid #cbd5e1;text-align:right;font-size:11.5px;font-weight:800;white-space:normal;overflow-wrap:anywhere;line-height:1.25}.israa-v2__table td{height:58px;padding:7px 4px;border-bottom:1px solid #e8edf3;vertical-align:middle;color:#1e293b;overflow:hidden;overflow-wrap:anywhere}.israa-v2__row{cursor:pointer}.israa-v2__row:hover td{background:#f8fafc}.israa-v2__center{text-align:center!important;font-variant-numeric:tabular-nums}.israa-v2__primary{font-weight:800;color:#0f172a}.israa-v2__clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.israa-v2__status{display:inline-block;max-width:100%;padding:3px 5px;border-radius:999px;font-size:11px;font-weight:800;white-space:normal;overflow-wrap:anywhere}.israa-v2__status.is-approved{background:#dcfce7;color:#166534}.israa-v2__status.is-sent{background:#dbeafe;color:#1d4ed8}.israa-v2__status.is-waiting{background:#fef3c7;color:#92400e}.israa-v2__status.is-closed{background:#e5e7eb;color:#475569}.israa-v2__status.is-draft{background:#f1f5f9;color:#475569}.israa-v2__status.is-active{background:#ede9fe;color:#6d28d9}.israa-v2__date{white-space:nowrap;text-align:center;direction:ltr}.israa-v2__empty{padding:28px!important;text-align:center;color:#64748b}
    .ds-drawer.ds-drawer--israa-exact{width:min(960px,64vw);max-width:calc(100vw - 32px)}.ds-drawer.ds-drawer--israa-exact .ds-drawer__content{padding:0;overflow-y:auto;background:#f4f7fb}.ds-drawer.ds-drawer--israa-detail>.ds-drawer__header{display:none}.israa-drawer{direction:rtl;color:#1e293b;min-height:100%;background:#f4f7fb}.israa-drawer__header{position:sticky;top:0;z-index:4;display:flex;align-items:center;justify-content:space-between;gap:18px;min-height:72px;padding:14px 18px;background:#142a46;color:#fff;box-shadow:0 2px 8px rgba(15,23,42,.16)}.israa-drawer__title-wrap{min-width:0}.israa-drawer__title{margin:0;color:#fff;font-size:18px;font-weight:850;line-height:1.35;overflow-wrap:anywhere}.israa-drawer__header-actions{display:inline-flex;align-items:center;gap:8px;flex:0 0 auto}.israa-drawer__header .israa-v2__btn{border-color:#0d9488;background:#0d9488;color:#fff}.israa-drawer__header .israa-v2__btn:hover{background:#0f766e}.israa-drawer__close{display:grid;place-items:center;width:36px;height:36px;padding:0;border:1px solid rgba(255,255,255,.35);border-radius:8px;background:transparent;color:#fff;font:inherit;font-size:18px;cursor:pointer;pointer-events:auto}.israa-drawer__close:hover{background:rgba(255,255,255,.14)}.israa-drawer__body{display:grid;gap:11px;padding:14px 18px 20px}.israa-drawer__section{border:1px solid #dce3ec;border-radius:11px;padding:12px 14px;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.04)}.israa-drawer__section-title{margin:0 0 9px;color:#1e3a5f;font-size:15px;font-weight:800}.israa-drawer__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px}.israa-drawer__compact-row{display:flex;justify-content:flex-start;gap:24px;width:fit-content;max-width:100%;flex-wrap:wrap}.israa-drawer__field{min-width:0}.israa-drawer__field--wide{grid-column:1/-1}.israa-drawer__field--short{max-width:220px}.israa-drawer__label{display:block;margin-bottom:4px;color:#64748b;font-size:11px;font-weight:700}.israa-drawer__value{color:#1e293b;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.5}.israa-drawer__tags{display:flex;flex-wrap:wrap;gap:6px}.israa-drawer__tag{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border:1px solid #cbd5e1;border-radius:999px;background:#f8fafc;font-weight:750}.israa-drawer__tag-remove{border:0;background:transparent;color:#64748b;padding:0;cursor:pointer;font-size:14px}.israa-drawer__readonly{padding:8px;border:1px solid #dce3ec;border-radius:7px;background:#f8fafc;font-weight:750}.israa-drawer__form{display:contents}.israa-v2__input,.israa-v2__select,.israa-v2__textarea{width:100%;min-width:0;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:7px;padding:8px;background:#fff;color:#1e293b;font:inherit;font-size:13px}.israa-v2__input:focus,.israa-v2__select:focus,.israa-v2__textarea:focus{outline:2px solid rgba(37,99,235,.2);border-color:#2563eb}.israa-v2__textarea{min-height:82px;resize:vertical}.israa-v2__textarea[data-v2-field="next_action"]{min-height:96px}.israa-drawer__activities{width:480px;max-width:100%;min-width:0;table-layout:fixed;border-collapse:separate;border-spacing:0;border:1px solid #dce3ec;border-radius:8px;overflow:hidden;font-size:12.5px;background:#fff;margin-inline-start:0;margin-inline-end:auto}.israa-drawer__activities th{padding:6px 8px;background:#f1f5f9;color:#334155;border-bottom:1px solid #dce3ec;text-align:right}.israa-drawer__activities td{height:35px;padding:6px 8px;border-bottom:1px solid #e7ecf2;vertical-align:middle;overflow-wrap:anywhere}.israa-drawer__activities tbody tr:last-child td{border-bottom:0}.israa-drawer__activities th+th,.israa-drawer__activities td+td{border-right:1px solid #e7ecf2}.israa-drawer__activities th:nth-child(1){width:60%}.israa-drawer__activities th:nth-child(2){width:23%}.israa-drawer__activities th:nth-child(3){width:17%}.israa-drawer__legacy-activities{display:grid;gap:8px;white-space:pre-wrap;font-size:13px}.israa-drawer__section--multi{overflow:visible}.israa-v2__multi{position:relative}.israa-v2__multi-control{display:flex;align-items:flex-start;gap:8px;width:100%}.israa-v2__multi-control [data-v2-expected-tags]{flex:1;min-height:38px;box-sizing:border-box;padding:5px 7px;border:1px solid #cbd5e1;border-radius:7px;background:#fff}.israa-v2__multi-toggle{flex:0 0 auto;min-height:38px;border:1px solid #cbd5e1;border-radius:7px;padding:6px 8px;background:#fff;color:#334155;font:inherit;cursor:pointer;pointer-events:auto}.israa-v2__multi-menu{position:static;width:100%;max-width:520px;max-height:220px;margin-top:7px;overflow-y:auto;border:1px solid #cbd5e1;border-radius:8px;padding:7px;background:#fff;box-shadow:0 4px 12px rgba(15,23,42,.10)}.israa-v2__multi-menu[hidden]{display:none!important}.israa-v2__multi-option{display:flex;align-items:center;gap:7px;padding:6px;font-size:13px;cursor:pointer;pointer-events:auto}.israa-v2__multi-option input{accent-color:#0d9488;cursor:pointer;pointer-events:auto}.israa-drawer__error{color:#b91c1c;font-size:.78rem}
    @media(max-width:1100px){.israa-v2{width:96%}.ds-drawer.ds-drawer--israa-exact{width:min(960px,78vw)}}
    @media(max-width:760px){.israa-v2{width:calc(100% - 12px)}.israa-v2__kpis{width:100%;max-width:none;grid-template-columns:repeat(2,minmax(0,1fr))}.ds-drawer.ds-drawer--israa-exact{width:calc(100vw - 16px);max-width:calc(100vw - 16px)}.israa-drawer__grid{grid-template-columns:repeat(2,minmax(0,1fr))}.israa-drawer__body{padding-inline:12px}.israa-drawer__activities{width:100%;min-width:0}}
    @media(max-width:460px){.israa-v2__kpis{grid-template-columns:1fr}.israa-drawer__grid{grid-template-columns:1fr}.israa-drawer__field--wide{grid-column:auto}}
  `;
  document.head.appendChild(style);
}

async function loadData(force = false) {
  if (!supabase || loading || (loaded && !force)) return;
  loading = true;
  errorMessage = '';
  try {
    const tracking = await supabase.from('israa_program_tracking').select('*').order('proposal_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
    if (tracking.error) throw tracking.error;
    rows = Array.isArray(tracking.data) ? tracking.data : [];
    loaded = true;
  } catch (error) {
    console.error('[israa-tracking-v2-load]', error);
    errorMessage = error?.message || 'שגיאה בטעינת טבלת המעקב';
  } finally {
    loading = false;
  }
}

function searchableRowText(row, index) {
  return [
    index + 1,
    row.quote_number,
    row.school_name,
    row.semel_mosad,
    row.authority,
    row.ownership,
    row.contact_person,
    row.manager_name,
    row.contact_role,
    row.role,
    row.phone,
    row.manager_phone,
    row.email,
    row.manager_email,
    row.additional_contact,
    row.activity_type,
    row.program_name,
    row.gefen_numbers,
    row.proposal_nature,
    row.expected_program,
    row.grade,
    row.participants_groups,
    row.proposal_date,
    row.total_amount,
    row.probability,
    realisticValue(row),
    row.status,
    row.next_action,
    row.follow_up_date,
    row.notes,
  ].map(clean).filter(Boolean).join(' ');
}

function kpiHtml() {
  const total = rows.reduce((sum, row) => sum + (numberValue(row.total_amount) || 0), 0);
  const realistic = rows.reduce((sum, row) => sum + realisticValue(row), 0);
  const approved = rows.filter((row) => clean(row.status) === 'אושרה').reduce((sum, row) => sum + (numberValue(row.total_amount) || 0), 0);
  const values = [
    ['מספר הצעות', rows.length.toLocaleString('he-IL')],
    ['שווי הצעות כולל', formatMoney(total)],
    ['שווי צבר ריאלי', formatMoney(realistic)],
    ['שווי הצעות שאושרו', formatMoney(approved)],
  ];
  return `<div class="israa-v2__kpis">${values.map(([label, value]) => `<div class="israa-v2__kpi"><div class="israa-v2__kpi-label">${label}</div><div class="israa-v2__kpi-value">${escapeHtml(value)}</div></div>`).join('')}</div>`;
}

function rowHtml(row, index) {
  const programs = activityNames(row);
  return `<tr class="israa-v2__row" tabindex="0" data-v2-row-id="${escapeHtml(row.id)}" data-v2-open="${escapeHtml(row.id)}" data-v2-search-text="${escapeHtml(searchableRowText(row, index))}" data-v2-programs="${escapeHtml(programs.join('|'))}">
    <td class="israa-v2__center">${index + 1}</td>
    <td class="israa-v2__center"><span class="israa-v2__primary">${escapeHtml(clean(row.quote_number) || '—')}</span></td>
    <td><div class="israa-v2__primary israa-v2__clamp">${escapeHtml(clean(row.school_name) || '—')}</div></td>
    <td class="israa-v2__center">${escapeHtml(clean(row.semel_mosad) || '—')}</td>
    <td><div class="israa-v2__clamp">${escapeHtml(clean(row.authority) || '—')}</div></td>
    <td class="israa-v2__center"><span class="israa-v2__primary">${escapeHtml(formatMoney(row.total_amount))}</span></td>
    <td class="israa-v2__center">${escapeHtml(`${numberValue(row.probability) || 0}%`)}</td>
    <td class="israa-v2__center"><span class="israa-v2__primary">${escapeHtml(formatMoney(realisticValue(row)))}</span></td>
    <td class="israa-v2__center"><span class="israa-v2__status ${statusClass(row.status)}">${escapeHtml(clean(row.status) || '—')}</span></td>
    <td><div class="israa-v2__clamp" title="${escapeHtml(clean(row.next_action))}">${escapeHtml(clean(row.next_action) || '—')}</div></td>
    <td class="israa-v2__center israa-v2__date" dir="ltr">${escapeHtml(formatDate(row.follow_up_date))}</td>
  </tr>`;
}

function tableHtml() {
  const body = rows.length
    ? rows.map(rowHtml).join('')
    : `<tr><td colspan="${EXTERNAL_COLUMNS.length}" class="israa-v2__empty">אין הצעות במעקב.</td></tr>`;
  const widths = [3.5,6.5,14,6.5,9,9,7,9,8,19,8.5];
  return `<div class="israa-v2__wrap"><table class="israa-v2__table" dir="rtl"><colgroup>${widths.map((width) => `<col style="width:${width}%">`).join('')}</colgroup><thead><tr>${EXTERNAL_COLUMNS.map((label, index) => `<th${[0,1,3,5,6,7,8,10].includes(index) ? ' class="israa-v2__center"' : ''}>${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderContainer(container) {
  container.innerHTML = `<div class="israa-v2__title-row"><h2 class="israa-v2__title">מעקב הצעות גפ״ן – תשפ״ז</h2></div>${loading ? '<div class="israa-v2__loading">טוען נתונים…</div>' : `${kpiHtml()}<div class="israa-v2__toolbar"><button class="israa-v2__btn israa-v2__btn--primary" data-v2-add>הוספת הצעה</button><button class="israa-v2__btn" data-v2-export>ייצוא לאקסל</button></div>${errorMessage ? `<div class="israa-v2__error">${escapeHtml(errorMessage)}</div>` : ''}${tableHtml()}`}`;
  window.dispatchEvent(new CustomEvent('israa-tracking-rendered'));
}

async function openProposalPicker() {
  const linked = new Set(rows.map((row) => clean(row.proposal_agreement_id)).filter(Boolean));
  const { data, error } = await supabase
    .from('proposals_agreements')
    .select('id,quote_number,school_framework,client_authority,proposal_date,status')
    .is('archived_at', null)
    .eq('proposal_domain', 'E')
    .in('status', ['approved', 'sent', 'מאושר', 'מאושר וחתום', 'נשלח'])
    .order('proposal_date', { ascending: false })
    .limit(200);
  if (error) return toast(error.message || 'שגיאה בטעינת הצעות המחיר', 'error');
  availableProposals = (Array.isArray(data) ? data : []).filter((proposal) => !linked.has(clean(proposal.id)));
  const options = availableProposals.map((proposal) => `<option value="${escapeHtml(proposal.id)}">${escapeHtml(`${clean(proposal.quote_number) || 'ללא מספר'} — ${clean(proposal.school_framework) || 'ללא בית ספר'} — ${formatDate(proposal.proposal_date)}`)}</option>`).join('');
  ui.openDrawer({
    title: 'בחירת הצעת מחיר קיימת',
    content: `<div class="israa-drawer"><div class="israa-drawer__body"><section class="israa-drawer__section israa-drawer__section--source"><h3 class="israa-drawer__section-title">הצעה לקישור למעקב</h3><label class="israa-drawer__field"><span class="israa-drawer__label">הצעת מחיר קיימת</span><select class="israa-v2__select" data-v2-proposal-choice>${options || '<option value="">אין הצעות זמינות</option>'}</select></label><div class="israa-drawer__actions"><button type="button" class="israa-v2__btn israa-v2__btn--primary" data-v2-link-proposal ${options ? '' : 'disabled'}>הוספה למעקב</button></div><div class="israa-drawer__error" data-v2-picker-error></div></section></div></div>`,
    onOpen: (content) => {
      content.closest('.ds-drawer')?.classList.add('ds-drawer--israa-exact');
      content.querySelector('[data-v2-link-proposal]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const proposalId = content.querySelector('[data-v2-proposal-choice]')?.value;
        if (!proposalId || linked.has(proposalId)) return;
        button.disabled = true;
        const result = await supabase.rpc('create_israa_tracking_from_proposal', { p_proposal_id: proposalId });
        if (result.error) {
          content.querySelector('[data-v2-picker-error]').textContent = result.error.message || 'שגיאה בקישור ההצעה';
          button.disabled = false;
          return;
        }
        await loadData(true);
        const container = document.querySelector(`[${CONTAINER_ATTR}]`);
        if (container) renderContainer(container);
        ui.closeDrawer();
        toast('הצעת המחיר נוספה למעקב.');
      });
    },
    onClose: () => document.querySelector('.ds-drawer--israa-exact')?.classList.remove('ds-drawer--israa-exact'),
  });
}

function valueField(label, value, className = '', linkType = '') {
  const normalized = clean(value);
  if (!normalized) return '';
  let rendered = escapeHtml(normalized);
  if (normalized && linkType === 'tel') rendered = `<a class="israa-drawer__value" href="tel:${escapeHtml(normalized)}">${escapeHtml(normalized)}</a>`;
  if (normalized && linkType === 'email') rendered = `<a class="israa-drawer__value" href="mailto:${escapeHtml(normalized)}">${escapeHtml(normalized)}</a>`;
  return `<div class="israa-drawer__field ${className}"><span class="israa-drawer__label">${escapeHtml(label)}</span><div class="israa-drawer__value">${rendered}</div></div>`;
}

function inputField(label, key, value, type = 'text', className = '') {
  let control;
  if (type === 'textarea') {
    control = `<textarea class="israa-v2__textarea" data-v2-field="${key}">${escapeHtml(value ?? '')}</textarea>`;
  } else if (type === 'status') {
    control = `<select class="israa-v2__select" data-v2-field="${key}">${STATUS_OPTIONS.map((option) => `<option${clean(value) === option ? ' selected' : ''}>${option}</option>`).join('')}</select>`;
  } else if (type === 'nature') {
    control = `<select class="israa-v2__select" data-v2-field="${key}">${NATURE_OPTIONS.map((option) => `<option${clean(value || NATURE_OPTIONS[0]) === option ? ' selected' : ''}>${option}</option>`).join('')}</select>`;
  } else if (type === 'probability') {
    control = `<select class="israa-v2__select" data-v2-field="${key}">${PROBABILITY_OPTIONS.map((option) => `<option value="${option}"${Number(value || 50) === option ? ' selected' : ''}>${option}%</option>`).join('')}</select>`;
  } else {
    control = `<input class="israa-v2__input" data-v2-field="${key}" type="${type}" value="${escapeHtml(value ?? '')}"${key === 'program_name' ? ' list="israa-v2-course-options" data-v2-program-input' : ''}>`;
  }
  return `<label class="israa-drawer__field ${className}"><span class="israa-drawer__label">${escapeHtml(label)}</span>${control}</label>`;
}

function expectedProgramField(draft) {
  const options = [...new Set((Array.isArray(draft?.proposal_items) ? draft.proposal_items : []).map((item) => clean(item?.program_name)).filter(Boolean))];
  const selected = new Set(clean(draft.expected_program).split('|').map(clean).filter((name) => options.includes(name)));
  const controls = options.length
    ? options.map((name) => `<label class="israa-v2__multi-option"><input type="checkbox" data-v2-expected-option value="${escapeHtml(name)}"${selected.has(name) ? ' checked' : ''}> <span>${escapeHtml(name)}</span></label>`).join('')
    : '';
  const tags = [...selected].map((name) => `<span class="israa-drawer__tag">${escapeHtml(name)}<button type="button" class="israa-drawer__tag-remove" data-v2-remove-expected="${escapeHtml(name)}" aria-label="הסרת ${escapeHtml(name)}">×</button></span>`).join('');
  return `<div class="israa-drawer__field israa-drawer__field--wide israa-v2__multi"><span class="israa-drawer__label">התוכנית הצפויה / בחירה נדרשת</span>${options.length ? `<div class="israa-v2__multi-control"><div class="israa-drawer__tags" data-v2-expected-tags>${tags}</div><button type="button" class="israa-v2__multi-toggle" data-v2-multi-toggle aria-expanded="false">בחירת תוכניות <span aria-hidden="true">⌄</span></button></div><div class="israa-v2__multi-menu" data-v2-multi-menu hidden>${controls}</div>` : '<span class="israa-drawer__value">לא נמצאו פעילויות לבחירה</span>'}<input type="hidden" data-v2-field="expected_program" value="${escapeHtml([...selected].join(' | '))}"></div>`;
}

function tagsField(label, value, className = '') {
  const values = clean(value).split('|').map(clean).filter(Boolean);
  if (!values.length) return '';
  return `<div class="israa-drawer__field ${className}"><span class="israa-drawer__label">${escapeHtml(label)}</span><div class="israa-drawer__tags">${values.map((item) => `<span class="israa-drawer__tag">${escapeHtml(item)}</span>`).join('')}</div></div>`;
}

function readonlyField(label, value, className = '') {
  return `<div class="israa-drawer__field ${className}"><span class="israa-drawer__label">${escapeHtml(label)}</span><div class="israa-drawer__value israa-drawer__readonly">${escapeHtml(clean(value) || '—')}</div></div>`;
}

function section(title, fields, className = '') {
  return `<section class="israa-drawer__section ${className}"><h3 class="israa-drawer__section-title">${escapeHtml(title)}</h3>${fields}</section>`;
}

function viewDrawerFields(draft, serial) {
  const contact = [
    valueField('בעלות', draft.ownership, 'israa-drawer__field--wide'),
    valueField('איש קשר', draft.contact_person || draft.manager_name),
    valueField('תפקיד', draft.contact_role),
    valueField('טלפון', draft.phone || draft.manager_phone, '', 'tel'),
    valueField('דוא״ל', draft.email || draft.manager_email, '', 'email'),
  ].join('');
  const proposal = valueField('תאריך הצעה', draft.proposal_date ? formatDate(draft.proposal_date) : '') + (clean(draft.proposal_nature) ? `<div class="israa-drawer__field"><span class="israa-drawer__label">מבנה ההצעה</span><span class="israa-drawer__tag">${escapeHtml(clean(draft.proposal_nature))}</span></div>` : '');
  const planning = [tagsField('התוכנית הצפויה', draft.expected_program, 'israa-drawer__field--wide'), valueField('שכבה', draft.grade), valueField('קבוצות / משתתפים', draft.participants_groups)].join('');
  const hasActivities = (Array.isArray(draft.proposal_items) && draft.proposal_items.length) || clean(draft.program_name) || clean(draft.gefen_numbers);
  return (contact ? section('איש קשר והתקשרות', `<div class="israa-drawer__grid">${contact}</div>`) : '')
    + (proposal ? section('פרטים נוספים מהצעת המחיר', `<div class="israa-drawer__compact-row">${proposal}</div>`) : '')
    + (hasActivities ? section('הפעילויות הכלולות בהצעה', activitiesTable(draft), 'israa-drawer__section--activities') : '')
    + (planning ? section('בחירה והיקף צפויים', `<div class="israa-drawer__grid">${planning}</div>`, 'israa-drawer__section--multi') : '')
    + (clean(draft.notes) ? section('הערה', valueField('הערה', draft.notes, 'israa-drawer__field--wide')) : '');
}

function editDrawerFields(draft, serial) {
  const contact = [(clean(draft.ownership) ? readonlyField('בעלות', draft.ownership, 'israa-drawer__field--wide') : ''), readonlyField('איש קשר', draft.contact_person || draft.manager_name), readonlyField('תפקיד', draft.contact_role), readonlyField('טלפון', draft.phone || draft.manager_phone), readonlyField('דוא״ל', draft.email || draft.manager_email)].join('');
  const proposal = readonlyField('תאריך הצעה', formatDate(draft.proposal_date));
  const planning = [
    inputField('מבנה ההצעה', 'proposal_nature', draft.proposal_nature, 'nature'),
    expectedProgramField(draft),
    inputField('שכבה', 'grade', draft.grade, 'text', 'israa-drawer__field--short'),
    inputField('קבוצות / משתתפים', 'participants_groups', draft.participants_groups),
  ].join('');
  const closing = [
    inputField('הערכת סגירה (%)', 'probability', draft.probability, 'probability'),
    readonlyField('תחזית כספית', formatMoney(realisticValue(draft)), 'israa-drawer__realistic'),
    inputField('סטטוס', 'status', draft.status, 'status'),
  ].join('');
  const followup = [inputField('פעולה להמשך', 'next_action', draft.next_action, 'textarea', 'israa-drawer__field--wide'), inputField('תאריך מעקב', 'follow_up_date', draft.follow_up_date, 'date')].join('');
  return section('פרטי קשר', `<div class="israa-drawer__grid">${contact}</div>`)
    + section('תאריך ההצעה', `<div class="israa-drawer__grid">${proposal}</div>`)
    + section('הפעילויות הכלולות בהצעה', activitiesTable(draft), 'israa-drawer__section--activities')
    + section('בחירה והיקף צפויים', `<div class="israa-drawer__grid">${planning}</div>`, 'israa-drawer__section--multi')
    + section('הערכת סגירה ומעקב', `<div class="israa-drawer__grid">${closing}${followup}</div>`)
    + section('הערה', inputField('הערה', 'notes', draft.notes, 'textarea', 'israa-drawer__field--wide'));
}

function drawerContent(row, mode) {
  const editing = mode === 'edit';
  const draft = row || { proposal_nature: NATURE_OPTIONS[0], probability: 50, status: 'טיוטה' };
  const serial = row ? rows.findIndex((item) => String(item.id) === String(row.id)) + 1 : null;
  const buttons = editing
    ? `<button type="button" class="israa-v2__btn" data-v2-drawer-cancel>ביטול</button><button type="submit" class="israa-v2__btn israa-v2__btn--primary" data-v2-drawer-save>שמירה</button>`
    : `<button type="button" class="israa-v2__btn israa-v2__btn--primary" data-v2-drawer-edit>עריכה</button>`;
  const fields = editing ? editDrawerFields(draft, serial) : viewDrawerFields(draft, serial);
  const title = `${clean(draft.school_name) || 'בית ספר'} | הצעה מספר ${clean(draft.quote_number) || '—'}`;
  return `<form class="israa-drawer__form" data-v2-drawer-form data-v2-editor="${escapeHtml(draft.id)}"><div class="israa-drawer"><header class="israa-drawer__header"><div class="israa-drawer__title-wrap"><h2 class="israa-drawer__title">${escapeHtml(title)}</h2></div><div class="israa-drawer__header-actions">${buttons}<button type="button" class="israa-drawer__close" data-ui-close-drawer aria-label="סגירה">✕</button></div></header><div class="israa-drawer__body">${fields}<div class="israa-drawer__error" data-v2-drawer-error></div></div></div></form>`;
}

function openDrawer(row, mode = 'view') {
  const requestedId = row?.id || null;
  openRowId = requestedId;
  drawerMode = mode;
  ui.openDrawer({
    title: '',
    content: drawerContent(row, mode),
    onClose: () => {
      document.querySelector('.ds-drawer--israa-exact')?.classList.remove('ds-drawer--israa-exact', 'ds-drawer--israa-detail');
      openRowId = null;
      drawerMode = 'view';
    },
    onOpen: (content) => {
      openRowId = requestedId;
      drawerMode = mode;
      content.closest('.ds-drawer')?.classList.add('ds-drawer--israa-exact', 'ds-drawer--israa-detail');
      bindDrawer(content);
    },
  });
}

function collectDrawer(form) {
  const expected = [...form.querySelectorAll('[data-v2-expected-option]:checked')].map((field) => clean(field.value));
  const expectedField = form.querySelector('[data-v2-field="expected_program"]');
  if (expectedField) expectedField.value = expected.join(' | ');
  const payload = {};
  form.querySelectorAll('[data-v2-field]').forEach((field) => { payload[field.dataset.v2Field] = field.value; });
  payload.probability = PROBABILITY_OPTIONS.includes(Number(payload.probability)) ? Number(payload.probability) : 50;
  payload.follow_up_date = payload.follow_up_date || null;
  payload.updated_at = new Date().toISOString();
  return payload;
}

async function saveDrawer(form, button) {
  button.disabled = true;
  const payload = collectDrawer(form);
  try {
    const query = supabase.from('israa_program_tracking').update(payload).eq('id', openRowId);
    const { data, error } = await query.select('*').single();
    if (error) throw error;
    rows = rows.map((row) => row.id === data.id ? data : row);
    openRowId = data.id;
    drawerMode = 'view';
    clearScreenDataCache();
    const container = document.querySelector(`[${CONTAINER_ATTR}]`);
    if (container) renderContainer(container);
    openDrawer(data, 'view');
    toast('ההצעה נשמרה.');
  } catch (error) {
    console.error('[israa-tracking-v2-save]', error);
    const node = form.querySelector('[data-v2-drawer-error]');
    if (node) node.textContent = error?.message || 'שגיאה בשמירה';
    button.disabled = false;
  }
}

async function deleteRow(row) {
  if (!row || !window.confirm('למחוק את ההצעה הזו?')) return;
  const { error } = await supabase.from('israa_program_tracking').delete().eq('id', row.id);
  if (error) {
    toast(error.message || 'שגיאה במחיקה', 'error');
    return;
  }
  rows = rows.filter((item) => item.id !== row.id);
  clearScreenDataCache();
  ui.closeDrawer();
  const container = document.querySelector(`[${CONTAINER_ATTR}]`);
  if (container) renderContainer(container);
  toast('ההצעה נמחקה.');
}

function bindDrawer(content) {
  if (!multiSelectOutsideClickBound) {
    document.addEventListener('click', (event) => {
      document.querySelectorAll('.israa-v2__multi [data-v2-multi-menu]:not([hidden])').forEach((menu) => {
        const wrapper = menu.closest('.israa-v2__multi');
        if (wrapper?.contains(event.target)) return;
        menu.hidden = true;
        wrapper?.querySelector('[data-v2-multi-toggle]')?.setAttribute('aria-expanded', 'false');
      });
    });
    multiSelectOutsideClickBound = true;
  }
  content.addEventListener('click', async (event) => {
    const toggle = event.target.closest('[data-v2-multi-toggle]');
    if (toggle) {
      event.preventDefault();
      event.stopPropagation();
      const wrapper = toggle.closest('.israa-v2__multi');
      const menu = wrapper?.querySelector('[data-v2-multi-menu]');
      if (!menu) return;
      const willOpen = menu.hidden;
      menu.hidden = !willOpen;
      toggle.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) {
        requestAnimationFrame(() => {
          menu.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
      }
      return;
    }
    const remove = event.target.closest('[data-v2-remove-expected]');
    if (remove) {
      event.preventDefault();
      event.stopPropagation();
      const wrapper = remove.closest('.israa-v2__multi');
      const option = [...(wrapper?.querySelectorAll('[data-v2-expected-option]') || [])].find((node) => clean(node.value) === clean(remove.dataset.v2RemoveExpected));
      if (option) {
        option.checked = false;
        option.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }
    if (event.target.closest('[data-v2-drawer-edit]')) {
      openDrawer(rows.find((row) => row.id === openRowId), 'edit');
      return;
    }
    if (event.target.closest('[data-v2-drawer-cancel]')) {
      if (drawerMode === 'create') ui.closeDrawer();
      else openDrawer(rows.find((row) => row.id === openRowId), 'view');
      return;
    }
    if (event.target.closest('[data-v2-drawer-delete]')) await deleteRow(rows.find((row) => row.id === openRowId));
  });
  content.querySelector('[data-v2-drawer-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveDrawer(event.currentTarget, event.submitter || event.currentTarget.querySelector('[data-v2-drawer-save]'));
  });
  content.addEventListener('change', (event) => {
    if (event.target.matches('[data-v2-expected-option]')) {
      const wrapper = event.target.closest('.israa-v2__multi');
      const selected = [...(wrapper?.querySelectorAll('[data-v2-expected-option]:checked') || [])].map((node) => clean(node.value));
      const tags = wrapper?.querySelector('[data-v2-expected-tags]');
      const hidden = wrapper?.querySelector('[data-v2-field="expected_program"]');
      if (hidden) hidden.value = selected.join(' | ');
      if (tags) tags.innerHTML = selected.length
        ? selected.map((name) => `<span class="israa-drawer__tag">${escapeHtml(name)}<button type="button" class="israa-drawer__tag-remove" data-v2-remove-expected="${escapeHtml(name)}" aria-label="הסרת ${escapeHtml(name)}">×</button></span>`).join('')
        : '';
      return;
    }
    const probability = event.target.closest('[data-v2-field="probability"]');
    if (probability) {
      const row = rows.find((item) => item.id === openRowId);
      const target = content.querySelector('.israa-drawer__realistic .israa-drawer__readonly');
      if (target) target.innerHTML = escapeHtml(formatMoney((numberValue(row?.total_amount) || 0) * Number(probability.value) / 100));
      return;
    }
  });
}

function exportExcel(container) {
  try {
    const visibleIds = new Set([...container.querySelectorAll('.israa-v2__row[data-v2-row-id]:not([hidden])')].map((node) => node.dataset.v2RowId));
    exportIsraaWorkbook(rows.filter((row) => visibleIds.has(String(row.id))));
    toast('קובץ Excel נוצר בהצלחה.');
  } catch (error) {
    console.error('[israa-tracking-v2-export]', error);
    toast(error?.message || 'לא ניתן ליצור את קובץ ה-Excel.', 'error');
  }
}

function bindContainer(container) {
  if (container.dataset.bound === 'true') return;
  container.dataset.bound = 'true';
  container.addEventListener('click', async (event) => {
    if (event.target.closest('[data-v2-add]')) return openProposalPicker();
    if (event.target.closest('[data-v2-export]')) return exportExcel(container);
    const rowElement = event.target.closest('[data-v2-open]');
    if (rowElement && !event.target.closest('button,a,input,select,textarea')) {
      openDrawer(rows.find((row) => String(row.id) === String(rowElement.dataset.v2Open)));
    }
  });
  container.addEventListener('keydown', (event) => {
    const row = event.target.closest('[data-v2-open]');
    if (row && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openDrawer(rows.find((item) => String(item.id) === row.dataset.v2Open));
    }
  });
}

async function enhance(forceReload = false) {
  if (running) return;
  running = true;
  try {
    injectStyles();
    const mgmt = document.querySelector(`#app ${ROOT_SELECTOR}`);
    if (!mgmt || !canUseScreen()) return;
    const active = mgmt.querySelector('[data-israa-tab].is-active');
    if (active && clean(active.dataset.israaTab) !== 'table') {
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

function schedule(force = false) {
  clearTimeout(timer);
  timer = setTimeout(() => enhance(force).catch((error) => console.error('[israa-tracking-v2]', error)), 90);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => schedule(), { once: true });
else schedule();
new MutationObserver(() => schedule()).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('hashchange', () => schedule());
window.addEventListener('israa-tracking-updated', () => { loaded = false; schedule(true); });
