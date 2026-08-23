import { state } from './state.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import { escapeHtml } from './screens/shared/html.js';

const STYLE_ID = 'admin-data-tool-styles';
const TOOL_ATTR = 'data-admin-data-tool';
const PAGE_ATTR = 'data-admin-data-page';
const SCHOOL_YEAR_FROM = '2026-09-01';
const SCHOOL_YEAR_TO = '2027-08-31';
const ALERT_START_FROM = '2026-09-01';
const ALERT_START_TO = '2026-12-20';
const ALERT_END_AFTER = '2027-01-31';
const ACTIVE_STATUSES = new Set(['פתוח', 'סגור']);
const DISTRICTS = ['צפון', 'מרכז', 'דרום'];
const PAGE_SIZE = 1000;

function iconSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-7M22 19V3"/><path d="M2 19h21"/></svg>`;
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .admin-data-page{width:min(100%,1180px);margin-inline:auto;direction:rtl;color:var(--color-text,#172033)}
    .admin-data-page__top{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px}
    .admin-data-page__title h1{margin:0 0 5px;font-size:26px;line-height:1.2;font-weight:850}.admin-data-page__title p{margin:0;color:var(--color-text-secondary,#64748b);font-size:13px}
    .admin-data-back{appearance:none;border:0;background:transparent;color:var(--color-primary,#2563eb);font:inherit;font-weight:750;cursor:pointer;padding:5px 0;white-space:nowrap}
    .admin-data-back:hover{text-decoration:underline}.admin-data-back:focus-visible{outline:2px solid var(--color-primary,#2563eb);outline-offset:3px}
    .admin-data-filters{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;padding:13px 0 16px;border-top:1px solid var(--color-border,#dbe3ec);border-bottom:1px solid var(--color-border,#dbe3ec)}
    .admin-data-filter-divider{align-self:stretch;width:1px;min-height:36px;background:var(--color-border,#dbe3ec);margin:0 4px}.admin-data-filter-label{align-self:center;color:var(--color-text-secondary,#64748b);font-size:12px;font-weight:750;white-space:nowrap}
    .admin-data-field{display:flex;flex-direction:column;gap:5px}.admin-data-field label{font-size:12px;font-weight:750;color:var(--color-text-secondary,#64748b)}
    .admin-data-field input{width:150px;height:36px;box-sizing:border-box;border:1px solid var(--color-border,#cbd5e1);border-radius:7px;background:var(--color-surface,#fff);color:var(--color-text,#172033);padding:0 9px;font:inherit;font-size:13px}
    .admin-data-field input:focus{outline:2px solid color-mix(in srgb,var(--color-primary,#2563eb) 24%,transparent);border-color:var(--color-primary,#2563eb)}
    .admin-data-show,.admin-data-show-all{height:36px;border-radius:7px;padding:0 17px;font:inherit;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap}
    .admin-data-show{border:1px solid var(--color-primary,#2563eb);background:var(--color-primary,#2563eb);color:#fff}.admin-data-show-all{border:1px solid var(--color-primary,#2563eb);background:var(--color-surface,#fff);color:var(--color-primary,#2563eb)}
    .admin-data-show:hover,.admin-data-show-all:hover{filter:brightness(.98)}.admin-data-show:disabled,.admin-data-show-all:disabled{opacity:.6;cursor:wait}
    .admin-data-message{padding:24px 0;color:var(--color-text-secondary,#64748b);font-size:13px}.admin-data-error{color:#b42318;font-weight:700}
    .admin-data-summary{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin:17px 0 12px;font-size:13px}.admin-data-summary strong{font-size:15px}.admin-data-summary span{color:var(--color-text-secondary,#64748b)}.admin-data-summary__scope{font-weight:750}
    .admin-data-alert{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 0;margin:6px 0 18px;border-top:1px solid #f1c56b;border-bottom:1px solid #f1c56b;font-size:13px}.admin-data-alert[hidden]{display:none}.admin-data-alert button{appearance:none;border:0;background:transparent;color:var(--color-primary,#2563eb);font:inherit;font-weight:800;cursor:pointer;padding:3px 0;white-space:nowrap}
    .admin-data-section{margin-top:22px}.admin-data-section--funding{margin-top:32px;padding-top:25px;border-top:2px solid color-mix(in srgb,var(--color-primary,#1698b8) 35%,var(--color-border,#dbe3ec))}.admin-data-section__title{margin:0 0 10px;font-size:17px;font-weight:850}.admin-data-section__hint{margin:-5px 0 10px;color:var(--color-text-secondary,#64748b);font-size:12px}
    .admin-data-district-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;align-items:start}.admin-data-district{min-width:0;padding:0 16px}.admin-data-district:first-child{padding-inline-start:0}.admin-data-district:last-child{padding-inline-end:0}.admin-data-district+ .admin-data-district{border-inline-start:1px solid color-mix(in srgb,var(--color-primary,#1698b8) 22%,var(--color-border,#dbe3ec))}.admin-data-district h3{margin:0 0 7px;font-size:14px;font-weight:850}
    .admin-data-table-wrap{width:100%;overflow:auto;border:1px solid var(--color-border,#dbe3ec);border-radius:8px;background:var(--color-surface,#fff)}
    .admin-data-table-wrap--funding{width:min(100%,690px)}
    .admin-data-table{width:100%;border-collapse:collapse;table-layout:auto;font-size:12.5px}.admin-data-table th,.admin-data-table td{padding:8px 10px;border-bottom:1px solid var(--color-border,#e5e7eb);vertical-align:middle}.admin-data-table tr:last-child td{border-bottom:0}.admin-data-table th{background:var(--color-surface-muted,#f8fafc);font-size:11.5px;font-weight:850;color:var(--color-text-secondary,#475569);white-space:nowrap}.admin-data-table th:first-child,.admin-data-table td:first-child{text-align:right}.admin-data-table th:not(:first-child),.admin-data-table td:not(:first-child){text-align:center;white-space:nowrap;width:82px}.admin-data-table tfoot td{font-weight:850;background:var(--color-surface-muted,#f8fafc)}
    .admin-data-row-action{cursor:pointer}.admin-data-row-action:hover{background:color-mix(in srgb,var(--color-primary,#2563eb) 5%,transparent)}.admin-data-row-action:focus-visible{outline:2px solid var(--color-primary,#2563eb);outline-offset:-2px}.admin-data-empty-row{color:var(--color-text-secondary,#94a3b8);text-align:center!important}
    .admin-data-unassigned{margin-top:10px;color:#9a6700;font-size:12px}
    .admin-data-drawer-backdrop{position:fixed;inset:0;z-index:9998;background:rgba(15,23,42,.24)}
    .admin-data-drawer{position:fixed;z-index:9999;inset-block:0;right:0;width:min(440px,92vw);background:var(--color-surface,#fff);border-left:1px solid var(--color-border,#dbe3ec);box-shadow:-12px 0 32px rgba(15,23,42,.12);display:flex;flex-direction:column;direction:rtl}
    .admin-data-drawer__head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 18px 13px;border-bottom:1px solid var(--color-border,#e5e7eb)}.admin-data-drawer__head h2{margin:0 0 4px;font-size:19px}.admin-data-drawer__head p{margin:0;color:var(--color-text-secondary,#64748b);font-size:12px}.admin-data-drawer__close{appearance:none;border:0;background:transparent;color:var(--color-text-secondary,#64748b);font-size:25px;line-height:1;cursor:pointer;padding:0 2px}
    .admin-data-drawer__body{padding:14px 18px 24px;overflow:auto}.admin-data-drawer .admin-data-table{font-size:12px}
    @media(max-width:900px){.admin-data-district-grid{grid-template-columns:1fr;gap:18px}.admin-data-district{width:min(100%,620px);padding:0!important;border-inline-start:0!important}.admin-data-district+ .admin-data-district{padding-top:18px!important;border-top:1px solid var(--color-border,#dbe3ec)}}
    @media(max-width:620px){.admin-data-page__top{align-items:center}.admin-data-page__title h1{font-size:23px}.admin-data-filter-divider{display:none}.admin-data-filter-label{flex-basis:100%;margin-top:4px}.admin-data-field{flex:1 1 135px}.admin-data-field input{width:100%}.admin-data-show,.admin-data-show-all{flex:1 1 140px}.admin-data-table th,.admin-data-table td{padding:7px 8px}}
  `;
  document.head.appendChild(style);
}

function isAdminHome() {
  return String(state?.route || '') === 'admin-home' && !!document.querySelector('.admin-management-grid');
}

function buildTile() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'admin-management-tile';
  button.dataset.capabilityId = 'admin.data';
  button.setAttribute(TOOL_ATTR, 'true');
  button.innerHTML = `
    <span class="admin-management-tile__icon">${iconSvg()}</span>
    <span class="admin-management-tile__content"><strong>נתונים</strong><small>סיכומי פעילות, מחוזות ומימון</small></span>
    <span class="admin-management-tile__arrow" aria-hidden="true">‹</span>`;
  button.addEventListener('click', openDataPage);
  return button;
}

function attachTile() {
  if (!isAdminHome()) return;
  const grid = document.querySelector('.admin-management-grid');
  if (!grid || grid.querySelector(`[${TOOL_ATTR}]`)) return;
  grid.appendChild(buildTile());
}

function pageHtml() {
  return `
    <section class="admin-data-page" ${PAGE_ATTR}="true" aria-label="נתונים">
      <div class="admin-data-page__top">
        <div class="admin-data-page__title"><h1>נתונים</h1><p>סיכום פעילויות שנת 2027 — תצוגה שנתית מלאה או סינון לפי טווח תאריכים</p></div>
        <button type="button" class="admin-data-back" data-admin-data-back>חזרה לניהול</button>
      </div>
      <div class="admin-data-filters" role="group" aria-label="הצגת נתוני שנת 2027">
        <button type="button" class="admin-data-show-all" data-admin-data-show-all>הצג הכל</button>
        <span class="admin-data-filter-divider" aria-hidden="true"></span>
        <span class="admin-data-filter-label">סינון לפי טווח תאריכים</span>
        <div class="admin-data-field"><label for="adminDataFrom">מתאריך</label><input id="adminDataFrom" data-admin-data-from type="date" min="${SCHOOL_YEAR_FROM}" max="${SCHOOL_YEAR_TO}" value=""></div>
        <div class="admin-data-field"><label for="adminDataTo">עד תאריך</label><input id="adminDataTo" data-admin-data-to type="date" min="${SCHOOL_YEAR_FROM}" max="${SCHOOL_YEAR_TO}" value=""></div>
        <button type="button" class="admin-data-show" data-admin-data-show>סנן לפי תאריכים</button>
      </div>
      <div data-admin-data-results><div class="admin-data-message">לחצו על „הצג הכל” להצגת כל פעילויות שנת 2027, כולל פעילויות ללא תאריך, או בחרו טווח תאריכים לסינון ממוקד.</div></div>
    </section>`;
}

function openDataPage() {
  ensureStyles();
  const home = document.querySelector('.admin-management-home');
  if (!home) return;
  const host = home.parentElement || home;
  const existing = host.querySelector(`[${PAGE_ATTR}]`);
  if (existing) return;
  home.hidden = true;
  host.insertAdjacentHTML('beforeend', pageHtml());
  const page = host.querySelector(`[${PAGE_ATTR}]`);
  page?.querySelector('[data-admin-data-back]')?.addEventListener('click', closeDataPage);
  page?.querySelector('[data-admin-data-show-all]')?.addEventListener('click', () => loadAndRender(page, { mode: 'all' }));
  page?.querySelector('[data-admin-data-show]')?.addEventListener('click', () => loadAndRender(page, { mode: 'range' }));
}

function closeDataPage() {
  closeDrawer();
  document.querySelector(`[${PAGE_ATTR}]`)?.remove();
  const home = document.querySelector('.admin-management-home');
  if (home) home.hidden = false;
}

async function fetchPaged(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw error;
    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchSourceData() {
  if (!supabase) throw new Error('Supabase client is not configured');
  await waitForSupabaseAuthSession({ timeoutMs: 7000 });
  const [activities, splits, sources] = await Promise.all([
    fetchPaged(() => supabase
      .from('activities')
      .select('id,activity_name,name,title,program_name,gefen_number,price,funding,start_date,end_date,status,district,school,authority,activity_season,activity_type,activity_manager')
      .eq('activity_season', 'school_2027')
      .in('status', ['פתוח', 'סגור'])
      .order('id', { ascending: true })),
    fetchPaged(() => supabase
      .from('activity_funding_sources')
      .select('activity_id,funding_source_id,amount')
      .order('activity_id', { ascending: true })),
    fetchPaged(() => supabase
      .from('funding_sources')
      .select('id,name')
      .order('sort_order', { ascending: true }))
  ]);
  return { activities, splits, sources };
}

function dateInRange(date, from, to) {
  return !!date && date >= from && date <= to;
}

function overlapsRange(activity, from, to) {
  const start = String(activity?.start_date || '').slice(0, 10);
  if (!start) return false;
  const end = String(activity?.end_date || start).slice(0, 10) || start;
  return start <= to && end >= from;
}

function validMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(value) {
  return `${new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(validMoney(value))} ₪`;
}

function formatQty(value) {
  return new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function formatDate(value) {
  const raw = String(value || '').slice(0, 10);
  const parts = raw.split('-');
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : raw;
}

function normalizeDistrict(value) {
  const text = String(value || '').trim();
  return DISTRICTS.find((district) => text.includes(district)) || '';
}

function activityLabel(activity) {
  const name = String(activity?.program_name || activity?.activity_name || activity?.name || activity?.title || 'ללא שם פעילות').trim();
  const gefen = String(activity?.gefen_number || '').trim();
  return gefen && !name.includes(gefen) ? `${name} ${gefen}` : name;
}

function parseFundingText(value) {
  return String(value || '')
    .split(/\s*\+\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildFundingIndex(splits) {
  const map = new Map();
  for (const split of splits || []) {
    const id = String(split?.activity_id ?? '');
    if (!id) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(split);
  }
  return map;
}

function uniqueFundingParts(activity, splitRows, sourceNames) {
  const byName = new Map();
  for (const row of splitRows || []) {
    const name = String(sourceNames.get(String(row?.funding_source_id || '')) || '').trim();
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, { source: name, hasAmount: false, amount: 0 });
    const item = byName.get(name);
    if (row?.amount !== null && row?.amount !== undefined && row?.amount !== '') {
      item.hasAmount = true;
      item.amount += validMoney(row.amount);
    }
  }
  if (byName.size) return [...byName.values()];
  const fallback = parseFundingText(activity?.funding);
  return [...new Set(fallback.length ? fallback : ['לא צוין'])].map((source) => ({ source, hasAmount: false, amount: 0 }));
}

function allocateFunding(activity, splitRows, sourceNames) {
  const parts = uniqueFundingParts(activity, splitRows, sourceNames);
  const count = Math.max(1, parts.length);
  const qty = 1 / count;
  const price = validMoney(activity?.price);
  let amounts = [];

  if (count === 1) {
    amounts = [price];
  } else {
    const known = parts.filter((part) => part.hasAmount);
    const knownTotal = known.reduce((sum, part) => sum + part.amount, 0);
    const missingCount = count - known.length;
    if (known.length === count && knownTotal > 0) {
      const factor = price > 0 ? price / knownTotal : 1;
      amounts = parts.map((part) => part.amount * factor);
    } else if (known.length > 0 && knownTotal <= price && missingCount > 0) {
      const remainderEach = (price - knownTotal) / missingCount;
      amounts = parts.map((part) => part.hasAmount ? part.amount : remainderEach);
    } else {
      amounts = parts.map(() => price / count);
    }
  }

  return parts.map((part, index) => ({
    source: part.source,
    quantity: qty,
    amount: validMoney(amounts[index]),
    activity
  }));
}

function aggregateByActivityAndDistrict(activities) {
  const districts = new Map(DISTRICTS.map((district) => [district, new Map()]));
  let unassignedCount = 0;
  let unassignedAmount = 0;
  for (const activity of activities) {
    const district = normalizeDistrict(activity?.district);
    if (!district) {
      unassignedCount += 1;
      unassignedAmount += validMoney(activity?.price);
      continue;
    }
    const label = activityLabel(activity);
    const map = districts.get(district);
    const row = map.get(label) || { label, quantity: 0, amount: 0 };
    row.quantity += 1;
    row.amount += validMoney(activity?.price);
    map.set(label, row);
  }
  return { districts, unassignedCount, unassignedAmount };
}

function aggregateFunding(activities, splits, sources) {
  const sourceNames = new Map((sources || []).map((source) => [String(source?.id || ''), String(source?.name || '').trim()]));
  const splitIndex = buildFundingIndex(splits);
  const rows = new Map();
  const contributions = [];
  for (const activity of activities) {
    const allocations = allocateFunding(activity, splitIndex.get(String(activity?.id ?? '')) || [], sourceNames);
    for (const allocation of allocations) {
      contributions.push(allocation);
      const key = allocation.source;
      const row = rows.get(key) || { label: key, quantity: 0, amount: 0 };
      row.quantity += allocation.quantity;
      row.amount += allocation.amount;
      rows.set(key, row);
    }
  }
  return { rows: [...rows.values()].sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, 'he')), contributions };
}

function totalFor(rows) {
  return [...rows].reduce((acc, row) => ({ quantity: acc.quantity + row.quantity, amount: acc.amount + row.amount }), { quantity: 0, amount: 0 });
}

function tableHtml(rows, { clickable = false, emptyText = 'אין נתונים', firstHeader = '' } = {}) {
  const list = [...rows];
  const total = totalFor(list);
  return `
    <div class="admin-data-table-wrap${clickable ? ' admin-data-table-wrap--funding' : ''}">
      <table class="admin-data-table">
        <thead><tr><th>${escapeHtml(firstHeader || (clickable ? 'גורם מימון' : 'שם הפעילות'))}</th><th>כמות</th><th>סה״כ</th></tr></thead>
        <tbody>
          ${list.length ? list.map((row) => `<tr${clickable ? ` class="admin-data-row-action" tabindex="0" data-funding-source="${escapeHtml(row.label)}"` : ''}><td>${escapeHtml(row.label)}</td><td>${formatQty(row.quantity)}</td><td>${formatMoney(row.amount)}</td></tr>`).join('') : `<tr><td colspan="3" class="admin-data-empty-row">${escapeHtml(emptyText)}</td></tr>`}
        </tbody>
        <tfoot><tr><td>סה״כ</td><td>${formatQty(total.quantity)}</td><td>${formatMoney(total.amount)}</td></tr></tfoot>
      </table>
    </div>`;
}

function resultsHtml(filtered, districtAgg, fundingAgg, alertRows, scopeLabel = '') {
  const grandTotal = filtered.reduce((sum, activity) => sum + validMoney(activity?.price), 0);
  return `
    <div class="admin-data-summary"><strong>סה״כ ${formatQty(filtered.length)} קורסים</strong><span>${formatMoney(grandTotal)}</span>${scopeLabel ? `<span class="admin-data-summary__scope">${escapeHtml(scopeLabel)}</span>` : ''}</div>
    <div class="admin-data-alert" data-admin-data-alert ${alertRows.length ? '' : 'hidden'}>
      <span>לתשומת לבך: נמצאו <strong>${formatQty(alertRows.length)}</strong> קורסים שהחלו בין 1.9.2026–20.12.2026 ומסתיימים אחרי 31.1.2027.</span>
      <button type="button" data-admin-data-alert-open>הצג קורסים</button>
    </div>
    <section class="admin-data-section admin-data-section--districts">
      <h2 class="admin-data-section__title">לפי פעילות ומחוז</h2>
      <div class="admin-data-district-grid">
        ${DISTRICTS.map((district) => {
          const rows = [...districtAgg.districts.get(district).values()].sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label, 'he'));
          return `<div class="admin-data-district"><h3>מחוז ${district}</h3>${tableHtml(rows)}</div>`;
        }).join('')}
      </div>
      ${districtAgg.unassignedCount ? `<div class="admin-data-unassigned">${formatQty(districtAgg.unassignedCount)} קורסים ללא מחוז משויך (${formatMoney(districtAgg.unassignedAmount)}) אינם נכללים בשלוש טבלאות המחוז.</div>` : ''}
    </section>
    <section class="admin-data-section admin-data-section--funding">
      <h2 class="admin-data-section__title">לפי גורם מימון</h2>
      <p class="admin-data-section__hint">לחיצה על שורה פותחת את פירוט בתי הספר או הרשויות שנכללו בסכום.</p>
      ${tableHtml(fundingAgg.rows, { clickable: true })}
    </section>`;
}

function setLoading(page, active, mode = '') {
  const rangeButton = page.querySelector('[data-admin-data-show]');
  const allButton = page.querySelector('[data-admin-data-show-all]');
  if (rangeButton) {
    rangeButton.disabled = active;
    rangeButton.textContent = active && mode === 'range' ? 'טוען…' : 'סנן לפי תאריכים';
  }
  if (allButton) {
    allButton.disabled = active;
    allButton.textContent = active && mode === 'all' ? 'טוען…' : 'הצג הכל';
  }
}

async function loadAndRender(page, { mode = 'range' } = {}) {
  const fromInput = page.querySelector('[data-admin-data-from]');
  const toInput = page.querySelector('[data-admin-data-to]');
  const target = page.querySelector('[data-admin-data-results]');
  const from = String(fromInput?.value || '');
  const to = String(toInput?.value || '');
  const showAll = mode === 'all';

  if (!showAll) {
    if (!from || !to) {
      target.innerHTML = '<div class="admin-data-message admin-data-error">יש לבחור תאריך התחלה ותאריך סיום.</div>';
      return;
    }
    if (from > to) {
      target.innerHTML = '<div class="admin-data-message admin-data-error">תאריך ההתחלה חייב להיות לפני תאריך הסיום.</div>';
      return;
    }
    if (from < SCHOOL_YEAR_FROM || to > SCHOOL_YEAR_TO) {
      target.innerHTML = `<div class="admin-data-message admin-data-error">ניתן לבחור טווח בתוך שנת 2027 בלבד (${formatDate(SCHOOL_YEAR_FROM)}–${formatDate(SCHOOL_YEAR_TO)}).</div>`;
      return;
    }
  }

  setLoading(page, true, mode);
  target.innerHTML = '<div class="admin-data-message">טוען נתונים…</div>';
  try {
    const source = await fetchSourceData();
    const eligible = source.activities.filter((activity) => ACTIVE_STATUSES.has(String(activity?.status || '').trim()));
    const filtered = showAll ? eligible : eligible.filter((activity) => overlapsRange(activity, from, to));
    const alertRows = eligible.filter((activity) => dateInRange(String(activity?.start_date || '').slice(0, 10), ALERT_START_FROM, ALERT_START_TO) && String(activity?.end_date || '').slice(0, 10) > ALERT_END_AFTER);
    const emptyText = showAll ? 'לא נמצאו פעילויות בשנת 2027.' : 'לא נמצאו פעילויות בטווח שנבחר.';
    if (!filtered.length) {
      target.innerHTML = `${alertRows.length ? `<div class="admin-data-alert"><span>לתשומת לבך: נמצאו <strong>${formatQty(alertRows.length)}</strong> קורסים שהחלו בין 1.9.2026–20.12.2026 ומסתיימים אחרי 31.1.2027.</span><button type="button" data-admin-data-alert-open>הצג קורסים</button></div>` : ''}<div class="admin-data-message">${emptyText}</div>`;
      target.querySelector('[data-admin-data-alert-open]')?.addEventListener('click', () => openAlertDrawer(alertRows));
      return;
    }
    const districtAgg = aggregateByActivityAndDistrict(filtered);
    const fundingAgg = aggregateFunding(filtered, source.splits, source.sources);
    const scopeLabel = showAll ? 'כל שנת 2027 — כולל פעילויות ללא תאריך' : `${formatDate(from)}–${formatDate(to)}`;
    target.innerHTML = resultsHtml(filtered, districtAgg, fundingAgg, alertRows, scopeLabel);
    target.querySelectorAll('[data-funding-source]').forEach((row) => {
      const open = () => openFundingDrawer(row.getAttribute('data-funding-source') || '', fundingAgg.contributions);
      row.addEventListener('click', open);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    });
    target.querySelector('[data-admin-data-alert-open]')?.addEventListener('click', () => openAlertDrawer(alertRows));
  } catch (error) {
    console.error('[admin-data-tool] failed to load', error);
    target.innerHTML = '<div class="admin-data-message admin-data-error">לא ניתן היה לטעון את הנתונים. נסו שוב.</div>';
  } finally {
    setLoading(page, false, mode);
  }
}

function groupContributions(source, contributions) {
  const normalized = String(source || '').trim();
  const mode = normalized === 'גפן' ? 'school' : normalized === 'רשות' ? 'authority' : 'other';
  const grouped = new Map();
  for (const item of contributions.filter((entry) => entry.source === source)) {
    const activity = item.activity || {};
    let label = '';
    if (mode === 'school') label = String(activity.school || 'ללא בית ספר').trim();
    else if (mode === 'authority') label = String(activity.authority || 'ללא רשות').trim();
    else label = String(activity.school || activity.authority || activityLabel(activity) || 'ללא שיוך').trim();
    const row = grouped.get(label) || { label, quantity: 0, amount: 0 };
    row.quantity += item.quantity;
    row.amount += item.amount;
    grouped.set(label, row);
  }
  return { mode, rows: [...grouped.values()].sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, 'he')) };
}

function closeDrawer() {
  document.querySelector('.admin-data-drawer-backdrop')?.remove();
  document.querySelector('.admin-data-drawer')?.remove();
}

function openDrawer(title, subtitle, bodyHtml) {
  closeDrawer();
  document.body.insertAdjacentHTML('beforeend', `<div class="admin-data-drawer-backdrop" data-admin-data-drawer-close></div><aside class="admin-data-drawer" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><div class="admin-data-drawer__head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><button type="button" class="admin-data-drawer__close" data-admin-data-drawer-close aria-label="סגירה">×</button></div><div class="admin-data-drawer__body">${bodyHtml}</div></aside>`);
  document.querySelectorAll('[data-admin-data-drawer-close]').forEach((node) => node.addEventListener('click', closeDrawer));
  document.querySelector('.admin-data-drawer__close')?.focus();
}

function openFundingDrawer(source, contributions) {
  const grouped = groupContributions(source, contributions);
  const descriptor = grouped.mode === 'school' ? 'בתי ספר שנכללו בספירה' : grouped.mode === 'authority' ? 'רשויות שנכללו בספירה' : 'פירוט השיוכים שנכללו בספירה';
  const firstHeader = grouped.mode === 'school' ? 'בית ספר' : grouped.mode === 'authority' ? 'רשות' : 'שיוך';
  openDrawer(`גורם מימון: ${source}`, descriptor, tableHtml(grouped.rows, { firstHeader }));
}

function openAlertDrawer(alertRows) {
  const rows = alertRows
    .slice()
    .sort((a, b) => String(a.start_date || '').localeCompare(String(b.start_date || '')))
    .map((activity) => `<tr><td><strong>${escapeHtml(activityLabel(activity))}</strong><br><span>${escapeHtml(String(activity.school || activity.authority || ''))}</span>${activity.activity_manager ? `<br><span>מנהל/ת: ${escapeHtml(String(activity.activity_manager))}</span>` : ''}</td><td>${formatDate(activity.start_date)}</td><td>${formatDate(activity.end_date)}</td></tr>`)
    .join('');
  const body = `<div class="admin-data-table-wrap"><table class="admin-data-table"><thead><tr><th>קורס / בית ספר</th><th>התחלה</th><th>סיום</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="admin-data-empty-row">אין קורסים</td></tr>'}</tbody></table></div>`;
  openDrawer('קורסים חוצי תקופה', 'התחילו עד 20.12.2026 ומסתיימים אחרי 31.1.2027', body);
}

function scheduleAttach() {
  requestAnimationFrame(attachTile);
}

if (typeof document !== 'undefined') {
  ensureStyles();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleAttach, { once: true });
  else scheduleAttach();
  const root = document.getElementById('app') || document.documentElement;
  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => {
      if (!isAdminHome()) closeDrawer();
      scheduleAttach();
    }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-current-route'] });
  }
  document.addEventListener('app:navigate', () => {
    closeDrawer();
    scheduleAttach();
  });
}

export {
  SCHOOL_YEAR_FROM,
  SCHOOL_YEAR_TO,
  ALERT_START_FROM,
  ALERT_START_TO,
  ALERT_END_AFTER,
  overlapsRange,
  allocateFunding,
  aggregateByActivityAndDistrict,
  aggregateFunding,
  attachTile
};
