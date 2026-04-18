const runtimeConfig = globalThis.__DASHBOARD_CONFIG__ || {};

const API_URL =
  runtimeConfig.apiUrl ||
  (typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('apiUrl') || ''
    : '');

export const config = {
  apiUrl: API_URL
};
