import { api } from './api.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

// Internal RPC/API names stay `payroll-attendance*` for backward compatibility.
// User-facing screens use "בקרת נוכחות".

const text = (value) => String(value ?? '').trim();

function attachmentList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeAttachments(raw = []) {
  return attachmentList(raw)
    .map((item) => ({
      id: text(item.id || item.attachmentId),
      fileName: text(item.fileName || item.file_name || item.name),
      storagePath: text(item.storagePath || item.storage_path || item.path),
      fileType: text(item.fileType || item.file_type || item.type),
      fileSize: item.fileSize ?? item.file_size ?? null
    }))
    .filter((item) => item.fileName || item.storagePath);
}

function legacyRecord(row = {}, travel = null, { generated = false, location = null } = {}) {
  const employeeId = text(row.employee_id);
  const team = text(row.team);
  const attachments = normalizeAttachments(row.attachments);
  const attachmentsNames = attachments.map((item) => item.fileName).filter(Boolean).join(', ');
  const publicTransport = row.public_transport === true || row.public_transport === 'true' || row.public_transport === 1;
  const publicTransportCost = row.public_transport_cost ?? 0;
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
    trainingMode: text(row.training_mode),
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
    publicTransport,
    PublicTransport: publicTransport,
    public_transport: publicTransport,
    publicTransportCost,
    PublicTransportCost: publicTransportCost,
    public_transport_cost: publicTransportCost,
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
    originAddress: text(location?.origin_address),
    destinationAddress: text(location?.destination_address),
    destinationEntityKey: text(location?.destination_entity_key),
    destinationType: text(location?.destination_type),
    isRemoteDestination: location?.is_remote === true,
    sourceAttendanceRecordId: text(travel?.source_record_id),
    generationKind: generated ? 'travel_time_cancellation' : '',
    travelCalculationStatus: text(travel?.calculation_status),
    travelFailureCode: text(travel?.failure_code),
    outboundTravelMinutes: travel?.outbound_travel_minutes ?? null,
    returnTravelMinutes: travel?.return_travel_minutes ?? null,
    calculatedCancellationMinutes: travel?.calculated_cancellation_minutes ?? null,
    finalCancellationMinutes: travel?.final_cancellation_minutes ?? null,
    approvedCancellationMinutes: travel?.approved_cancellation_minutes ?? null,
    reviewStatus: text(travel?.review_status),
    reportedOutboundMinutes: travel?.reported_outbound_minutes ?? null,
    reportedReturnMinutes: travel?.reported_return_minutes ?? null,
    reportedCancellationBeforeMinutes: travel?.reported_before_cancellation_minutes ?? null,
    reportedCancellationAfterMinutes: travel?.reported_after_cancellation_minutes ?? null,
    manuallyOverridden: travel?.manually_overridden === true
      || text(travel?.review_status) === 'corrected',
    overrideByName: text(travel?.override_by_name),
    overrideAt: text(travel?.override_at),
    attachments,
    attachmentsNames,
    AttachmentsNames: attachmentsNames,
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

function rosterRecord(row = {}) {
  return {
    employeeId: text(row.employee_id),
    employeeName: text(row.employee_name),
    employmentType: text(row.employment_type),
    team: text(row.team),
  };
}

function legacyRecordsFromSnapshotParts(records = [], travelRows = [], locationRows = []) {
  const locationByRecord = new Map((Array.isArray(locationRows) ? locationRows : [])
    .map((item) => [text(item.record_id), item])
    .filter(([recordId]) => recordId));
  const travelByGenerated = new Map((Array.isArray(travelRows) ? travelRows : [])
    .map((item) => [text(item.generated_record_id), item])
    .filter(([recordId]) => recordId));
  const travelBySource = new Map((Array.isArray(travelRows) ? travelRows : [])
    .map((item) => [text(item.source_record_id), item])
    .filter(([recordId]) => recordId));

  return (Array.isArray(records) ? records : []).map((row) => {
    const recordId = text(row.record_id);
    const attendanceDate = text(row.attendance_date || row.date || row.report_date).slice(0, 10);
    // Manager/admin Nov+ control uses daily-travel reports; do not surface legacy
    // compensation rows in the review model (DB rows remain untouched).
    const useLegacyTravel = !attendanceDate || attendanceDate < '2026-11-01';
    const generatedTravel = useLegacyTravel ? (travelByGenerated.get(recordId) || null) : null;
    const sourceTravel = useLegacyTravel ? (travelBySource.get(recordId) || null) : null;
    return legacyRecord(row, generatedTravel || sourceTravel, {
      generated: Boolean(generatedTravel),
      location: locationByRecord.get(recordId) || null
    });
  });
}

api.attendanceControlRecords = async function ({ employeeIds = [], fromDate = '', toDate = '' } = {}) {
  await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);
  const numericEmployeeIds = [...new Set((employeeIds || [])
    .map((value) => Number(text(value)))
    .filter((value) => Number.isSafeInteger(value) && value > 0))];
  const params = {
    p_employee_ids: numericEmployeeIds.length ? numericEmployeeIds : null,
    p_from_date: text(fromDate) || null,
    p_to_date: text(toDate) || null
  };
  const [{ data, error }, travelResult, locationResult] = await Promise.all([
    supabase.rpc('get_payroll_attendance_records', params),
    supabase.rpc('get_payroll_attendance_travel_compensations', params),
    supabase.rpc('get_payroll_attendance_location_contexts', params)
  ]);
  if (error) throw new Error(error.message || 'attendance_records_supabase_load_failed');
  if (travelResult.error) throw new Error(travelResult.error.message || 'attendance_travel_compensations_load_failed');
  if (locationResult.error) throw new Error(locationResult.error.message || 'attendance_location_contexts_load_failed');
  return legacyRecordsFromSnapshotParts(
    Array.isArray(data) ? data : [],
    Array.isArray(travelResult.data) ? travelResult.data : [],
    Array.isArray(locationResult.data) ? locationResult.data : []
  );
};

