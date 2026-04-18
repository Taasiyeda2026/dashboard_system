import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsScreenStack } from './shared/layout.js';

export const weekScreen = {
  load: ({ api }) => api.week(),
  render(data) {
    const safeDays = Array.isArray(data?.days) ? data.days : [];
    const days = safeDays
      .map(
        (d) => `
      <article class="ds-day-card">
        <h3>${escapeHtml(d.date)}</h3>
        <ul>${(Array.isArray(d.items) ? d.items : [])
          .map((item) => `<li>${escapeHtml(item.RowID)} · ${escapeHtml(item.activity_name || 'ללא שם')}</li>`)
          .join('') || '<li>אין פריטים</li>'}</ul>
      </article>`
      )
      .join('');

    const body =
      days ||
      `<div class="ds-empty"><p class="ds-empty__msg">אין נתוני שבוע זמינים</p></div>`;

    return dsScreenStack(`
      ${dsPageHeader('שבוע', 'פעילויות לפי ימים')}
      <div class="ds-week-grid">${body}</div>
    `);
  }
};
