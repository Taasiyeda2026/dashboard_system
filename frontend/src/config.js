import './proposal-recipient-search-row-fix.js?v=20260801-v10';
import './instructors-header-cleanup.js?v=20260803-isolated-design-v1';

/**
 * frontend/src/config.js — המקור היחיד לכתובת ה-API בכל הפרויקט.
 * ניתן לדרוס את כתובת ה-API באמצעות window.__DASHBOARD_CONFIG__.apiUrl
 * או באמצעות הפרמטר apiUrl בכתובת לצורכי בדיקה.
 */
const runtimeConfig = (typeof globalThis !== 'undefined' && globalThis.__DASHBOARD_CONFIG__) || {};
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
  console.warn('[Dashboard] API URL לא הוגדר.');
}

export const config = {
  apiUrl: resolvedUrl,
  DIAGNOSTICS_UI_ENABLED: false,
  HOTFIX_VERSION: 'course-scheduling-structural-layout-20260805-v1-ops-2027-empty-data-filter-20260807-v1'
};