api.managerAttendanceReviewSnapshot = async function ({ employeeId = '', monthKey = '' } = {}) {
  await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);
  const numericEmployeeId = Number(text(employeeId));
  const month = text(monthKey);
  if (!Number.isSafeInteger(numericEmployeeId) || numericEmployeeId <= 0) throw new Error('invalid_employee_id');
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('invalid_month_key');

  const { data, error } = await supabase.rpc('get_manager_attendance_review_snapshot', {
    p_employee_id: numericEmployeeId,
    p_month_key: month
  });
  if (error) throw new Error(error.message || 'manager_attendance_review_snapshot_failed');
  const payload = data && typeof data === 'object' ? data : {};
  const records = legacyRecordsFromSnapshotParts(
    payload.records,
    payload.travel_compensations,
    payload.locations
  );

  return {
    employeeId: text(payload.employee_id || numericEmployeeId),
    monthKey: text(payload.month_key || month),
    records,
    sources: {
      activities: Array.isArray(payload.activities) ? payload.activities : [],
      courseActivities: Array.isArray(payload.course_activities) ? payload.course_activities : null,
      contacts: Array.isArray(payload.contacts) ? payload.contacts : [],
      travelCache: Array.isArray(payload.travel_cache) ? payload.travel_cache : [],
      expenses: Array.isArray(payload.expenses) ? payload.expenses : [],
      schoolLookup: { list: Array.isArray(payload.schools) ? payload.schools : [] },
      authorityLookup: { list: Array.isArray(payload.authorities) ? payload.authorities : [] },
      proposalGroupAliases: Array.isArray(payload.proposal_group_aliases) ? payload.proposal_group_aliases : [],
      trainingSchedule: Array.isArray(payload.training_schedule) ? payload.training_schedule : [],
      expenseSourceAvailable: true,
      travelSourceAvailable: true
    },
    approvals: Array.isArray(payload.approvals) ? payload.approvals : [],
    workflow: Array.isArray(payload.workflow) ? payload.workflow : []
  };
};

api.attendanceControlTeams = async function ({ monthKey = '' } = {}) {
  await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);
  const month = text(monthKey);
  const hasMonth = /^20\d{2}-(0[1-9]|1[0-2])$/.test(month);
  const rpcName = hasMonth
    ? 'get_payroll_attendance_team_roster_for_month'
    : 'get_payroll_attendance_team_roster';
  const params = hasMonth ? { p_month_key: month } : undefined;
  const { data, error } = await supabase.rpc(rpcName, params);
  if (error) throw new Error(error.message || 'attendance_team_roster_supabase_load_failed');
  return syntheticEmployeesFromRecords((Array.isArray(data) ? data : []).map(rosterRecord));
};

