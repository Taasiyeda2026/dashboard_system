import { UI_ACTIVITY_FAMILY_LONG, UI_ACTIVITY_FAMILY_SHORT } from './shared/ui-hebrew.js';
import { dsPageHeader, dsCard, dsScreenStack, dsInteractiveCard } from './shared/layout.js';

export const dashboardScreen = {
  load: ({ api }) => api.dashboard(),
  render(data) {
    const totals = data.totals || {};
    const managers = Array.isArray(data.by_activity_manager) ? data.by_activity_manager : [];

    const managerCards = managers
      .map((row) =>
        dsInteractiveCard({
          action: `manager:${row.activity_manager || 'unassigned'}`,
          title: row.activity_manager || 'ללא שיוך',
          subtitle: `${UI_ACTIVITY_FAMILY_SHORT}: ${row.total_short} · ${UI_ACTIVITY_FAMILY_LONG}: ${row.total_long}`,
          meta: `סה״כ: ${row.total}`,
          variant: 'mini'
        })
      )
      .join('');

    const managersBlock = managers.length
      ? `<div class="ds-mini-grid">${managerCards}</div>`
      : '<div class="ds-empty"><p class="ds-empty__msg">אין נתונים להצגה</p></div>';

    const kpiItems = [
      {
        action: 'kpi:short',
        title: `${totals.total_short_activities || 0}`,
        subtitle: UI_ACTIVITY_FAMILY_SHORT
      },
      {
        action: 'kpi:long',
        title: `${totals.total_long_activities || 0}`,
        subtitle: UI_ACTIVITY_FAMILY_LONG
      },
      {
        action: 'kpi:instructors',
        title: `${totals.total_instructors || 0}`,
        subtitle: 'מדריכים'
      },
      {
        action: 'kpi:ending-month',
        title: `${totals.total_course_endings_current_month || 0}`,
        subtitle: 'מסיימים החודש'
      }
    ];
    const kpiGrid = `<div class="ds-kpi-grid">${kpiItems
      .map((item) =>
        dsInteractiveCard({
          action: item.action,
          title: item.title,
          subtitle: item.subtitle,
          variant: 'kpi'
        })
      )
      .join('')}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('לוח בקרה', 'תמונת מצב כללית')}
      ${kpiGrid}
      ${dsCard({
        title: 'פילוח לפי אחראי פעילות',
        badge: `${managers.length} רשומות`,
        body: managersBlock,
        padded: true
      })}
    `);
  },
  bind({ root, state, rerender, ui }) {
    const navigate = (preferred) => {
      const target = state.routes.includes(preferred) ? preferred : 'activities';
      state.route = target;
      rerender();
    };

    ui?.bindInteractiveCards(root, (action) => {
      if (!action) return;

      if (action === 'kpi:instructors') {
        navigate('instructors');
        return;
      }

      if (action === 'kpi:short') {
        state.activityQuickFamily = 'short';
        state.activityQuickManager = '';
        state.activityTab = 'all';
        navigate('activities');
        return;
      }

      if (action === 'kpi:long') {
        state.activityQuickFamily = 'long';
        state.activityQuickManager = '';
        state.activityTab = 'all';
        navigate('activities');
        return;
      }

      if (action === 'kpi:ending-month') {
        state.activityQuickFamily = 'long';
        state.activityQuickManager = '';
        state.activityTab = 'course';
        navigate('activities');
        return;
      }

      if (action.startsWith('manager:')) {
        state.activityQuickFamily = '';
        state.activityQuickManager = action.replace('manager:', '');
        state.activityTab = 'all';
        navigate('activities');
      }
    });
  }
};
