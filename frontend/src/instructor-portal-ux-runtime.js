/* Instructor portal presentation enhancer.
 * Keeps navigation and calendar behavior consistent across desktop/mobile while
 * leaving the underlying route and data logic untouched.
 */

const NAV_ICONS = {
  'בית': '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 10.8 12 3l9 7.8v9.2a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'פעילויות': '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 5h11M8 12h11M8 19h11M4.5 5h.01M4.5 12h.01M4.5 19h.01" stroke-width="1.9" stroke-linecap="round"/></svg>',
  'לוח שנה': '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" stroke-width="1.8"/><path d="M7 3v4M17 3v4M3 9h18" stroke-width="1.8" stroke-linecap="round"/></svg>',
  'דיווחים': '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7" stroke-width="2" stroke-linecap="round"/></svg>'
};

function localIsoDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function enhanceInstructorNavigation(root = document) {
  const shell = root.querySelector?.('.app-shell--instructor') || (root.matches?.('.app-shell--instructor') ? root : null);
  if (!shell) return;

  // Attendance and presentations stay available as dashboard shortcuts; the
  // persistent navigation carries only the four core portal destinations.
  shell.querySelectorAll('.instructor-bottom-nav__btn[data-external-url], .instructor-bottom-nav__btn[data-external-url-blank], .shell-sidebar--instructor .shell-nav__btn[data-external-url], .shell-sidebar--instructor .shell-nav__btn[data-external-url-blank]')
    .forEach((node) => { node.hidden = true; node.setAttribute('aria-hidden', 'true'); });

  shell.querySelectorAll('.instructor-bottom-nav__btn').forEach((button) => {
    if (button.hidden) return;
    const label = String(button.querySelector('.instructor-bottom-nav__label')?.textContent || '').trim();
    const icon = button.querySelector('.instructor-bottom-nav__icon');
    if (icon && NAV_ICONS[label] && icon.dataset.vectorized !== '1') {
      icon.innerHTML = NAV_ICONS[label];
      icon.dataset.vectorized = '1';
    }
  });
}

function enhanceInstructorCalendar(root = document) {
  const today = localIsoDate();
  root.querySelectorAll?.(`.app-shell--instructor .route-instructor-calendar [data-calendar-date="${today}"]`).forEach((slot) => {
    slot.dataset.currentDay = 'true';
    const card = slot.querySelector('.ds-interactive-card--day-cell');
    if (!card) return;
    card.classList.add('is-instructor-today');
    card.setAttribute('aria-current', 'date');
  });
}

function enhance(root = document) {
  enhanceInstructorNavigation(root);
  enhanceInstructorCalendar(root);
}

function boot() {
  enhance(document);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        enhance(node);
        if (node.querySelector?.('.app-shell--instructor, .route-instructor-calendar, .instructor-bottom-nav')) enhance(document);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
