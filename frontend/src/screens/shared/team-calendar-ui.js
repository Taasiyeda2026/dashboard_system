import { loadTeamCalendarRows } from './team-calendar-data.js';

const MAX_VISIBLE_TASKS = 4;
let decorationTimer = null;

function text(value) {
  return String(value == null ? '' : value).trim();
}

export function teamCalendarEventsForDate(rows, isoDate) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.is_active !== false && text(row?.event_date).slice(0, 10) === isoDate)
    .filter((row) => {
      const key = text(row.external_key) || `${isoDate}|${text(row.title)}|${text(row.owner_name)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
}

function taskText(row) {
  const owner = text(row.owner_name);
  return owner ? `${text(row.title)} · ${owner}` : text(row.title);
}

function taskList(documentRef, rows, isoDate, { expanded = false } = {}) {
  const container = documentRef.createElement('div');
  container.className = 'team-calendar-tasks';
  container.dataset.teamCalendarDate = isoDate;
  const visible = expanded ? rows : rows.slice(0, MAX_VISIBLE_TASKS);
  visible.forEach((row) => {
    const item = documentRef.createElement('span');
    item.className = 'team-calendar-task';
    item.textContent = `✓ ${taskText(row)}`;
    item.title = taskText(row);
    container.appendChild(item);
  });
  if (!expanded && rows.length > MAX_VISIBLE_TASKS) {
    const more = documentRef.createElement('button');
    more.type = 'button';
    more.className = 'team-calendar-more';
    more.dataset.teamCalendarMore = isoDate;
    more.textContent = `ועוד ${rows.length - MAX_VISIBLE_TASKS}`;
    more.setAttribute('aria-label', `הצגת כל ${rows.length} משימות הצוות`);
    container.appendChild(more);
  }
  return container;
}

function monthSpec(documentRef) {
  const label = text(documentRef.querySelector('#app .ds-cal-nav__label')?.textContent);
  const names = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const month = names.findIndex((name) => label.includes(name)) + 1;
  const year = Number(label.match(/\b(20\d{2})\b/)?.[1]);
  return month && year ? { month, year } : null;
}

export function decorateTeamCalendar(root, rows) {
  const documentRef = root.ownerDocument || root;
  const spec = monthSpec(documentRef);
  if (spec) {
    root.querySelectorAll('.ds-cal-grid .ds-cal-slot-hit:not(.is-other-month)').forEach((slot) => {
      slot.querySelector('[data-team-calendar-date]')?.remove();
      const card = slot.querySelector('.ds-interactive-card--day-cell');
      const day = Number(card?.querySelector('.ds-interactive-card__title')?.textContent);
      if (!card || !day) return;
      const isoDate = `${spec.year}-${String(spec.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const events = teamCalendarEventsForDate(rows, isoDate);
      if (events.length) card.appendChild(taskList(documentRef, events, isoDate));
    });
  }
  root.querySelectorAll('.ds-week-col[aria-label]').forEach((column) => {
    column.querySelector('[data-team-calendar-date]')?.remove();
    const isoDate = text(column.getAttribute('aria-label')).slice(0, 10);
    const events = teamCalendarEventsForDate(rows, isoDate);
    if (events.length) column.querySelector('.ds-week-col__body')?.prepend(taskList(documentRef, events, isoDate));
  });
}

function ensureStyles(documentRef) {
  if (documentRef.getElementById('team-calendar-styles')) return;
  const style = documentRef.createElement('style');
  style.id = 'team-calendar-styles';
  style.textContent = `
    .team-calendar-tasks{display:grid;gap:2px;margin-top:3px;min-width:0}
    .team-calendar-task{display:block;padding:2px 4px;border-inline-start:3px solid #0891b2;border-radius:4px;background:#ecfeff;color:#164e63;font-size:.58rem;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .team-calendar-more{border:0;background:transparent;color:#0e7490;font:inherit;font-size:.6rem;font-weight:700;text-align:start;cursor:pointer;padding:1px 4px}
  `;
  documentRef.head.appendChild(style);
}

async function decorate(documentRef) {
  const app = documentRef.getElementById('app');
  if (!app?.querySelector('.ds-cal-grid, .ds-week-col')) return;
  decorateTeamCalendar(app, await loadTeamCalendarRows());
}

export function startTeamCalendarUi(scope = globalThis) {
  if (scope.__TEAM_CALENDAR_UI_STARTED__ || !scope.document) return;
  scope.__TEAM_CALENDAR_UI_STARTED__ = true;
  const documentRef = scope.document;
  ensureStyles(documentRef);
  const schedule = () => {
    clearTimeout(decorationTimer);
    decorationTimer = setTimeout(() => void decorate(documentRef), 40);
  };
  documentRef.getElementById('app')?.addEventListener('click', async (event) => {
    const button = event.target.closest?.('[data-team-calendar-more]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const rows = teamCalendarEventsForDate(await loadTeamCalendarRows(), button.dataset.teamCalendarMore);
    button.closest('[data-team-calendar-date]')?.replaceWith(taskList(documentRef, rows, button.dataset.teamCalendarMore, { expanded: true }));
  });
  const app = documentRef.getElementById('app');
  if (app && typeof scope.MutationObserver === 'function') {
    new scope.MutationObserver((mutations) => {
      if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => node.nodeType === 1 && (node.matches?.('.ds-cal-grid, .ds-week-col') || node.querySelector?.('.ds-cal-grid, .ds-week-col'))))) schedule();
    }).observe(app, { childList: true, subtree: true });
  }
  schedule();
}