function adminCorrectPatchFromFields(fields = {}) {
  const patch = {};
  if (Object.hasOwn(fields, 'startTime') || Object.hasOwn(fields, 'start_time')) {
    patch.start_time = fields.startTime ?? fields.start_time ?? null;
  }
  if (Object.hasOwn(fields, 'endTime') || Object.hasOwn(fields, 'end_time')) {
    patch.end_time = fields.endTime ?? fields.end_time ?? null;
  }
  if (Object.hasOwn(fields, 'workHours') || Object.hasOwn(fields, 'total_hours')) {
    patch.total_hours = fields.workHours ?? fields.total_hours ?? null;
  }
  if (Object.hasOwn(fields, 'kilometers') || Object.hasOwn(fields, 'roundtrip_km')) {
    patch.roundtrip_km = fields.kilometers ?? fields.roundtrip_km ?? null;
  }
  if (Object.hasOwn(fields, 'cancellationBeforeMinutes') || Object.hasOwn(fields, 'cancellation_before_minutes')) {
    patch.cancellation_before_minutes = fields.cancellationBeforeMinutes ?? fields.cancellation_before_minutes ?? null;
  }
  if (Object.hasOwn(fields, 'cancellationAfterMinutes') || Object.hasOwn(fields, 'cancellation_after_minutes')) {
    patch.cancellation_after_minutes = fields.cancellationAfterMinutes ?? fields.cancellation_after_minutes ?? null;
  }
  if (Object.hasOwn(fields, 'notes')) patch.notes = fields.notes ?? null;
  return patch;
}

api.attendanceControlUpdateRecord = async function (recordId, fields = {}) {
  const id = text(recordId);
  if (!id) throw new Error('חסר מזהה רשומת נוכחות לעדכון.');
  await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);
  const { data, error } = await supabase.rpc('update_payroll_attendance_record', {
    p_record_id: id,
    p_fields: fields && typeof fields === 'object' ? fields : {}
  });
  if (!error && data?.success !== false) return data || { success: true, recordId: id };

  const message = text(error?.message || data?.message || data?.error || '');
  const lockedMonth = /attendance_month_locked|attendance_month_not_submitted|attendance_permission_denied|manager_attendance/i.test(message);
  if (!lockedMonth) {
    if (error) throw new Error(error.message || 'attendance_record_supabase_update_failed');
    throw new Error(message || 'עדכון רשומת נוכחות נכשל.');
  }

  // Admin pinpoint path: correct without reopening the month.
  const { data: corrected, error: correctError } = await supabase.rpc('admin_correct_attendance_record', {
    p_record_id: id,
    p_patch: adminCorrectPatchFromFields(fields),
    p_reason: 'תיקון נקודתי ממסך בקרת נוכחות'
  });
  if (correctError) {
    throw new Error(
      /attendance_permission_denied|42501/i.test(text(correctError.message))
        ? (message || 'עדכון רשומת נוכחות נכשל.')
        : (correctError.message || 'תיקון נקודתי נכשל.')
    );
  }
  return { success: true, recordId: id, pinpoint: true, ...(corrected || {}) };
};

api.adminSetAttendancePayrollHold = async function ({ employee_id, month_key, hold = true, reason = '' } = {}) {
  await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);
  const { data, error } = await supabase.rpc('admin_set_attendance_payroll_hold', {
    p_employee_id: String(employee_id || '').trim(),
    p_month_key: String(month_key || '').trim(),
    p_hold: Boolean(hold),
    p_reason: String(reason || '').trim() || null
  });
  if (error) throw new Error(error.message || 'עדכון השהיית שכר נכשל.');
  return data;
};

api.attendanceControlCreateRecord = async function (employeeId, fields = {}) {
  const numericEmployeeId = Number(text(employeeId));
  if (!Number.isSafeInteger(numericEmployeeId) || numericEmployeeId <= 0) {
    throw new Error('חסר מספר עובד תקין להוספת דיווח נוכחות.');
  }
  await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);
  const { data, error } = await supabase.rpc('create_manager_attendance_record', {
    p_employee_id: numericEmployeeId,
    p_fields: fields && typeof fields === 'object' ? fields : {}
  });
  if (error) throw new Error(error.message || 'attendance_record_supabase_create_failed');
  if (data?.success === false) throw new Error(text(data.message || data.error) || 'הוספת דיווח הנוכחות נכשלה.');
  return data || { success: true, employeeId: String(numericEmployeeId) };
};

api.attendanceControlRecordReviews = async function ({ recordIds = [] } = {}) {
  const ids = [...new Set((Array.isArray(recordIds) ? recordIds : []).map(text).filter(Boolean))];
  if (!ids.length) return [];
  await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);
  const { data, error } = await supabase.rpc('get_manager_attendance_record_reviews', {
    p_record_ids: ids
  });
  if (error) throw new Error(error.message || 'attendance_record_reviews_load_failed');
  return Array.isArray(data) ? data : [];
};

