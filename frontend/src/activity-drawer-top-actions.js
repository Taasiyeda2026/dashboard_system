/**
 * Places 2027 activity commands in one compact, accessible header toolbar.
 * Reuses the real buttons so the existing edit/scheduling click handlers and
 * permission checks remain unchanged. No database operations.
 */
const ICONS = {
  scheduling: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
  edit: '<path d="m15 5 4 4M4 20l4.5-1 10-10a2.12 2.12 0 0 0-3-3l-10 10L4 20Z"/>',
  feedback: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3a8.5 8.5 0 0 1 8.5 8.5Z"/>'
};
function setIcon(button, icon, label) {
  if (!button || button.dataset.activityTopIcon === icon) return;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = button.ownerDocument.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  // Only internal static SVG paths defined above.
  svg.innerHTML = ICONS[icon];
  button.replaceChildren(svg);
  button.classList.add('activity-drawer__top-icon-action');
  button.dataset.activityTopIcon = icon;
  button.setAttribute('aria-label', label);
  button.title = label;
}
export function align2027ActivityDrawerTopActions(form) {
  if (form?.dataset?.activitySeason !== 'school_2027' || !form.classList?.contains('activity-drawer-inline-layout')) return false;
  const actions = form.querySelector('.activity-drawer__header-actions');
  if (!actions) return false;
  let changed = false;

  const scheduling = form.querySelector('[data-open-activity-scheduling]');
  if (scheduling) {
    setIcon(scheduling, 'scheduling', 'פתח שיבוץ');
    if (scheduling.parentElement !== actions) {
      actions.insertBefore(scheduling, actions.querySelector('[data-ui-close-drawer]'));
      changed = true;
    }
  }
  // Hide the now-empty 2027 handoff wrapper, rather than leaving a blank
  // assignment card in the content flow. The real button stays in the header.
  const schedulingHandoff = form.querySelector('.activity-drawer__scheduling-status--header-handoff-2027');
  if (schedulingHandoff) schedulingHandoff.hidden = !schedulingHandoff.querySelector('[data-open-activity-scheduling]');

  // The underlying button still handles starting edit via event delegation.
  const edit = form.querySelector('.activity-drawer__view-footer [data-action="start-edit"], .activity-drawer__header-actions [data-action="start-edit"]');
  if (edit) {
    setIcon(edit, 'edit', 'עריכת פעילות');
    if (edit.parentElement !== actions) {
      actions.insertBefore(edit, actions.querySelector('[data-ui-close-drawer]'));
      changed = true;
    }
  }

  const feedback = form.querySelector('[data-impact-feedback-open]');
  if (feedback) {
    setIcon(feedback, 'feedback', 'משובים');
    if (feedback.parentElement !== actions) {
      actions.insertBefore(feedback, actions.querySelector('[data-ui-close-drawer]'));
      changed = true;
    }
  }

  // The toolbar is RTL: the close button is the first icon at the left.
  // Place Edit immediately beside Close, followed by the remaining actions.
  // Only reorder when necessary so observer reruns do not mutate the DOM.
  const close = actions.querySelector('[data-ui-close-drawer]');
  if (edit && close && edit.nextElementSibling !== close) {
    actions.insertBefore(edit, close);
    changed = true;
  }

  // The view footer becomes redundant once Edit and Feedback live in the header.
  const footer = form.querySelector(':scope > .activity-drawer__view-footer');
  if (footer) footer.hidden = footer.childElementCount === 0;
  return changed;
}
