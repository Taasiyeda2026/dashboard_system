const runtimeConfig = globalThis.__DASHBOARD_CONFIG__ || {};

/** פריסת Web App נוכחית — ניתן לדרוס ב־`window.__DASHBOARD_CONFIG__.apiUrl` או ב־`?apiUrl=` */
const DEFAULT_API_URL =
  'https://script.google.com/macros/s/AKfycbwsDBJ8tbAfHE1GoMGi55_7Y9_rHxiXVCNKvqI-6a7WGr5LwE-29Z-yRvBbMZOF9seK/exec';

const API_URL =
  runtimeConfig.apiUrl ||
  (typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('apiUrl') || ''
    : '') ||
  DEFAULT_API_URL;

export const config = {
  apiUrl: API_URL
};
