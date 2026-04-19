import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsScreenStack, dsInteractiveCard } from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';
import { activityRowDetailHtml } from './shared/activity-detail-html.js';

function localYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function weekItemMeta(item, hideEmpIds) {
  const id1 = String(item.emp_id || '').trim();
  const id2 = String(item.emp_id_2 || '').trim();
  const ids = [id1, id2].filter(Boolean).join(' · ');
  const names = [item.instructor_name, item.instructor_name_2].filter((x) => x && String(x).trim()).join(' · ');
  if (hideEmpIds) {
    if (names) return `מדריך: ${names}`;
    if (ids) return `מזהה: ${ids}`;
    return 'ללא מזהה מדריך';
  }
  if (ids) return names ? `מזהה: ${ids} (${names})` : `מזהה: ${ids}`;
  if (names) return `תצוגה: ${names}`;
  return `מזהה שורה: ${item.RowID || ''}`;
}

function weekDrawerHtml(item, date, hideEmpIds) {
  const base = activityRowDetailHtml(item, { privateNote: null, hideEmpIds: !!hideEmpIds });
  const cut = base.lastIndexOf('</div>');
  const head = cut >= 0 ? base.slice(0, cut) : base;
  return `${head}
      <p><strong>יום בלוח:</strong> ${escapeHtml(date)}</p>
    </div>`;
}

function weekRangeLabel(days) {
  if (!days || days.length === 0) return '';
  const first = days[0]?.date || '';
  const last = days[days.length - 1]?.date || '';
  if (!first) return '';
  return first === last ? first : `${first} — ${last}`;
}

export const weekScreen = {
  load: ({ api, state }) => api.week({ week_offset: state.weekOffset || 0 }),
  render(data, { state }) {
    const safeDays = Array.isArray(data?.days) ? data.days : [];
    const todayIso = localYmd();
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
    const weekOffset = state.weekOffset || 0;

    const columns = safeDays
      .map((d, idx) => {
        const items = Array.isArray(d.items) ? d.items : [];
        const isToday = d.date === todayIso;
        const dow = d.weekday_label || '';
        const sessionBlocks = items.length
          ? items
              .map((item) => {
                const hay = [
                  item.activity_name,
                  item.RowID,
                  item.instructor_name,
                  item.instructor_name_2,
                  item.emp_id,
                  item.emp_id_2,
                  d.date,
                  dow
                ]
                  .filter(Boolean)
                  .join(' ');
                return `<div class="ds-week-session-wrap" data-list-item data-search="${escapeHtml(hay)}" data-filter="">
                ${dsInteractiveCard({
                  variant: 'session',
                  action: `weeksession|${encodeURIComponent(d.date)}|${encodeURIComponent(item.RowID)}`,
                  title: item.activity_name || 'ללא שם',
                  meta: weekItemMeta(item, hideEmpIds)
                })}
              </div>`;
              })
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

    const rangeLabel = weekRangeLabel(safeDays);
    const isCurrentWeek = weekOffset === 0;
    const navLabel = isCurrentWeek
      ? `שבוע נוכחי${rangeLabel ? ` · ${rangeLabel}` : ''}`
      : weekOffset < 0
        ? `${Math.abs(weekOffset)} שבועות אחורה${rangeLabel ? ` · ${rangeLabel}` : ''}`
        : `${weekOffset} שבועות קדימה${rangeLabel ? ` · ${rangeLabel}` : ''}`;

    return dsScreenStack(`
      ${dsPageHeader('שבוע', 'לוח עבודה — לחיצה על פריט לפתיחת פירוט')}
      <nav class="ds-cal-nav" role="navigation" aria-label="ניווט שבועי" dir="rtl">
        <button type="button" class="ds-btn ds-btn--sm" data-week-prev aria-label="שבוע קודם">→ שבוע קודם</button>
        <span class="ds-cal-nav__label">${escapeHtml(navLabel)}</span>
        <button type="button" class="ds-btn ds-btn--sm" data-week-next aria-label="שבוע הבא">שבוע הבא ←</button>
      </nav>
      ${dsPageListToolsBar({ searchPlaceholder: 'חיפוש בפריטי השבוע…', filters: [] })}
      <div class="ds-week-board" role="region" aria-label="לוח שבוע">${body}</div>
    `);
  },
  bind({ root, ui, data, state, rerender }) {
    bindPageListTools(root);
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;

    root.querySelector('[data-week-prev]')?.addEventListener('click', () => {
      state.weekOffset = (state.weekOffset || 0) - 1;
      rerender?.();
    });
    root.querySelector('[data-week-next]')?.addEventListener('click', () => {
      state.weekOffset = (state.weekOffset || 0) + 1;
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
