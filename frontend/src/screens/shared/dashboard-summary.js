/**
 * dashboard-summary.js — קריאת נתוני סיכום dashboard מה-localStorage.
 *
 * ה-read-model של dashboard נשמר ב-localStorage תחת 'ds_read_model_cache_v2'['dashboard'].
 * הוא כולל סיכומי חודש ספציפי ומשמש לתצוגה מיידית ללא בקשת שרת.
 *
 * שימוש:
 *   import { readDashboardSummaryForYm, shortActivitiesMap, dashboardSummaryBar } from './dashboard-summary.js';
 *   const sum = readDashboardSummaryForYm(ym);   // null אם אין נתונים / חודש לא תואם
 *   const html = dashboardSummaryBar([...chips]); // HTML של רצועת KPI
 */

const _DS_CACHE_KEY = 'ds_read_model_cache_v2';

/**
 * קריאת ה-read-model של dashboard מ-localStorage.
 * @param {string|null} ym - 'YYYY-MM' לבדיקת תאימות חודש; null = ללא בדיקה.
 * @returns {object|null}
 */
export function readDashboardSummaryForYm(ym) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(_DS_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    const entry = cache?.['dashboard'];
    if (!entry?.data) return null;
    if (ym && entry.data.month !== ym) return null;
    return entry.data;
  } catch {
    return null;
  }
}

/**
 * מחזיר מפה { activityType → count } מתוך summary.short_activities.
 */
export function shortActivitiesMap(summary) {
  const out = {};
  const arr = Array.isArray(summary?.summary?.short_activities) ? summary.summary.short_activities : [];
  arr.forEach((a) => {
    if (a?.activity_type) out[a.activity_type] = Number(a.count || 0);
  });
  return out;
}

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * מחזיר HTML של רצועת KPI סיכומית (ds-sum-bar).
 * @param {Array<{label:string, value:number|string, hideZero?:boolean}>} chips
 */
export function dashboardSummaryBar(chips) {
  if (!Array.isArray(chips) || !chips.length) return '';
  const items = chips
    .filter((c) => c.value != null && c.value !== '' && !(c.hideZero && Number(c.value) === 0))
    .map((c) => `<span class="ds-sum-bar__chip"><span class="ds-sum-bar__lbl">${_esc(c.label)}</span><span class="ds-sum-bar__val">${_esc(c.value)}</span></span>`);
  if (!items.length) return '';
  return `<div class="ds-sum-bar" dir="rtl" aria-label="נתוני סיכום מגיליון dashboard">${items.join('')}</div>`;
}
