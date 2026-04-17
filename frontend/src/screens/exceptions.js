import { escapeHtml } from './shared/html.js';

export const exceptionsScreen = {
  load: ({ api }) => api.exceptions(),
  render(data) {
    return `<section class="panel"><h2>Exceptions (data_long only)</h2><p>Priority: missing instructor → missing start date → late end date</p><div class="inline"><span>missing_instructor: ${data.counts?.missing_instructor || 0}</span><span>missing_start_date: ${data.counts?.missing_start_date || 0}</span><span>late_end_date: ${data.counts?.late_end_date || 0}</span></div><div class="stack">${(data.rows || []).map((row) => `<article class="mini-card"><h4>${row.row_id}</h4><p>${escapeHtml(row.title)}</p><p>${row.exception_type}</p></article>`).join('')}</div></section>`;
  }
};
