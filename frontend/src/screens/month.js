import { escapeHtml } from './shared/html.js';

export const monthScreen = {
  load: ({ api }) => api.month(),
  render(data) {
    return `<section class="panel"><h2>Month ${escapeHtml(data.month || '')}</h2><div class="month-grid">${(data.cells || []).map((cell) => `<article class="mini-card"><h4>${cell.day}</h4><p>${cell.items.length}</p></article>`).join('')}</div></section>`;
  }
};
