import { escapeHtml } from './shared/html.js';
import { visibleActivityCategoryLabel, hebrewFinanceStatus, financeStatusVariant } from './shared/ui-hebrew.js';
import { dsPageHeader, dsScreenStack, dsInteractiveCard, dsStatusChip } from './shared/layout.js';

const HEBREW_DOW_MON_FIRST = ['שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת', 'ראשון'];

function localYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function weekItemMeta(item) {
  const names = [item.instructor_name, item.instructor_name_2].filter((x) => x && String(x).trim()).join(' · ');
  if (names) return `מדריך: ${names}`;
  const ids = [item.emp_id, item.emp_id_2].filter((x) => x && String(x).trim()).join(' · ');
  if (ids) return `מזהה: ${ids}`;
  return `מזהה: ${item.RowID || ''}`;
}

function weekDrawerHtml(item, date) {
  const names = [item.instructor_name, item.instructor_name_2].filter((x) => x && String(x).trim()).join(' · ');
  const ids = `${item.emp_id || '—'} · ${item.emp_id_2 || '—'}`;
  const finChip = dsStatusChip(
    hebrewFinanceStatus(item.finance_status || 'open'),
    financeStatusVariant(item.finance_status)
  );
  return `
    <div class="ds-details-grid" dir="rtl">
      <p><strong>שם פעילות:</strong> ${escapeHtml(item.activity_name || '—')}</p>
      <p><strong>RowID:</strong> ${escapeHtml(String(item.RowID || ''))}</p>
      <p><strong>סוג:</strong> ${escapeHtml(visibleActivityCategoryLabel(item.activity_type))}</p>
      <p><strong>תאריכים:</strong> ${escapeHtml(item.start_date || '—')} עד ${escapeHtml(item.end_date || '—')}</p>
      <p><strong>יום בלוח:</strong> ${escapeHtml(date)}</p>
      <p><strong>מדריכים:</strong> ${escapeHtml(names || ids)}</p>
      <p><strong>סטטוס כספי:</strong> ${finChip}</p>
    </div>`;
}

export const weekScreen = {
  load: ({ api }) => api.week(),
  render(data) {
    const safeDays = Array.isArray(data?.days) ? data.days : [];
    const todayIso = localYmd();

    const columns = safeDays
      .map((d, idx) => {
        const items = Array.isArray(d.items) ? d.items : [];
        const isToday = d.date === todayIso;
        const dow = HEBREW_DOW_MON_FIRST[idx] || '';
        const sessionBlocks = items.length
          ? items
              .map((item) =>
                dsInteractiveCard({
                  variant: 'session',
                  action: `weeksession|${encodeURIComponent(d.date)}|${encodeURIComponent(item.RowID)}`,
                  title: item.activity_name || 'ללא שם',
                  meta: weekItemMeta(item)
                })
              )
              .join('')
          : '<p class="ds-muted ds-week-empty">אין פריטים</p>';
        return `
      <section class="ds-week-col${isToday ? ' is-today' : ''}" aria-label="${escapeHtml(d.date)}">
        <header class="ds-week-col__head">
          <span class="ds-week-col__dow">${escapeHtml(dow)}</span>
          <span class="ds-week-col__date">${escapeHtml(d.date)}</span>
          <span class="ds-week-col__count">${items.length}</span>
        </header>
        <div class="ds-week-col__body">${sessionBlocks}</div>
      </section>`;
      })
      .join('');

    const body =
      columns ||
      `<div class="ds-empty"><p class="ds-empty__msg">אין נתוני שבוע זמינים</p></div>`;

    return dsScreenStack(`
      ${dsPageHeader('שבוע', 'לוח עבודה — לחיצה על פריט לפתיחת פירוט')}
      <div class="ds-week-board" role="region" aria-label="לוח שבוע">${body}</div>
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
        content: weekDrawerHtml(item, date)
      });
    });
  }
};
