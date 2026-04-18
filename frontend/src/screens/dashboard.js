import { escapeHtml } from './shared/html.js';
import { UI_ACTIVITY_FAMILY_LONG, UI_ACTIVITY_FAMILY_SHORT } from './shared/ui-hebrew.js';
import { dsPageHeader, dsCard, dsScreenStack, dsInteractiveCard } from './shared/layout.js';

function goActivitiesDrill(state, patch) {
  state.route = 'activities';
  state.activityTab = patch.activityTab ?? 'all';
  state.activityFinanceStatus = patch.activityFinanceStatus ?? '';
  state.activityQuickFamily = patch.activityQuickFamily ?? '';
  state.activityQuickManager = patch.activityQuickManager ?? '';
  state.activityEndingCurrentMonth = !!patch.activityEndingCurrentMonth;
}

function filterKpiCards(cards, showOnlyNonzero) {
  const list = Array.isArray(cards) ? cards : [];
  if (!showOnlyNonzero) return list;
  return list.filter((c) => Number(c.value || 0) > 0);
}

export const dashboardScreen = {
  load: ({ api }) => api.dashboard(),
  render(data) {
    const managers = Array.isArray(data.by_activity_manager) ? data.by_activity_manager : [];
    const showOnly = !!data?.show_only_nonzero_kpis;
    const kpiCards = filterKpiCards(data?.kpi_cards, showOnly);

    const managerCards = managers
      .map((row) => {
        const meta = `${UI_ACTIVITY_FAMILY_SHORT}: ${row.total_short} · ${UI_ACTIVITY_FAMILY_LONG}: ${row.total_long} · סה״כ: ${row.total}`;
        return dsInteractiveCard({
          variant: 'mini',
          action: `manager|${encodeURIComponent(row.activity_manager)}`,
          title: row.activity_manager,
          meta
        });
      })
      .join('');

    const managersBlock = managers.length
      ? `<div class="ds-mini-grid">${managerCards}</div>`
      : '<div class="ds-empty"><p class="ds-empty__msg">אין נתונים להצגה</p></div>';

    const kpiHtml = kpiCards.length
      ? kpiCards
          .map((k) =>
            dsInteractiveCard({
              variant: 'kpi',
              action: k.action,
              title: k.title,
              subtitle: k.subtitle
            })
          )
          .join('')
      : '<p class="ds-muted">אין כרטיסי KPI להצגה (לפי מסנן &quot;ערך בלבד&quot;).</p>';

    return dsScreenStack(`
      ${dsPageHeader('לוח בקרה', 'תמונת מצב כללית — לחיצה מעבירה לעבודה')}
      <div class="ds-kpi-grid">${kpiHtml}</div>
      ${dsCard({
        title: 'פילוח לפי אחראי פעילות',
        badge: `${managers.length} רשומות`,
        body: managersBlock,
        padded: true
      })}
    `);
  },
  bind({ root, ui, state, rerender }) {
    ui.bindInteractiveCards(root, (action) => {
      if (action === 'kpi|short') {
        goActivitiesDrill(state, { activityQuickFamily: 'short' });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|long') {
        goActivitiesDrill(state, { activityQuickFamily: 'long' });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|instructors') {
        state.route = 'instructors';
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|endings') {
        goActivitiesDrill(state, { activityEndingCurrentMonth: true });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|active_courses') {
        goActivitiesDrill(state, { activityTab: 'course' });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|active_workshops') {
        goActivitiesDrill(state, { activityTab: 'workshop' });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|active_tours') {
        goActivitiesDrill(state, { activityTab: 'tour' });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|active_after_school') {
        goActivitiesDrill(state, { activityTab: 'after_school' });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|active_escape_room') {
        goActivitiesDrill(state, { activityTab: 'escape_room' });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|finance_open') {
        state.route = 'finance';
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|exceptions') {
        state.route = 'exceptions';
        ui.closeAll();
        rerender();
        return;
      }
      if (action.startsWith('manager|')) {
        const name = decodeURIComponent(action.slice('manager|'.length));
        goActivitiesDrill(state, { activityQuickManager: name });
        ui.closeAll();
        rerender();
      }
    });
  }
};
