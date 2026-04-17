import { escapeHtml } from './shared/html.js';

export const instructorsScreen = {
  load: ({ api }) => api.instructors(),
  render(data) {
    return `<section class="panel"><h2>Instructors</h2><div class="stack">${(data.rows || []).map((row) => `<article class="mini-card"><h4>${escapeHtml(row.full_name)}</h4><p>${escapeHtml(row.instructor_id)}</p><p>Direct manager: ${escapeHtml(row.direct_manager)}</p></article>`).join('')}</div></section>`;
  }
};
