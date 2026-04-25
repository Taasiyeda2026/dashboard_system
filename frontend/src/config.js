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
  'https://script.google.com/macros/s/AKfycbxFdTREnomDvWCxVYJEmVPwMgP7eXa02KerUoOHVionN1-yUztuMG97fDYOqhIio3ws/exec';

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
  apiUrl: resolvedUrl
};
