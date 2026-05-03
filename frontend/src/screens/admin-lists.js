import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsCard, dsScreenStack, dsEmptyState } from './shared/layout.js';

export const adminListsScreen = {
  load: ({ api }) => api.adminLists(),
  render(data) {
    const categories = Array.isArray(data?.categories) ? data.categories : [];

    const contentHtml = categories.length === 0
      ? dsEmptyState('אין רשימות')
      : categories.map((cat) => dsCard({
          title: escapeHtml(cat.category),
          padded: true,
          body: `
            <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: var(--space-2, 8px);">
              ${(cat.items || []).map((item) => {
                const display = (item.label) ? item.label : item.value;
                return `<li><span class="ds-badge" dir="rtl">${escapeHtml(display)}</span></li>`;
              }).join('')}
            </ul>
          `
        })).join('');

    return dsScreenStack(`
      ${dsPageHeader('ניהול רשימות', `${categories.length} קטגוריות`)}
      ${contentHtml}
    `);
  },
  bind() {}
};
