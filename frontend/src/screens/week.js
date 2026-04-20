import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsScreenStack, dsInteractiveCard } from './shared/layout.js';
import { activityRowDetailHtml } from './shared/activity-detail-html.js';

function localYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function weekItemMeta(item, hideEmpIds) {
  const names = [item.instructor_name, item.instructor_name_2].filter((x) => x && String(x).trim()).join(' · ');
  if (names) return `מדריך: ${names}`;
  if (!hideEmpIds) {
    const ids = [item.emp_id, item.emp_id_2].filter((x) => x && String(x).trim()).join(' · ');
    if (ids) return `מזהה: ${ids}`;
  }
  return `מזהה: ${item.RowID || ''}`;
}

function weekDrawerHtml(item, date, hideEmpIds) {
  const base = activityRowDetailHtml(item, { privateNote: null, hideEmpIds: !!hideEmpIds });
  const cut = base.lastIndexOf('</div>');
  const head = cut >= 0 ? base.slice(0, cut) : base;
  return `${head}
      <p><strong>יום בלוח:</strong> ${escapeHtml(date)}</p>
    </div>`;
}

export const weekScreen = {
  load: ({ api, state }) => api.week({ week_offset: Number(state?.weekOffset || 0) }),
  render(data, { state }) {
    const safeDays = Array.isArray(data?.days) ? data.days : [];
    const todayIso = localYmd();
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;

    const columns = safeDays
      .map((d, idx) => {
        const items = Array.isArray(d.items) ? d.items : [];
        const isToday = d.date === todayIso;
        const dow = d.weekday_label || '';
        const sessionBlocks = items.length
          ? items
              .map((item) =>
                dsInteractiveCard({
                  variant: 'session',
                  action: `weeksession|${encodeURIComponent(d.date)}|${encodeURIComponent(item.RowID)}`,
                  title: item.activity_name || 'ללא שם',
                  meta: weekItemMeta(item, hideEmpIds)
                })
              )
              .join('')
          : '<p class="ds-muted ds-week-empty">אין פריטים</p>';
        return `
      <section class="ds-week-col${isToday ? ' is-today' : ''}" aria-label="${escapeHtml(d.date)}">
        <header class="ds-week-col__head">
          <span class="ds-week-col__dow">${escapeHtml(dow || `יום ${idx + 1}`)}</span>
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
    const weekOffset = Number(state?.weekOffset || 0);
    const weekLabel = weekOffset === 0 ? 'שבוע נוכחי' : weekOffset < 0 ? `${Math.abs(weekOffset)} שבועות אחורה` : `${weekOffset} שבועות קדימה`;

    return dsScreenStack(`
      ${dsPageHeader('שבוע', 'לוח עבודה — לחיצה על פריט לפתיחת פירוט')}
      <nav class="ds-cal-nav" role="navigation" aria-label="ניווט שבועי" dir="rtl">
        <button type="button" class="ds-btn ds-btn--sm" data-week-prev aria-label="שבוע קודם">▶ שבוע קודם</button>
        <span class="ds-cal-nav__label">${escapeHtml(weekLabel)}</span>
        <button type="button" class="ds-btn ds-btn--sm" data-week-next aria-label="שבוע הבא">שבוע הבא ◀</button>
      </nav>
      <div class="ds-week-board" role="region" aria-label="לוח שבוע">${body}</div>
    `);
  },
  bind({ root, ui, data, state, rerender }) {
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
    root.querySelector('[data-week-prev]')?.addEventListener('click', () => {
      state.weekOffset = Number(state.weekOffset || 0) - 1;
      rerender?.();
    });
    root.querySelector('[data-week-next]')?.addEventListener('click', () => {
      state.weekOffset = Number(state.weekOffset || 0) + 1;
      rerender?.();
    });
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
        content: weekDrawerHtml(item, date, hideEmpIds)
      });
    });
  }
};
