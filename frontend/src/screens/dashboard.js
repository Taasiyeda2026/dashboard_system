import { escapeHtml } from './shared/html.js';
import { UI_ACTIVITY_FAMILY_LONG, UI_ACTIVITY_FAMILY_SHORT } from './shared/ui-hebrew.js';
import { dsPageHeader, dsKpiGrid, dsCard, dsScreenStack } from './shared/layout.js';

export const dashboardScreen = {
  load: ({ api }) => api.dashboard(),
  render(data) {
    const totals = data.totals || {};
    const managers = Array.isArray(data.by_activity_manager) ? data.by_activity_manager : [];

    const managerCards = managers
      .map(
        (row) => `
      <article class="ds-mini-card">
        <h4>${escapeHtml(row.activity_manager)}</h4>
        <div class="ds-mini-chips">
          <span class="ds-chip ds-chip--neutral">${UI_ACTIVITY_FAMILY_SHORT}: ${row.total_short}</span>
          <span class="ds-chip ds-chip--neutral">${UI_ACTIVITY_FAMILY_LONG}: ${row.total_long}</span>
          <span class="ds-chip ds-chip--neutral">סה״כ: ${row.total}</span>
        </div>
      </article>`
      )
      .join('');

    const managersBlock = managers.length
      ? `<div class="ds-mini-grid">${managerCards}</div>`
      : '<div class="ds-empty"><p class="ds-empty__msg">אין נתונים להצגה</p></div>';

    const kpiItems = [
      { label: UI_ACTIVITY_FAMILY_SHORT, value: totals.total_short_activities || 0 },
      { label: UI_ACTIVITY_FAMILY_LONG, value: totals.total_long_activities || 0 },
      { label: 'מדריכים', value: totals.total_instructors || 0 },
      { label: 'מסיימים החודש', value: totals.total_course_endings_current_month || 0 }
    ];

    return dsScreenStack(`
      ${dsPageHeader('לוח בקרה', 'תמונת מצב כללית')}
      ${dsKpiGrid(kpiItems)}
      ${dsCard({
        title: 'פילוח לפי אחראי פעילות',
        badge: `${managers.length} רשומות`,
        body: managersBlock,
        padded: true
      })}
    `);
  }
};
