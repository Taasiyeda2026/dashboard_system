import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsScreenStack, dsInteractiveCard } from './shared/layout.js';

export const weekScreen = {
  load: ({ api }) => api.week(),
  render(data) {
    const safeDays = Array.isArray(data?.days) ? data.days : [];
    const days = safeDays
      .map((d) => {
        const items = Array.isArray(d.items) ? d.items : [];
        const sessionBlocks = items.length
          ? items
              .map((item) =>
                dsInteractiveCard({
                  variant: 'session',
                  action: `weeksession|${encodeURIComponent(d.date)}|${encodeURIComponent(item.RowID)}`,
                  title: item.activity_name || 'ללא שם',
                  meta: `מזהה: ${item.RowID}`
                })
              )
              .join('')
          : '<p class="ds-muted">אין פריטים</p>';
        return `
      <article class="ds-day-card">
        <h3>${escapeHtml(d.date)}</h3>
        <div class="ds-session-stack">${sessionBlocks}</div>
      </article>`;
      })
      .join('');

    const body =
      days ||
      `<div class="ds-empty"><p class="ds-empty__msg">אין נתוני שבוע זמינים</p></div>`;

    return dsScreenStack(`
      ${dsPageHeader('שבוע', 'פעילויות לפי ימים')}
      <div class="ds-week-grid">${body}</div>
    `);
  },
  bind({ root, ui, data }) {
    ui.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('weeksession|')) return;
      const rest = action.slice('weeksession|'.length);
      const sep = rest.indexOf('|');
      if (sep < 0) return;
      const date = decodeURIComponent(rest.slice(0, sep));
      const rowId = decodeURIComponent(rest.slice(sep + 1));
      const days = Array.isArray(data?.days) ? data.days : [];
      const day = days.find((x) => x.date === date);
      const items = day && Array.isArray(day.items) ? day.items : [];
      const item = items.find((x) => String(x.RowID) === String(rowId));
      if (!item) {
        ui.openDrawer({ title: 'פריט', content: '<p class="ds-muted">לא נמצאו נתונים</p>' });
        return;
      }
      ui.openDrawer({
        title: item.activity_name || 'פעילות',
        content: `
          <dl class="ds-detail-dl">
            <div><dt>מזהה שורה</dt><dd>${escapeHtml(String(item.RowID || ''))}</dd></div>
            <div><dt>תאריך</dt><dd>${escapeHtml(date)}</dd></div>
          </dl>`
      });
    });
  }
};
