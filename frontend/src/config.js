/**
 * frontend/src/config.js — המקור היחיד לכתובת ה-API בכל הפרויקט.
 *
 * אין לשים URL של Google Apps Script בשום קובץ אחר בפרויקט.
 * כל שינוי ב-API URL חייב להיעשות כאן בלבד.
 *
 * סדר עדיפויות לקביעת ה-URL:
 *  1. window.__DASHBOARD_CONFIG__.apiUrl  — מוגדר ב-index.html לפני טעינת האפליקציה (מומלץ לייצור)
 *  2. ?apiUrl=...                         — פרמטר query בכתובת הדפדפן (לבדיקות/dev)
 *  3. DEFAULT_API_URL                     — כתובת פריסה ברירת מחדל (production)
 *
 * כדי להחליף סביבה (dev/staging/prod), שנו את DEFAULT_API_URL כאן או השתמשו
 * ב-window.__DASHBOARD_CONFIG__ מחוץ לבאנדל.
 */
const runtimeConfig = (typeof globalThis !== 'undefined' && globalThis.__DASHBOARD_CONFIG__) || {};

/**
 * כתובת פריסת Web App הנוכחית.
 * ניתן לדרוס ב-`window.__DASHBOARD_CONFIG__.apiUrl` או ב-`?apiUrl=` בלא שינוי קוד.
 */
const DEFAULT_API_URL =
  'https://script.google.com/macros/s/AKfycbwOE07-PLbJiWAK-Rf58ymMvgu0b0WSaIn040nOKjKyQSecju3Bsdcl6oLgZnlvtc0_/exec';

function resolveApiUrl() {
  if (runtimeConfig.apiUrl) return String(runtimeConfig.apiUrl).trim();

  try {
    const fromQuery = new URLSearchParams(
      typeof window !== 'undefined' ? window.location.search : ''
    ).get('apiUrl');
    if (fromQuery) return fromQuery.trim();
  } catch {}

  return DEFAULT_API_URL;
}

const resolvedUrl = resolveApiUrl();

if (!resolvedUrl) {
  console.warn(
    '[Dashboard] API URL לא הוגדר. הגדירו window.__DASHBOARD_CONFIG__.apiUrl לפני טעינת האפליקציה, '
    + 'או העבירו ?apiUrl= בכתובת, או עדכנו DEFAULT_API_URL ב-frontend/src/config.js.'
  );
}

export const config = {
  apiUrl: resolvedUrl,
  DIAGNOSTICS_UI_ENABLED: false,
  HOTFIX_VERSION: 'client-contact-secure-rpc-auth-session-security-timeouts-20260726-v2-activity-drawer-cache-20260727-v1-edit-dedup-v1-performance-cache-20260727-v1-dashboard-exceptions-unique-20260728-v2-completion-approval-performance-20260728-v1-always-fresh-data-20260728-v1-nonblocking-fetch-20260728-v1-month-navigation-20260728-v1-dashboard-august-navigation-20260728-v1-progressive-route-warmup-20260728-v1-next-year-pricing-20260729-v1-next-year-workshops-20260729-v1-login-sw-refresh-20260729-v1-restore-2026-summer-20260730-v1-sw-cache-refresh-20260730-v1-proposal-pdf-school-filename-20260730-v1-instructor-matching-modal-20260730-v1-israa-excel-drawer-20260730-v1-israa-approved-fields-20260730-v2-israa-toolbar-filters-20260730-v1-israa-compact-drawer-multiselect-20260730-v1-israa-program-multiselect-click-fix-20260730-v1-israa-program-menu-visible-20260730-v1-annual-review-print-shell-20260730-v1-annual-review-isolated-print-20260730-v2-proposal-editor-compact-cache-20260801-v1-proposal-editor-flat-layout-20260801-v1-proposal-template-switch-stability-20260801-v1'
};
