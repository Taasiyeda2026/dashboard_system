import { escapeHtml } from './shared/html.js';
import { UI_ACTIVITY_FAMILY_LONG, UI_ACTIVITY_FAMILY_SHORT } from './shared/ui-hebrew.js';
import { dsPageHeader, dsCard, dsScreenStack, dsInteractiveCard } from './shared/layout.js';

export const dashboardScreen = {
  load: ({ api }) => api.dashboard(),
  render(data) {
    const totals = data.totals || {};
    const managers = Array.isArray(data.by_activity_manager) ? data.by_activity_manager : [];

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

    const kpiDefs = [
      { action: 'kpi|short', title: String(totals.total_short_activities || 0), subtitle: UI_ACTIVITY_FAMILY_SHORT },
      { action: 'kpi|long', title: String(totals.total_long_activities || 0), subtitle: UI_ACTIVITY_FAMILY_LONG },
      { action: 'kpi|instructors', title: String(totals.total_instructors || 0), subtitle: 'מדריכים' },
      {
        action: 'kpi|endings',
        title: String(totals.total_course_endings_current_month || 0),
        subtitle: 'מסיימים החודש'
      }
    ];

    const kpiHtml = kpiDefs
      .map((k) =>
        dsInteractiveCard({
          variant: 'kpi',
          action: k.action,
          title: k.title,
          subtitle: k.subtitle
        })
      )
      .join('');

    return dsScreenStack(`
      ${dsPageHeader('לוח בקרה', 'תמונת מצב כללית')}
      <div class="ds-kpi-grid">${kpiHtml}</div>
      ${dsCard({
        title: 'פילוח לפי אחראי פעילות',
        badge: `${managers.length} רשומות`,
        body: managersBlock,
        padded: true
      })}
    `);
  },
  bind({ root, ui }) {
    ui.bindInteractiveCards(root, (action) => {
      if (action.startsWith('kpi|')) {
        const key = action.slice(4);
        const titles = {
          short: 'סיכום — פעילויות קצרות',
          long: 'סיכום — פעילויות ארוכות',
          instructors: 'סיכום — מדריכים',
          endings: 'סיכום — מסיימים החודש'
        };
        ui.openDrawer({
          title: titles[key] || 'סיכום',
          content: '<p class="ds-muted">תצוגת פירוט בסיסית. ניתוב למסכים מסוננים יתווסף בהמשך.</p>'
        });
        return;
      }
      if (action.startsWith('manager|')) {
        const name = decodeURIComponent(action.slice('manager|'.length));
        ui.openDrawer({
          title: 'אחראי פעילות',
          content: `<p><strong>${escapeHtml(name)}</strong></p><p class="ds-muted">פירוט מלא וסינון לפי אחראי יתווספו בהמשך.</p>`
        });
      }
    });
  }
};
