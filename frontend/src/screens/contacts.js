import { escapeHtml } from './shared/html.js';

export const contactsScreen = {
  load: ({ api }) => api.contacts(),
  render(data) {
    return `<section class="panel"><h2>Contacts</h2><div class="stack">${(data.rows || []).map((row) => `<article class="mini-card"><h4>${escapeHtml(row.name)}</h4><p>${escapeHtml(row.type)}</p><p>${escapeHtml(row.phone)} | ${escapeHtml(row.email)}</p></article>`).join('')}</div></section>`;
  }
};
