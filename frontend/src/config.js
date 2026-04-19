const runtimeConfig = globalThis.__DASHBOARD_CONFIG__ || {};

/** פריסת Web App נוכחית — ניתן לדרוס ב־`window.__DASHBOARD_CONFIG__.apiUrl` או ב־`?apiUrl=` */
const DEFAULT_API_URL =
  'https://script.google.com/macros/s/AKfycbyk1EqZBC2SpOg0nx9pB4ziv2cEw6QOEpk3in18VDg50IK5ban8mhUEdAzbESka0-UU/exec';

const API_URL =
  runtimeConfig.apiUrl ||
  (typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('apiUrl') || ''
    : '') ||
  DEFAULT_API_URL;

export const config = {
  apiUrl: API_URL
};
