import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsScreenStack, dsInteractiveCard } from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';
import { activityWorkDrawerHtml } from './shared/activity-detail-html.js';
import { translateApiErrorForUser } from './shared/ui-hebrew.js';

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

function weekDrawerHtml(item, date, hideEmpIds, canEdit) {
  const full = activityWorkDrawerHtml(item, { privateNote: null, canEdit: !!canEdit, hideEmpIds: !!hideEmpIds });
  const cut = full.lastIndexOf('</div>');
  if (cut < 0) return full;
  return `${full.slice(0, cut)}
      <p><strong>יום בלוח:</strong> ${escapeHtml(date)}</p>
    ${full.slice(cut)}`;
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

    const uniqueActivities = new Set(safeDays.flatMap((d) => (d.items || []).map((it) => it.RowID))).size;
    const activeDays = safeDays.filter((d) => (d.items || []).length > 0).length;
    const totalSessions = safeDays.reduce((sum, d) => sum + (d.items || []).length, 0);
    const kpiRow = `<div class="ds-mini-kpi-row">
      <span class="ds-mini-kpi"><strong>${uniqueActivities}</strong> פעילויות</span>
      <span class="ds-mini-kpi"><strong>${activeDays}</strong> ימים פעילים</span>
      <span class="ds-mini-kpi"><strong>${totalSessions}</strong> מפגשים</span>
    </div>`;

    return dsScreenStack(`
      ${dsPageHeader('שבוע', '')}
      <nav class="ds-cal-nav" role="navigation" aria-label="ניווט שבועי" dir="rtl">
        <button type="button" class="ds-btn ds-btn--sm" data-week-prev aria-label="שבוע קודם">▶ שבוע קודם</button>
        <span class="ds-cal-nav__label">${escapeHtml(navLabel)}</span>
        <button type="button" class="ds-btn ds-btn--sm" data-week-next aria-label="שבוע הבא">שבוע הבא ◀</button>
      </nav>
      ${kpiRow}
      ${dsPageListToolsBar({ searchPlaceholder: 'חיפוש בפריטי השבוע…', filters: [] })}
      <div class="ds-week-board" style="--week-cols:${safeDays.length || 7}" role="region" aria-label="לוח שבוע">${body}</div>
    `);
  },
  bind({ root, ui, data, state, rerender, clearScreenDataCache, api }) {
    bindPageListTools(root);
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
    const canEditActivity = state?.user?.display_role !== 'instructor';

    function bindActivityEditForm(contentRoot) {
      const form = contentRoot.querySelector('[data-edit-activity]');
      if (!form || !api) return;
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const statusEl = form.querySelector('.ds-activity-edit-status');
        const sourceSheet = form.getAttribute('data-source-sheet') || '';
        const sourceRowId = form.getAttribute('data-row-id') || '';
        const fd = new FormData(form);
        const changes = {
          status: String(fd.get('status') ?? '').trim(),
          notes: String(fd.get('notes') ?? '').trim(),
          finance_status: String(fd.get('finance_status') ?? '').trim(),
          finance_notes: String(fd.get('finance_notes') ?? '').trim(),
          start_date: String(fd.get('start_date') ?? '').trim(),
          end_date: String(fd.get('end_date') ?? '').trim()
        };
        try {
          await api.saveActivity({ source_sheet: sourceSheet, source_row_id: sourceRowId, changes });
          if (statusEl) statusEl.textContent = 'נשמר';
          ui?.closeAll();
          clearScreenDataCache?.();
          if (typeof rerender === 'function') await rerender();
        } catch (err) {
          if (statusEl) statusEl.textContent = translateApiErrorForUser(err?.message);
        }
      });
    }

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
        content: weekDrawerHtml(item, date, hideEmpIds, canEditActivity),
        onOpen: canEditActivity ? bindActivityEditForm : undefined
      });
    });
  }
};
