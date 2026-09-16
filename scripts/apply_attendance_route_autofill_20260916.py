from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)


edge_path = Path('supabase/functions/scheduling-route/index.ts')
edge = edge_path.read_text(encoding='utf-8')

edge = replace_once(
    edge,
    "async function loadPayrollMonthPairs(db: DbClient, month: string) {\n  const range = payrollMonthRange(month);\n  if (!range) return { error: 'invalid_payroll_month' as const };\n\n  const dateColumns = Array.from({ length: 35 }, (_, index) => `date_${index + 1}`).join(',');",
    "async function loadPayrollMonthPairs(db: DbClient, month: string, employeeIds: number[] = []) {\n  const range = payrollMonthRange(month);\n  if (!range) return { error: 'invalid_payroll_month' as const };\n  const employeeFilter = new Set(employeeIds.filter((id) => Number.isInteger(id) && id > 0));\n  const employeeAllowed = (empId: number) => employeeFilter.size === 0 || employeeFilter.has(empId);\n\n  const dateColumns = Array.from({ length: 35 }, (_, index) => `date_${index + 1}`).join(',');",
    'payroll month signature/filter'
)

edge = replace_once(
    edge,
    "  const [activitiesResult, cancellationsResult, schoolsResult, contactsResult] = await Promise.all([",
    "  const attendanceBaseQuery = db\n    .from('attendance_records')\n    .select('id,emp_id,activity_row_id,report_date,start_time,activity_type,activity_name_snapshot,authority_id,authority_name_snapshot,school_id,school_name_snapshot,program_name,generation_kind')\n    .gte('report_date', range.fromDate)\n    .lte('report_date', range.toDate);\n  const attendancePromise = employeeFilter.size\n    ? attendanceBaseQuery.in('emp_id', [...employeeFilter])\n    : attendanceBaseQuery;\n\n  const [activitiesResult, cancellationsResult, schoolsResult, contactsResult, attendanceResult] = await Promise.all([",
    'attendance query setup'
)

edge = replace_once(
    edge,
    "    loadAllRows(db, 'contacts_schools', 'school_id,address')\n  ]);",
    "    loadAllRows(db, 'contacts_schools', 'school_id,address'),\n    attendancePromise\n  ]);",
    'attendance query promise'
)

edge = replace_once(
    edge,
    "  if (contactsResult.error) return { error: 'payroll_school_catalog_lookup_failed' as const };\n\n  const cancelledByActivity",
    "  if (contactsResult.error) return { error: 'payroll_school_catalog_lookup_failed' as const };\n  if (attendanceResult.error) return { error: 'payroll_activity_lookup_failed' as const };\n\n  const cancelledByActivity",
    'attendance query error'
)

start = edge.index('async function loadPayrollMonthPairs')
end = edge.index('async function mapWithConcurrency', start)
section = edge[start:end]
count = section.count('const empIds = assignedPayrollEmpIds(activity);')
if count != 2:
    raise RuntimeError(f'employee filtering: expected 2 assignedPayrollEmpIds sites, found {count}')
section = section.replace(
    'const empIds = assignedPayrollEmpIds(activity);',
    'const empIds = assignedPayrollEmpIds(activity).filter(employeeAllowed);'
)
edge = edge[:start] + section + edge[end:]

edge = replace_once(
    edge,
    "  const instructorByEmpId = new Map<number, InstructorRow>();",
    "  const attendanceRows = ((attendanceResult.data || []) as Record<string, unknown>[]).filter((row) => {\n    const empId = numericEmpId(row.emp_id);\n    if (!empId || !employeeAllowed(empId)) return false;\n    if (text(row.generation_kind) === 'travel_time_cancellation') return false;\n    if (/ביטול\\s*זמן/u.test(text(row.activity_type))) return false;\n    return true;\n  });\n  for (const row of attendanceRows) {\n    const empId = numericEmpId(row.emp_id);\n    if (empId) assignedIds.add(empId);\n  }\n\n  const instructorByEmpId = new Map<number, InstructorRow>();",
    'attendance instructor ids'
)

edge = replace_once(
    edge,
    "  const catalog = buildPayrollSchoolCatalog(schoolsResult.rows, contactsResult.rows);",
    "  const catalog = buildPayrollSchoolCatalog(schoolsResult.rows, contactsResult.rows);\n  const activityByRowId = new Map(activitiesResult.rows\n    .map((row) => [text(row.row_id || row.id), row] as const)\n    .filter(([id]) => Boolean(id)));",
    'activity lookup for attendance fallback'
)