api.attendanceControlApproveRecord = async function (recordId, approved = true) {
  const id = text(recordId);
  if (!id) throw new Error('חסר מזהה רשומת נוכחות לאישור.');
  await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);
  const { data, error } = await supabase.rpc('set_manager_attendance_record_review', {
    p_record_id: id,
    p_approved: approved !== false
  });
  if (error) throw new Error(error.message || 'attendance_record_review_save_failed');
  if (data?.success === false) throw new Error(text(data.message || data.error) || 'שמירת אישור הרשומה נכשלה.');
  return data || { success: true, recordId: id, approved: approved !== false };
};

api.attendanceControlAttachmentSignedUrl = async function (storagePath = '') {
  const path = text(storagePath);
  if (!path) throw new Error('חסר נתיב אסמכתא.');
  await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);
  const { data, error } = await supabase.storage
    .from('attendance-attachments')
    .createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message || 'attendance_attachment_signed_url_failed');
  return { signedUrl: text(data?.signedUrl) };
};


api.attendanceControlDailyTravelReports = async function ({employeeIds=[],fromDate='',toDate=''}={}) {
  await waitForSupabaseAuthSession({timeoutMs:7000}).catch(()=>null);
  const ids=[...new Set((employeeIds||[]).map(id=>Number(text(id))).filter(Number.isSafeInteger))];
  const {data,error}=await supabase.rpc('av2_list_daily_travel_for_review',{
    p_employee_ids:ids.length?ids:null,p_from_date:fromDate,p_to_date:toDate
  });
  if(error)throw new Error('טעינת דיווחי הנסיעות נכשלה');
  return Array.isArray(data)?data:[];
};

api.attendanceControlOrphanDailyTravelReports = async function ({fromDate='',toDate=''}={}) {
  await waitForSupabaseAuthSession({timeoutMs:7000}).catch(()=>null);
  const {data,error}=await supabase.rpc('av2_list_orphan_daily_travel_for_review',{
    p_from_date:fromDate,p_to_date:toDate
  });
  if(error)throw new Error(error.message||'טעינת נסיעות ללא נוכחות נכשלה');
  return Array.isArray(data)?data:[];
};

api.attendanceControlDeleteOrphanDailyTravel = async function ({employeeId,date}={}) {
  await waitForSupabaseAuthSession({timeoutMs:7000}).catch(()=>null);
  const id=Number(employeeId);
  if(!Number.isSafeInteger(id)||id<=0||!/^20\\d{2}-\\d{2}-\\d{2}$/.test(String(date||'')))
    throw new Error('יש לבחור דיווח נסיעות תקין למחיקה');
  const {data,error}=await supabase.rpc('av2_delete_orphan_daily_travel',{
    p_emp_id:id,p_date:date
  });
  if(error)throw new Error(error.message||'מחיקת דיווח הנסיעות נכשלה');
  if(!data?.deleted)throw new Error('לא התקבל אישור מחיקה');
  return data;
};

api.attendanceControlReviewDailyTravel = async function ({employeeId,date,decision,km=null,minutes=null}={}) {
  await waitForSupabaseAuthSession({timeoutMs:7000}).catch(()=>null);
  const {data,error}=await supabase.rpc('av2_review_daily_travel',{
    p_emp_id:Number(employeeId),p_date:date,p_decision:decision,
    p_km:km,p_minutes:minutes
  });
  if(error)throw new Error(error.message||'בקרת הנסיעות נכשלה');
  return data;
};


api.attendanceControlExpenseReports = async function ({employeeIds=[],fromDate='',toDate=''}={}) {
  await waitForSupabaseAuthSession({timeoutMs:7000}).catch(()=>null);
  const ids=[...new Set((employeeIds||[]).map(id=>Number(text(id))).filter(Number.isSafeInteger))];
  const {data,error}=await supabase.rpc('av2_list_expenses',{
    p_emp_ids:ids.length?ids:null,p_from:fromDate,p_to:toDate
  });
  if(error)throw new Error('טעינת דיווחי ההוצאות נכשלה');
  return Array.isArray(data)?data:[];
};

api.attendanceControlReviewExpense = async function ({id,decision,amount=null}={}) {
  await waitForSupabaseAuthSession({timeoutMs:7000}).catch(()=>null);
  const {data,error}=await supabase.rpc('av2_review_expense',{
    p_expense_id:id,p_decision:decision,
    p_amount:decision==='correct'?Number(amount):null
  });
  if(error)throw new Error(error.message||'אישור ההוצאה נכשל');
  return data;
};

export { legacyRecord, normalizeAttachments };
