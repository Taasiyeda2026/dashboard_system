const runtimeConfig = globalThis.__DASHBOARD_CONFIG__ || {};

/** פריסת Web App נוכחית — ניתן לדרוס ב־`window.__DASHBOARD_CONFIG__.apiUrl` או ב־`?apiUrl=` */
const DEFAULT_API_URL =
  'https://script.google.com/macros/s/AKfycbxbTX-AkMFIelOUXaaslyD4c3Kz4BrdODc3HBp6mej8Pj9IP8JbvNXEqBg4kw6t4Z92/exec';

const API_URL =
  runtimeConfig.apiUrl ||
  (typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('apiUrl') || ''
    : '') ||
  DEFAULT_API_URL;

export const config = {
  apiUrl: API_URL
};
