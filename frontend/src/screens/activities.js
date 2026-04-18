import { escapeHtml } from './shared/html.js';
import { hebrewActivityType, hebrewFinanceStatus, hebrewColumn } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsFilterBar,
  dsToolbar,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState
} from './shared/layout.js';

const tabs = ['all', 'course', 'after_school', 'workshop', 'tour', 'escape_room'];

export const activitiesScreen = {
  load: ({ api, state }) => api.activities({ activity_type: state.activityTab || 'all' }),
  render(data, { state }) {
    const safeRows = Array.isArray(data?.rows) ? data.rows : [];
    const canSeePrivateNotes = state?.user?.display_role === 'operations_reviewer';
    const compactView = state?.activityView === 'compact';

    const tableRows = safeRows.map((row) => `
      <tr>
        <td>${escapeHtml(row.RowID)}</td>
        <td>${escapeHtml(hebrewActivityType(row.activity_type))}</td>
        <td>${escapeHtml(row.activity_name || '—')}</td>
        <td>${escapeHtml(row.start_date || '—')}</td>
        <td>${escapeHtml(row.end_date || '—')}</td>
        <td>${escapeHtml(row.emp_id || '—')}</td>
        <td>${escapeHtml(row.emp_id_2 || '—')}</td>
        <td>${escapeHtml(hebrewFinanceStatus(row.finance_status || 'open'))}</td>
        ${canSeePrivateNotes ? `<td>${escapeHtml(row.private_note || '')}</td>` : ''}
      </tr>
    `);

    const compactRows = safeRows.map(
      (row) => `
      <article class="ds-compact-row">
        <header>${escapeHtml(row.RowID)} · ${escapeHtml(hebrewActivityType(row.activity_type))}</header>
        <p>${escapeHtml(row.activity_name || 'פעילות ללא שם')}</p>
        <small>${escapeHtml(row.start_date || '—')} עד ${escapeHtml(row.end_date || '—')}</small>
      </article>`
    );

    const thPrivate = canSeePrivateNotes ? `<th>${hebrewColumn('private_note')}</th>` : '';
    const colSpan = canSeePrivateNotes ? 9 : 8;

    const filterButtons = tabs
      .map(
        (tab) =>
          `<button type="button" class="ds-chip ${tab === (state.activityTab || 'all') ? 'is-active' : ''}" data-tab="${tab}">${escapeHtml(hebrewActivityType(tab))}</button>`
      )
      .join('');

    const tableSection =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו פעילויות למסנן זה')
        : dsTableWrap(`<table class="ds-table">
                <thead><tr><th>${hebrewColumn('RowID')}</th><th>${hebrewColumn('activity_type')}</th><th>שם</th><th>התחלה</th><th>סיום</th><th>מדריך/ה 1 (מזהה)</th><th>מדריך/ה 2 (מזהה)</th><th>${hebrewColumn('finance_status')}</th>${thPrivate}</tr></thead>
                <tbody>${tableRows.join('')}</tbody>
              </table>`);

    const compactSection =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו פעילויות למסנן זה')
        : `<div class="ds-compact-list">${compactRows.join('')}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('פעילויות', 'סינון וצפייה ברשימת הפעילויות')}
      ${dsFilterBar(filterButtons)}
      ${dsToolbar(
        `<label class="compact-toggle"><input id="toggle-view" type="checkbox" ${compactView ? 'checked' : ''} /> תצוגה קומפקטית</label>`
      )}
      ${compactView
        ? dsCard({
            title: 'רשימת פעילויות',
            badge: `${safeRows.length} שורות`,
            body: compactSection,
            padded: true
          })
        : dsCard({
            title: 'רשימת פעילויות',
            badge: `${safeRows.length} שורות`,
            body: tableSection,
            padded: false
          })}
    `);
  },
  bind({ root, state, rerender, rerenderActivitiesView }) {
    root.querySelectorAll('[data-tab]').forEach((node) => {
      node.addEventListener('click', () => {
        state.activityTab = node.dataset.tab;
        rerender();
      });
    });
    root.querySelector('#toggle-view')?.addEventListener('change', (event) => {
      state.activityView = event.target.checked ? 'compact' : 'table';
      if (typeof rerenderActivitiesView === 'function') {
        rerenderActivitiesView();
      } else {
        rerender();
      }
    });
  }
};
