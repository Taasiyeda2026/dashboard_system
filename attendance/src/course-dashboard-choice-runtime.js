import { supabase } from './api/client.js';
import {
  buildDashboardCourseOptions,
  resolveDashboardCourseChoice,
} from './services/activities-report.helpers.js';

export { buildDashboardCourseOptions, resolveDashboardCourseChoice };

export async function loadDashboardCourseRows(date) {
  if (!date) return [];
  const { data, error } = await supabase.rpc('av2_get_current_instructor_activity_choices_for_date', {
    p_date: date,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/** Per-form state: changing date/type invalidates selection and pending loads. */
export function createDashboardCourseChoiceState(loadRows = loadDashboardCourseRows) {
  let generation = 0;
  let date = '';
  let rows = [];
  let choice = null;
  return {
    invalidate() {
      generation += 1;
      date = '';
      rows = [];
      choice = null;
    },
    async load(nextDate) {
      const token = ++generation;
      date = nextDate;
      rows = [];
      choice = null;
      const result = await loadRows(nextDate);
      if (token !== generation || date !== nextDate) return null;
      rows = result;
      return buildDashboardCourseOptions(rows);
    },
    select(value, hints = {}) {
      choice = buildDashboardCourseOptions(rows).find((option) => option.value === value) || null;
      return resolveDashboardCourseChoice(choice, rows, hints);
    },
    get date() { return date; },
    get rows() { return rows; },
    get choice() { return choice; },
    get options() { return buildDashboardCourseOptions(rows); },
  };
}
