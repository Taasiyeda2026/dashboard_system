import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import { escapeHtml } from './screens/shared/html.js';

const DISTRICTS = ['צפון', 'מרכז', 'דרום'];
const ACTIVE_STATUSES = new Set(['פתוח', 'סגור']);
const PAGE_SIZE = 1000;

let currentMode = 'all';
let activitiesPromise = null;
let renderSequence = 0;
let scheduled = false;

function normalizeDistrict(value) {
  const text = String(value || '').trim();
  return DISTRICTS.find((district) => text.includes(district)) || '';
}

function cleanNumber(value) {
  return String(value ?? '').trim();
}

function activityNumber(activity) {
  return cleanNumber(activity?.activity_no) || cleanNumber(activity?.gefen_number);
}

function preferredActivityName(activity) {
  return String(
    activity?.activity_name ||
    activity?.program_name ||
    activity?.name ||
    activity?.title ||
    'ללא שם פעילות'
  ).trim();
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function overlapsRange(activity, from, to) {
  const start = String(activity?.start_date || '').slice(0, 10);
  if (!start) return false;
  const end = String(activity?.end_date || start).slice(0, 10) || start;
  return start <= to && end >= from;
}

async function fetchAllActivities() {
  if (!supabase) throw new Error('Supabase client is not configured');
  await waitForSupabaseAuthSession({ timeoutMs: 7000 });
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('activities')
      .select('id,activity_name,program_name,name,title,activity_no,gefen_number,price,start_date,end_date,status,district,activity_season')
      .eq('activity_season', 'school_2027')
      .in('status', ['פתוח', 'סגור'])
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

function loadActivities() {
  if (!activitiesPromise) activitiesPromise = fetchAllActivities();
  return activitiesPromise;
}

function canonicalNamesByNumber(activities) {
  const counts = new Map();
  for (const activity of activities) {
    const number = activityNumber(activity);
    if (!number) continue;
    const name = preferredActivityName(activity);
    if (!counts.has(number)) counts.set(number, new Map());
    const names = counts.get(number);
    names.set(name, (names.get(name) || 0) + 1);
  }
  const result = new Map();
  for (const [number, names] of counts) {
    const best = [...names.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'he'))[0]?.[0] || 'ללא שם פעילות';
    result.set(number, best);
  }
  return result;
}

function displayLabel(activity, canonicalNames) {
  const number = activityNumber(activity);
  const name = number ? (canonicalNames.get(number) || preferredActivityName(activity)) : preferredActivityName(activity);
  if (!number) return name;
  return name.includes(number) ? name : `${name} ${number}`;
}

function groupDistrictRows(activities) {
  const canonicalNames = canonicalNamesByNumber(activities);
  const grouped = new Map(DISTRICTS.map((district) => [district, new Map()]));

  for (const activity of activities) {
    const district = normalizeDistrict(activity?.district);
    if (!district) continue;
    const number = activityNumber(activity);
    const name = preferredActivityName(activity);
    const key = number ? `number:${number}` : `name:${name}`;
    const districtMap = grouped.get(district);
    const row = districtMap.get(key) || {
      number,
      label: displayLabel(activity, canonicalNames),
      quantity: 0,
      amount: 0
    };
    row.quantity += 1;
    row.amount += money(activity?.price);
    districtMap.set(key, row);
  }

  return grouped;
}

function compareActivityRows(a, b) {
  const aNumber = Number(a.number);
  const bNumber = Number(b.number);
  const aNumeric = a.number && Number.isFinite(aNumber);
  const bNumeric = b.number && Number.isFinite(bNumber);
  if (aNumeric && bNumeric && aNumber !== bNumber) return aNumber - bNumber;
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  if (a.number !== b.number) return String(a.number || '').localeCompare(String(b.number || ''), 'he', { numeric: true });
  return a.label.localeCompare(b.label, 'he');
}

function formatMoney(value) {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0
  }).format(money(value));
}

function formatQuantity(value) {
  return new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function tableHtml(rows) {
  const list = [...rows].sort(compareActivityRows);
  const total = list.reduce((acc, row) => ({
    quantity: acc.quantity + row.quantity,
    amount: acc.amount + row.amount
  }), { quantity: 0, amount: 0 });

  const body = list.length
    ? list.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(formatQuantity(row.quantity))}</td><td>${escapeHtml(formatMoney(row.amount))}</td></tr>`).join('')
    : '<tr><td colspan="3" class="admin-data-empty-row">אין נתונים</td></tr>';

  return `<div class="admin-data-table-wrap"><table class="admin-data-table"><thead><tr><th>שם הפעילות</th><th>כמות</th><th>סה״כ</th></tr></thead><tbody>${body}</tbody><tfoot><tr><td>סה״כ</td><td>${escapeHtml(formatQuantity(total.quantity))}</td><td>${escapeHtml(formatMoney(total.amount))}</td></tr></tfoot></table></div>`;
}

function activeFilteredRows(allRows, page) {
  const eligible = allRows.filter((activity) => ACTIVE_STATUSES.has(String(activity?.status || '').trim()));
  if (currentMode !== 'range') return eligible;
  const from = String(page.querySelector('[data-admin-data-from]')?.value || '').trim();
  const to = String(page.querySelector('[data-admin-data-to]')?.value || '').trim();
  if (!from || !to || from > to) return eligible;
  return eligible.filter((activity) => overlapsRange(activity, from, to));
}

async function renderNumberGroupedDistricts() {
  const page = document.querySelector('[data-admin-data-page]');
  const grid = page?.querySelector('.admin-data-section--districts .admin-data-district-grid');
  if (!page || !grid) return;

  const key = `${currentMode}|${page.querySelector('[data-admin-data-from]')?.value || ''}|${page.querySelector('[data-admin-data-to]')?.value || ''}`;
  if (grid.dataset.activityNumberGroupingKey === key) return;

  const sequence = ++renderSequence;
  try {
    const allRows = await loadActivities();
    if (sequence !== renderSequence) return;
    const pageNow = document.querySelector('[data-admin-data-page]');
    const gridNow = pageNow?.querySelector('.admin-data-section--districts .admin-data-district-grid');
    if (!pageNow || !gridNow) return;
    const filtered = activeFilteredRows(allRows, pageNow);
    const grouped = groupDistrictRows(filtered);
    gridNow.innerHTML = DISTRICTS.map((district) => {
      const rows = [...grouped.get(district).values()];
      return `<div class="admin-data-district"><h3>מחוז ${escapeHtml(district)}</h3>${tableHtml(rows)}</div>`;
    }).join('');
    gridNow.dataset.activityNumberGroupingKey = key;
  } catch (error) {
    console.warn('[admin-data-number-grouping] failed', error);
  }
}

function scheduleRender() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    void renderNumberGroupedDistricts();
  }, 0);
}

document.addEventListener('click', (event) => {
  if (event.target.closest?.('[data-admin-data-show-all]')) {
    currentMode = 'all';
    activitiesPromise = null;
    renderSequence += 1;
    scheduleRender();
  } else if (event.target.closest?.('[data-admin-data-show]')) {
    currentMode = 'range';
    activitiesPromise = null;
    renderSequence += 1;
    scheduleRender();
  }
}, true);

if (typeof MutationObserver !== 'undefined') {
  const observer = new MutationObserver(() => scheduleRender());
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

scheduleRender();
