import { normalizeCalendarSector } from './school-calendar-logic.js';

/** Explicit user policy: availability never grants Friday permission. */
export function schedulingWeekendFailure({ date, profile = {}, activity = {}, availability = null }) {
  const day = new Date(`${String(date).slice(0, 10)}T12:00:00Z`).getUTCDay();
  if (day === 5 && profile.friday_allowed !== true) return 'friday_not_allowed';
  if (day === 6) {
    if (!['arab', 'druze'].includes(normalizeCalendarSector(activity.calendar_sector))) return 'saturday_sector';
    if (availability?.available !== true) return 'saturday_not_explicitly_available';
  }
  return null;
}
