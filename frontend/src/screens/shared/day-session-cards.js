import { escapeHtml } from './html.js';
import { dsInteractiveCard } from './layout.js';
import { formatDateHe } from './format-date.js';

/** Default per-card meta line: instructor names (matches the original month.js day drawer). */
export function defaultDaySessionMeta(item) {
  const names = [item.instructor_name, item.instructor_name_2]
    .filter((x) => x && String(x).trim())
    .join(' · ');
  return names || 'ללא מדריך';
}

/**
 * Day drawer content: list of session cards (week-style).
 * Shared between screens/month.js and the manager activity board so both
 * reuse the exact same drawer markup/interaction contract (`monthsession|date|RowID`).
 */
export function monthDayCardsHtml(items, date, options = {}) {
  if (!items.length) {
    return `<p class="ds-muted">אין פעילויות מתמשכות ביום זה.</p><p class="ds-muted">תאריך: ${escapeHtml(formatDateHe(date) || '')}</p>`;
  }
  const buildMeta = typeof options.metaText === 'function' ? options.metaText : defaultDaySessionMeta;
  const buildSubtitle = typeof options.subtitleText === 'function' ? options.subtitleText : null;
  return `<div class="ds-month-day-cards" dir="rtl">
    ${items.map((item) => `<div class="ds-week-session-wrap">${dsInteractiveCard({
      variant: 'session',
      action: `monthsession|${encodeURIComponent(date)}|${encodeURIComponent(item.RowID)}`,
      title: item.activity_name || 'ללא שם',
      subtitle: buildSubtitle ? (buildSubtitle(item) || '') : '',
      meta: buildMeta(item)
    })}</div>`).join('')}
  </div>`;
}
