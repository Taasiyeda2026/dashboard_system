import { escapeHtml } from './shared/html.js';

export const financeScreen = {
  load: ({ api }) => api.finance(),
  render(data) {
    return `<section class="panel"><h2>Finance</h2><div class="stack">${(data.rows || []).map((row) => `<article class="mini-card"><h4>${row.row_id}</h4><p>${escapeHtml(row.title)}</p><p>Status: ${row.finance_status} | Active: ${row.active}</p></article>`).join('')}</div></section>`;
  }
};
