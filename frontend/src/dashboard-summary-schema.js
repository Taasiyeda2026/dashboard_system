import { resolveCourseSchedulingPeriod } from './screens/course-scheduling-periods.js';

const SCHEMAS = Object.freeze({
  semester_1_opening: Object.freeze({
    semesterKey: 'first', activityMetric: 'starting_current_month', showEndings: false,
    exceptions: Object.freeze(['missing_instructor', 'missing_start_date'])
  }),
  semester_1_running: Object.freeze({
    semesterKey: 'first', activityMetric: 'monthly_activities', showEndings: true,
    exceptions: Object.freeze(['missing_instructor', 'end_date_passed'])
  }),
  semester_2_opening: Object.freeze({
    semesterKey: 'second', activityMetric: 'starting_current_month', showEndings: true,
    exceptions: Object.freeze(['missing_instructor', 'missing_start_date', 'semester_1_unfinished'])
  }),
  semester_2_closing: Object.freeze({
    semesterKey: 'second', activityMetric: 'monthly_activities', showEndings: true,
    exceptions: Object.freeze(['missing_instructor', 'end_date_passed', 'end_date_after_cutoff'])
  })
});

export function dashboardSummarySchemaForMonth(ym = '') {
  const month = Number(String(ym).slice(5, 7));
  const schemaKey = month === 9 || month === 10
    ? 'semester_1_opening'
    : (month === 11 || month === 12 || month === 1)
      ? 'semester_1_running'
      : (month === 2 || month === 3)
        ? 'semester_2_opening'
        : 'semester_2_closing';
  const schema = SCHEMAS[schemaKey];
  return Object.freeze({ ...schema, key: schemaKey, semester: resolveCourseSchedulingPeriod(schema.semesterKey) });
}