attendance_actual_day = r'''
  // Add the routes implied by the ACTUAL attendance day. This complements the
  // scheduled-month plan above and is the source of truth for attendance validation:
  // home -> first reported physical activity -> next activity -> ... -> home.
  const attendanceDayStops = new Map<string, Array<{
    empId: number;
    date: string;
    start_time: string;
    school: PayrollSchool;
    instructor?: InstructorRow;
  }>>();

  for (const row of attendanceRows) {
    const empId = numericEmpId(row.emp_id);
    const date = isoDate(row.report_date);
    if (!empId || !date) continue;
    instructorIds.add(empId);

    const linkedActivity = activityByRowId.get(text(row.activity_row_id)) || {};
    const schoolSource: Record<string, unknown> = {
      school_id: row.school_id ?? linkedActivity.school_id ?? null,
      authority_id: row.authority_id ?? linkedActivity.authority_id ?? null,
      authority: text(row.authority_name_snapshot || linkedActivity.authority),
      school: text(row.school_name_snapshot || linkedActivity.school)
    };
    const remoteProbe: Record<string, unknown> = {
      school: schoolSource.school,
      activity_name: text(row.activity_name_snapshot || row.program_name)
    };
    if (isRemotePayrollActivity(remoteProbe)) continue;

    const attendanceId = `attendance:${text(row.id) || `${empId}:${date}:${text(row.start_time)}`}`;
    const resolved = resolvePayrollActivitySchool(schoolSource, catalog);
    if (resolved.status !== 'resolved' || !resolved.school) {
      if (resolved.status === 'ambiguous') ambiguousActivities.add(attendanceId);
      else unresolvedActivities.add(attendanceId);
      exceptions.push({
        activity_id: attendanceId,
        date,
        authority: text(schoolSource.authority),
        school: text(schoolSource.school),
        reason: resolved.reason
      });
      continue;
    }

    const school = resolved.school;
    locations.set(school.entity_key || schoolEntityKey(school), school);
    const instructor = instructorByEmpId.get(empId);
    if (!text(instructor?.address)) {
      missingInstructorIds.add(empId);
      exceptions.push({
        activity_id: attendanceId,
        date,
        authority: text(schoolSource.authority),
        school: text(schoolSource.school),
        reason: 'missing_instructor_address'
      });
    }

    const key = `${empId}|${date}`;
    const stops = attendanceDayStops.get(key) || [];
    stops.push({ empId, date, start_time: text(row.start_time), school, instructor });
    attendanceDayStops.set(key, stops);
  }

  for (const stops of attendanceDayStops.values()) {
    stops.sort((a, b) => a.start_time.localeCompare(b.start_time));
    const sequence: typeof stops = [];
    for (const stop of stops) {
      const last = sequence[sequence.length - 1];
      const key = stop.school.entity_key || schoolEntityKey(stop.school);
      if (last && (last.school.entity_key || schoolEntityKey(last.school)) === key) continue;
      sequence.push(stop);
    }
    if (!sequence.length) continue;
    const instructor = sequence[0].instructor;
    if (instructor) addPair(payrollInstructorSchoolPair(instructor, sequence[0].school));
    for (let index = 1; index < sequence.length; index += 1) {
      addPair(payrollSchoolSchoolPair(sequence[index - 1].school, sequence[index].school));
    }
    if (instructor) addPair(payrollInstructorSchoolPair(instructor, sequence[sequence.length - 1].school));
  }

'''
edge = replace_once(
    edge,
    "  const uniqueExceptions = [];",
    attendance_actual_day + "  const uniqueExceptions = [];",
    'actual attendance day route plan'
)

edge = replace_once(
    edge,
    "    const loaded = await loadPayrollMonthPairs(db, month);",
    "    const employeeIds = Array.isArray(payload.employee_ids)\n      ? [...new Set((payload.employee_ids as unknown[])\n        .map(numericEmpId)\n        .filter((id): id is number => id != null))]\n      : [];\n    const loaded = await loadPayrollMonthPairs(db, month, employeeIds);",
    'payroll build employee filter'
)

edge_path.write_text(edge, encoding='utf-8')

api_path = Path('frontend/src/api.js')
api = api_path.read_text(encoding='utf-8')

