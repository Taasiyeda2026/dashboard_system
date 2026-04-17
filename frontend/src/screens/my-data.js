import { escapeHtml } from './shared/html.js';

export const myDataScreen = {
  load: ({ api }) => api.myData(),
  render(data) {
    return `<section class="panel"><h2>My Data</h2><div class="stack">${(data.rows || []).map((row) => `<article class="mini-card"><h4>${row.row_id} · ${escapeHtml(row.title)}</h4><p>${escapeHtml(row.activity_type)}</p><p>${escapeHtml(row.start_date)} → ${escapeHtml(row.end_date)}</p></article>`).join('')}</div></section>`;
  }
};
