import { supabase } from './supabase-client.js';
import { state } from './state.js';
import { formatDateHe } from './screens/shared/format-date.js';
import { getActivityPeriodKey, normalizeGlobalActivityPeriod } from './screens/shared/summer-activity.js';

let rows = [];
let timer = null;
let inflight = null;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function iso(value) {
  const match = text(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || '';
}

function selectedEndDatesMonth() {
  const month = text(state.endDatesMonthYm).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) ? month : '';
}

function periodRows(source) {
  const period = normalizeGlobalActivityPeriod(state.activityPeriodTab);
  const selectedMonth = selectedEndDatesMonth();
  return (Array.isArray(source) ? source : [])
    .map((row) => ({ ...row, _endDate: iso(row.end_date || row.date_end) }))
    .filter((row) => row._endDate && getActivityPeriodKey(row) === period)
    .filter((row) => !selectedMonth || row._endDate.slice(0, 7) === selectedMonth)
    .sort((a, b) => a._endDate.localeCompare(b._endDate) || text(a.school).localeCompare(text(b.school), 'he'));
}

function monthLabel(key) {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function render() {
  const screen = document.querySelector('#app .ds-end-dates-screen');
  if (!screen) return;
  const manager = text(state.endDatesManager);
  const source = periodRows(rows);
  const managers = [...new Set(source.map((row) => text(row.activity_manager)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
  const visible = manager ? source.filter((row) => text(row.activity_manager) === manager) : source;
  const groups = new Map();
  visible.forEach((row) => {
    const key = row._endDate.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  const content = visible.length
    ? [...groups.entries()].map(([key, items]) => `<section style="margin-top:14px"><h3 style="margin:0 0 6px;color:#0f8fb3">${escapeHtml(monthLabel(key))} <small>(${items.length})</small></h3><div class="ds-table-wrap"><table class="ds-table"><thead><tr><th>שם פעילות</th><th>בית ספר</th><th>רשות</th><th>מנהל פעילות</th><th>תאריך סיום</th></tr></thead><tbody>${items.map((row) => `<tr><td>${escapeHtml(row.activity_name || '—')}</td><td>${escapeHtml(row.school || '—')}</td><td>${escapeHtml(row.authority || '—')}</td><td>${escapeHtml(row.activity_manager || '—')}</td><td><bdi dir="ltr">${escapeHtml(formatDateHe(row._endDate))}</bdi></td></tr>`).join('')}</tbody></table></div></section>`).join('')
    : '<div class="ds-empty" role="status"><p class="ds-empty__msg">אין פעילויות עם תאריך סיום להצגה</p></div>';
  screen.innerHTML = `<h1 class="ds-end-dates-page-title">תאריכי סיום פעילויות</h1><section class="ds-card"><div class="ds-card__body"><div style="display:flex;justify-content:flex-start;margin-bottom:10px"><label style="display:grid;gap:4px"><span>מנהל פעילויות</span><select class="ds-input ds-input--sm" data-live-end-manager><option value="">כל מנהלי הפעילויות</option>${managers.map((name) => `<option value="${escapeHtml(name)}"${name === manager ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></label></div>${content}</div></section>`;
  screen.querySelector('[data-live-end-manager]')?.addEventListener('change', (event) => {
    state.endDatesManager = event.target.value || '';
    render();
  });
}

async function refresh() {
  if (!supabase || inflight) return inflight;
  inflight = supabase.from('activities').select('*').limit(10000)
    .then(({ data, error }) => {
      if (error) throw error;
      rows = Array.isArray(data) ? data : [];
      render();
    })
    .catch((error) => console.warn('[end-dates-live] read failed', error?.message || error))
    .finally(() => { inflight = null; });
  return inflight;
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (document.querySelector('#app .ds-end-dates-screen')) void refresh();
  }, 40);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule();
  });
  window.addEventListener('focus', schedule);
  const app = document.getElementById('app');
  if (app && typeof MutationObserver === 'function') {
    new MutationObserver((mutations) => {
      if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => node.nodeType === 1 && (node.matches?.('.ds-end-dates-screen') || node.querySelector?.('.ds-end-dates-screen'))))) schedule();
    }).observe(app, { childList: true, subtree: true });
  }
  setInterval(() => {
    if (document.querySelector('#app .ds-end-dates-screen')) void refresh();
  }, 60000);
  schedule();
}