auto_fill = r'''    const routeMonth = /^\d{4}-\d{2}-\d{2}$/.test(fromDate)
      && /^\d{4}-\d{2}-\d{2}$/.test(toDate)
      && fromDate.slice(0, 7) === toDate.slice(0, 7)
      ? fromDate.slice(0, 7)
      : '';
    const routeEmployeeIds = ids.map(Number).filter((value) => Number.isInteger(value) && value > 0);
    if (routeMonth && routeEmployeeIds.length && supabase?.functions?.invoke) {
      try {
        const invokeRouteBuild = async (body) => {
          const { data, error } = await supabase.functions.invoke('scheduling-route', { body });
          if (error) throw error;
          if (data?.error) throw new Error(String(data.error));
          return data || {};
        };
        const routeScope = {
          scope: 'payroll_month',
          month: routeMonth,
          employee_ids: routeEmployeeIds
        };
        const coverage = await invokeRouteBuild({ mode: 'coverage', ...routeScope });
        if ((Number(coverage?.missing_count) || 0) > 0) {
          let cursor = null;
          for (let batchNo = 0; batchNo < 50; batchNo += 1) {
            const batch = await invokeRouteBuild({
              mode: 'build_cache',
              ...routeScope,
              cursor,
              limit: 40
            });
            cursor = batch?.next_cursor || null;
            if (batch?.done || !cursor) break;
          }
        }
      } catch (error) {
        // Route completion is best-effort: existing cache remains usable and unresolved
        // segments stay visible for manager review instead of blocking attendance control.
        console.warn('[attendance-control] automatic route completion failed:', error);
      }
    }
'''
api = replace_once(
    api,
    "    if (!ids.length || !fromDate || !toDate) return { activities: [], contacts: [], travelCache: [], expenses: [] };\n    const activitySelect = `${ACTIVITY_OPERATIONS_COLUMNS},authority_id,activity_no`;",
    "    if (!ids.length || !fromDate || !toDate) return { activities: [], contacts: [], travelCache: [], expenses: [] };\n" + auto_fill + "    const activitySelect = `${ACTIVITY_OPERATIONS_COLUMNS},authority_id,activity_no`;",
    'attendance route auto-fill'
)

api = replace_once(
    api,
    "    const schoolIds = [...new Set(activities.map((row) => Number(row.school_id)).filter(Number.isFinite))];\n    const routeReads = [];",
    "    const attendanceSchoolsResult = await supabase\n      .from('attendance_records')\n      .select('school_id')\n      .in('emp_id', ids)\n      .gte('report_date', fromDate)\n      .lte('report_date', toDate);\n    const attendanceSchoolIds = attendanceSchoolsResult.error\n      ? []\n      : (attendanceSchoolsResult.data || []).map((row) => Number(row.school_id)).filter(Number.isFinite);\n    const schoolIds = [...new Set([\n      ...activities.map((row) => Number(row.school_id)).filter(Number.isFinite),\n      ...attendanceSchoolIds\n    ])];\n    const routeReads = [];",
    'attendance school ids for route cache reads'
)

api_path.write_text(api, encoding='utf-8')

test_path = Path('tests/attendance-route-autofill.test.mjs')
test_path.write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const edge = await readFile(new URL('../supabase/functions/scheduling-route/index.ts', import.meta.url), 'utf8');
const api = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');

test('payroll route build includes actual attendance-day stops with stable school identity', () => {
  const fn = edge.split('async function loadPayrollMonthPairs')[1].split('async function mapWithConcurrency')[0];
  assert.match(fn, /from\('attendance_records'\)/);
  assert.match(fn, /activity_row_id/);
  assert.match(fn, /generation_kind/);
  assert.match(fn, /travel_time_cancellation/);
  assert.match(fn, /attendanceDayStops/);
  assert.match(fn, /row\.school_id \?\? linkedActivity\.school_id/);
  assert.match(fn, /resolvePayrollActivitySchool\(schoolSource, catalog\)/);
  assert.match(fn, /payrollSchoolSchoolPair\(sequence\[index - 1\]\.school, sequence\[index\]\.school\)/);
  assert.match(fn, /payrollInstructorSchoolPair\(instructor, sequence\[sequence\.length - 1\]\.school\)/);
});

test('route build can be scoped to only attendance-control employees', () => {
  assert.match(edge, /payload\.employee_ids/);
  assert.match(edge, /loadPayrollMonthPairs\(db, month, employeeIds\)/);
  const fn = edge.split('async function loadPayrollMonthPairs')[1].split('async function mapWithConcurrency')[0];
  assert.match(fn, /employeeFilter/);
  assert.match(fn, /assignedPayrollEmpIds\(activity\)\.filter\(employeeAllowed\)/);
});

test('attendance control auto-fills only missing monthly routes before reading the cache', () => {
  const fn = api.split('attendanceControlDashboardSources: async')[1].split('\n  },\n  activities: async')[0];
  assert.match(fn, /functions\.invoke\('scheduling-route'/);
  assert.match(fn, /mode: 'coverage'/);
  assert.match(fn, /missing_count/);
  assert.match(fn, /mode: 'build_cache'/);
  assert.match(fn, /scope: 'payroll_month'/);
  assert.match(fn, /employee_ids: routeEmployeeIds/);
  assert.match(fn, /limit: 40/);
});

test('attendance school ids participate in cache reads so actual-day school-to-school legs are available', () => {
  const fn = api.split('attendanceControlDashboardSources: async')[1].split('\n  },\n  activities: async')[0];
  assert.match(fn, /from\('attendance_records'\)[\s\S]*select\('school_id'\)/);
  assert.match(fn, /attendanceSchoolIds/);
  assert.match(fn, /origin_school_id/);
  assert.match(fn, /destination_school_id/);
});
''', encoding='utf-8')
