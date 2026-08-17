import { api } from './api.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

const text = (value) => String(value ?? '').trim();

function legacyRecord(row = {}) {
  const employeeId = text(row.employee_id);
  const team = text(row.team);
  return {
    ID: text(row.record_id),
    Id: text(row.record_id),
    id: text(row.record_id),
    recordId: text(row.record_id),
    employeeId,
    EmployeeId: employeeId,
    empNum: employeeId,
    employeeName: text(row.employee_name),
    EmployeeName: text(row.employee_name),
    empName: text(row.employee_name),
    employmentType: text(row.employment_type),
    EmploymentType: text(row.employment_type),
    team,
    Team: team,
    attendanceDate: text(row.attendance_date),
    AttendanceDate: text(row.attendance_date),
    startTime: text(row.start_time),
    StartTime: text(row.start_time),
    endTime: text(row.end_time),
    EndTime: text(row.end_time),
    workHours: row.work_hours,
    WorkHours: row.work_hours,
    activityType: text(row.activity_type),
    ActivityType: text(row.activity_type),
    schoolName: text(row.school_name),
    SchoolName: text(row.school_name),
    municipality: text(row.municipality),
    Municipality: text(row.municipality),
    programName: text(row.program_name),
    ProgramName: text(row.program_name),
    sessionNumber: text(row.session_number),
    SessionNumber: text(row.session_number),
    totalExpenses: row.total_expenses,
    TotalExpenses: row.total_expenses,
    kilometers: row.kilometers,
    Kilometers: row.kilometers,
    expensesDetails: text(row.expenses_details),
    ExpensesDetails: text(row.expenses_details),
    notes: text(row.notes),
    Notes: text(row.notes),
    activityRowId: text(row.activity_row_id),
    activity_row_id: text(row.activity_row_id),
    activityNumericId: row.activity_numeric_id ?? null,
    activityNo: text(row.activity_no),
    activitySeason: text(row.activity_season),
    authorityId: row.authority_id ?? null,
    schoolId: row.school_id ?? null,
    semelMosad: row.semel_mosad ?? null,
    attachmentsNames: '',
    status: '',
    approvedBy: '',
    approvedDate: ''
  };
}

function syntheticEmployeesFromRecords(records = []) {
  const managers = new Map();
  const instructors = new Map();
  for (const row of records) {
    const employeeId = text(row.employeeId || row.EmployeeId || row.empNum);
    const employeeName = text(row.employeeName || row.EmployeeName || row.empName) || employeeId;
    const team = text(row.team || row.Team) || 'ללא מנהל משויך';
    if (employeeId && !instructors.has(employeeId)) {
      instructors.set(employeeId, {
        employeeId,
        EmployeeId: employeeId,
        employeeName,
        EmployeeName: employeeName,
        employmentType: text(row.employmentType || row.EmploymentType),
        EmploymentType: text(row.employmentType || row.EmploymentType),
        team,
        Team: team,
        role: 'instructor',
        Role: 'instructor'
      });
    }
    if (!managers.has(team)) {
      const managerId = `manager:${team}`;
      managers.set(team, {
        employeeId: managerId,
        EmployeeId: managerId,
        employeeName: team,
        EmployeeName: team,
        team,
        Team: team,
        role: 'manager',
        Role: 'manager'
      });
    }
  }
  return [...managers.values(), ...instructors.values()];
}

api.attendanceControlRecords = async function ({ employeeIds = [], fromDate = '', toDate = '' } = {}) {
  await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);
  const numericEmployeeIds = [...new Set((employeeIds || [])
    .map((value) => Number(text(value)))
    .filter((value) => Number.isSafeInteger(value) && value > 0))];
  const { data, error } = await supabase.rpc('get_payroll_attendance_records', {
    p_employee_ids: numericEmployeeIds.length ? numericEmployeeIds : null,
    p_from_date: text(fromDate) || null,
    p_to_date: text(toDate) || null
  });
  if (error) throw new Error(error.message || 'attendance_records_supabase_load_failed');
  return (Array.isArray(data) ? data : []).map(legacyRecord);
};

api.attendanceControlTeams = async function () {
  const records = await api.attendanceControlRecords();
  return syntheticEmployeesFromRecords(records);
};

api.attendanceControlUpdateRecord = async function (recordId, fields = {}) {
  const id = text(recordId);
  if (!id) throw new Error('חסר מזהה רשומת נוכחות לעדכון.');
  await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);
  const { data, error } = await supabase.rpc('update_payroll_attendance_record', {
    p_record_id: id,
    p_fields: fields && typeof fields === 'object' ? fields : {}
  });
  if (error) throw new Error(error.message || 'attendance_record_supabase_update_failed');
  if (data?.success === false) throw new Error(text(data.message || data.error) || 'עדכון רשומת נוכחות נכשל.');
  return data || { success: true, recordId: id };
};
