const runtimeConfig = globalThis.__DASHBOARD_CONFIG__ || {};

/** פריסת Web App נוכחית — ניתן לדרוס ב־`window.__DASHBOARD_CONFIG__.apiUrl` או ב־`?apiUrl=` */
const DEFAULT_API_URL =
  'https://script.google.com/macros/s/AKfycbyB8JYE9Far7rvD8aKMljQwiQ6X7fHdUhTSs56kE4TsL96rjxPOmrKwafH6WtY2qyM/exec';

const API_URL =
  runtimeConfig.apiUrl ||
  (typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('apiUrl') || ''
    : '') ||
  DEFAULT_API_URL;

export const config = {
  apiUrl: API_URL
};
