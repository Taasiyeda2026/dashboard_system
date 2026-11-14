import { loadActivityCoordinationContext } from '../../activity-coordination/data.js';
import { supabase, waitForSupabaseAuthSession } from '../../supabase-client.js';
import { hasPermission } from '../../permission-policy.js';
import { canViewImpactFeedback } from '../../impact-feedback/feedback-access.js';
import { fetchStaffDeliveryStatus } from '../../impact-feedback/feedback-api.js';
import { campaignUiStatus, GROUP_SLOTS } from '../../impact-feedback/feedback-domain.js';
import { normalizedExceptionTypes } from './exceptions-metrics.js';

const idOf = (row) => String(row?.RowID || row?.row_id || '').trim();
const quote = (value) => '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const allowedEvidenceRoles = new Set(['admin', 'operation_manager', 'domain_manager', 'activities_manager', 'instructor_manager', 'finance', 'business_development_manager']);

// Full pagination is required: a truncated successful read must never mean zero/missing.
async function pages(makeQuery) {
  const result = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error } = await makeQuery().range(offset, offset + 499);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('invalid_management_response');
    result.push(...data);
    if (data.length < 500) return result;
  }
  throw new Error('management_response_too_large');
}

async function chunked(ids, read) {
  const results = [];
  for (let offset = 0; offset < ids.length; offset += 60) results.push(...await read(ids.slice(offset, offset + 60)));
  return results;
}

export function managementFeedback(group, now = Date.now()) {
  if (!group) return { available: true, applicable: false, slots: [], needsAttention: false };
  if (group.feedback_excluded) return { available: true, applicable: false, slots: [], needsAttention: false };
  const slots = GROUP_SLOTS.map((slot) => {
    const campaign = (group.campaigns || []).find((c) => c.audience === slot.audience && c.stage === slot.stage);
    const status = campaignUiStatus(campaign, now);
    return { label: slot.label, audience: slot.audience, stage: slot.stage, status: status.key, statusLabel: status.label, responses: campaign ? Number(campaign.responses || 0) : null };
  });
  // Use existing warning status, not a new completion/due-date rule.
  return { available: true, applicable: true, slots, needsAttention: slots.some((s) => s.status === 'expired') };
}

export function buildManagementEvidence(rows, sources = {}) {
  const result = Object.create(null);
  for (const row of rows) {
    const id = idOf(row);
    const approvals = (sources.approvals || []).filter((a) => String(a.activity_row_id || '').split(',').map((s) => s.trim()).includes(id));
    const cancellations = (sources.cancellations || []).filter((c) => String(c.activity_id) === id);
    const records = (sources.attendance || []).filter((r) => String(r.activity_row_id) === id && !['ביטולזמן', 'הכשרה', 'תפעול'].includes(String(r.activity_type || '').replace(/\s+/g, '')) && (!r.activity_numeric_id || !row.id || String(r.activity_numeric_id) === String(row.id)));
    const group = (sources.groups || []).find((g) => String(g.row_id) === id);
    const feedback = sources.feedbackAvailable ? managementFeedback(group) : { available: false };
    if (feedback.available && group) {
      for (const assignment of sources.assignments || []) {
        if (assignment.season && assignment.season !== (row.activity_season || 'regular')) continue;
        if (assignment.program_key !== group.program_key || ![row.emp_id, row.emp_id_2].map(String).includes(String(assignment.instructor_emp_id))) continue;
        for (const stage of ['pre', 'final', 'final_b']) {
          if (stage === 'final_b' && !assignment.last_end_b) continue;
          const campaign = assignment[stage + '_campaign'];
          const status = campaignUiStatus(campaign);
          feedback.slots.push({ audience: 'instructor', stage, label: `משוב מדריך לפי תוכנית · ${stage === 'pre' ? 'פתיחה' : stage === 'final_b' ? 'סיום ב׳' : 'סיום א׳'}`, status: status.key, statusLabel: status.label, responses: campaign ? Number(campaign.responses || 0) : null });
          if (status.key === 'expired') feedback.needsAttention = true;
        }
      }
      if ((sources.staff || []).some((item) => String(item.activity_row_id) === id && ['failed', 'needs_attention'].includes(item.status))) feedback.needsAttention = true;
    }
    result[id] = {
      approvalsAvailable: sources.approvalsAvailable === true,
      approvedDates: [...new Set(approvals.filter((a) => a.status === 'approved').map((a) => a.activity_date))],
      cancellationsAvailable: sources.cancellationsAvailable === true,
      cancelledDates: [...new Set(cancellations.map((c) => c.meeting_date))],
      historyAvailable: sources.historyAvailable === true,
      history: (sources.history || []).filter((event) => String(event.activity_id) === id).map((event) => ({ date: event.meeting_date, instructor: event.instructor_name, recordedAt: event.recorded_at })),
      attendanceAvailable: sources.attendanceAvailable === true,
      attendanceComplete: sources.attendanceComplete === true,
      attendance: records.map((r) => ({ date: r.attendance_date, meetingNo: r.session_number, employeeId: r.employee_id, type: r.activity_type })),
      feedback,
      exceptionsAvailable: sources.exceptionsAvailable === true,
      exceptions: normalizedExceptionTypes((sources.exceptions || []).find((e) => idOf(e) === id) || {}),
      coordination: sources.coordination?.byActivityId?.get(id) ? { available: true, status: sources.coordination.byActivityId.get(id).status } : { available: false },
      errors: [...(sources.errors || [])]
    };
  }
  return result;
}

/** Uses existing authenticated sources only; caller scopes to visible rows or one drawer.
 * No service credentials, writes, per-activity requests, or financial/response content.
 */
export async function loadActivityManagement(rows, { user, api, state, client = supabase, groupsLoader = null, assignmentsLoader = null, staffLoader = fetchStaffDeliveryStatus, waitForSession = waitForSupabaseAuthSession } = {}) {
  const ids = [...new Set(rows.map(idOf).filter(Boolean))];
  if (!ids.length || !user || user.is_active === false) return Object.create(null);
  const role = String(user?.role || '');
  if (!allowedEvidenceRoles.has(role) && !canViewImpactFeedback(user)) return buildManagementEvidence(rows);
  await waitForSession();
  const { data: authenticatedRole, error: roleError } = await client.rpc('app_current_role');
  if (roleError || !authenticatedRole) throw new Error('management_identity_unavailable');
  if (String(authenticatedRole) !== role) return buildManagementEvidence(rows, { errors: ['identity_changed'] });
  // Existing records RPC omits course_dashboard_sources for bundled reports.
  // Even an admin cannot infer that an unmatched planned meeting is unreported.
  const sources = { errors: [], coordination: state?.activityCoordination, attendanceComplete: false };
  const tasks = [];
  const read = (key, fn) => tasks.push(Promise.resolve().then(fn).then((data) => { sources[key] = data; sources[key + 'Available'] = true; }).catch(() => { sources.errors.push(key); }));
  if (allowedEvidenceRoles.has(role)) {
    read('approvals', async () => {
      const chunks = [];
      for (let i = 0; i < ids.length; i += 60) {
        const query = ids.slice(i, i + 60).map((id) => `activity_row_id.like.${quote('*' + id.replace(/[*%]/g, '') + '*')}`).join(',');
        chunks.push(await pages(() => client.from('activity_completion_approval_uploads').select('activity_row_id,activity_date,status').eq('status', 'approved').or(query).order('id')));
      }
      return chunks.flat();
    });
  }
  if (['admin', 'operation_manager'].includes(role)) read('cancellations', () => chunked(ids, (chunk) => pages(() => client.from('course_meeting_cancellations').select('activity_id,meeting_date').in('activity_id', chunk).order('id'))));
  if (role === 'admin' && client === supabase) read('coordination', () => loadActivityCoordinationContext(rows, state?.clientSettings || {}));
  if (['admin', 'operation_manager'].includes(role)) read('history', () => chunked(ids, (chunk) => pages(() => client.from('course_meeting_instructor_history').select('activity_id,meeting_date,instructor_name,recorded_at').in('activity_id', chunk).order('recorded_at').order('id'))));
  const dates = rows.flatMap((r) => [r.start_date, r.end_date, ...Array.from({ length: 35 }, (_, i) => r[`date_${i + 1}`])]).filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))).sort();
  const employeeIds = [...new Set(rows.flatMap((r) => [r.emp_id, r.emp_id_2]).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (hasPermission(user, 'view_attendance_control') && dates.length) read('attendance', () => chunked(ids, (chunk) => pages(() => client.rpc('get_payroll_attendance_records', { p_employee_ids: null, p_from_date: dates[0], p_to_date: dates.at(-1) }).select('record_id,employee_id,attendance_date,session_number,activity_row_id,activity_numeric_id,activity_type').in('activity_row_id', chunk).order('record_id'))));
  if (canViewImpactFeedback(user)) read('feedback', async () => {
    const groups = [];
    const assignments = [];
    for (const season of [...new Set(rows.map((r) => r.activity_season || 'regular'))]) {
      const [g, a] = await Promise.all([
        groupsLoader ? groupsLoader(season) : chunked(ids, (chunk) => pages(() => client.rpc('feedback_admin_groups', { p_academic_year: season, p_activity_row_id: null }).select('row_id,program_key,feedback_excluded,campaigns').in('row_id', chunk).order('row_id'))),
        assignmentsLoader ? assignmentsLoader(season) : (employeeIds.length ? pages(() => client.rpc('feedback_admin_instructor_assignments', { p_academic_year: season }).select('program_key,instructor_emp_id,last_end_b,pre_campaign,final_campaign,final_b_campaign').in('instructor_emp_id', employeeIds.map(String)).order('instructor_emp_id').order('program_key')) : [])
      ]);
      groups.push(...g); assignments.push(...a.map((assignment) => ({ ...assignment, season })));
    }
    let staff = [];
    try { staff = await staffLoader(); } catch { sources.errors.push('staff-feedback'); }
    // Do not retain recipient tokens/contact fields returned by the existing RPC.
    sources.staff = staff.filter((item) => ids.includes(String(item.activity_row_id))).map((item) => ({ activity_row_id: item.activity_row_id, stage: item.stage, status: item.status }));
    sources.assignments = assignments.map((a) => ({ season: a.season, program_key: a.program_key, instructor_emp_id: a.instructor_emp_id, last_end_b: a.last_end_b, ...Object.fromEntries(['pre', 'final', 'final_b'].map((stage) => { const c = a[stage + '_campaign']; return [stage + '_campaign', c ? { status: c.status, opens_at: c.opens_at, expires_at: c.expires_at, audience: 'instructor', responses: c.responses, recipient: { status: c.recipient?.status } } : null]; })) }));
    sources.groups = groups.filter((g) => ids.includes(String(g.row_id))).map((g) => ({ row_id: g.row_id, program_key: g.program_key, feedback_excluded: g.feedback_excluded, campaigns: (g.campaigns || []).map((c) => ({ audience: c.audience, stage: c.stage, status: c.status, opens_at: c.opens_at, expires_at: c.expires_at, responses: c.responses, not_required: c.not_required })) }));
    return [];
  });
  if (api?.exceptions && state?.routes?.includes('exceptions')) read('exceptions', async () => {
    const payload = await api.exceptions({ activityRows: rows, activity_period: state.activityPeriodTab, month: state.activitiesMonthYm });
    if (payload?.error) throw new Error('exceptions_unavailable');
    return payload?.rows || [];
  });
  await Promise.all(tasks);
  return buildManagementEvidence(rows, sources);
}

export function managementScope(user) {
  return JSON.stringify([user?.auth_user_id, user?.user_id, user?.role, user?.emp_id, user?.permissions, user?.view_attendance_control, user?.is_active]);
}

export function managementRevision(row) {
  return JSON.stringify([row.updated_at, row.status, row.emp_id, row.emp_id_2, row.sessions, row.start_date, row.end_date, row.school_id, row.school_contact_id, row.activity_name, row.activity_manager, ...Array.from({ length: 35 }, (_, i) => row[`date_${i + 1}`]), row.meeting_dates]);
}

export function cachedManagement(row, state) {
  const entry = state?.screenDataCache?.[`activityManagement:${idOf(row)}`];
  return entry?.scope === managementScope(state?.user) && entry.revision === managementRevision(row) && Date.now() - entry.t < 60000 ? entry.data : null;
}

export async function ensureActivityManagement(rows, options) {
  const { state } = options;
  if (!state.user || state.user.is_active === false) return false;
  const missing = rows.filter((row) => !cachedManagement(row, state));
  if (!missing.length) return false;
  const scope = managementScope(state.user);
  // State-owned promise deduplicates list/drawer reads and cannot cross a login.
  const key = scope + ':' + JSON.stringify(missing.map(idOf).sort());
  state._managementInflight ||= new Map();
  if (state._managementInflight.has(key)) return state._managementInflight.get(key);
  const pending = loadActivityManagement(missing, options).then((byId) => {
    if (managementScope(state.user) !== scope) return false;
    state.screenDataCache ||= {};
    Object.entries(byId).forEach(([id, data]) => { state.screenDataCache[`activityManagement:${id}`] = { data, scope, revision: managementRevision(missing.find((row) => idOf(row) === id)), t: Date.now() }; });
    return true;
  }).finally(() => state._managementInflight.delete(key));
  state._managementInflight.set(key, pending);
  return pending;
}

export function managementFilterMatches(row, filter, month) {
  if (!filter) return true;
  if (filter === 'ending') return String(row.end_date || '').startsWith(month || new Date().toISOString().slice(0, 7));
  const m = row.management;
  if (!m) return false;
  if (filter === 'exceptions') return m.exceptionsAvailable && m.exceptions.length > 0;
  if (filter === 'feedback') return m.feedback?.available && m.feedback.needsAttention;
  if (filter === 'coordination') return m.coordination?.available && m.coordination.status !== 'sent';
  if (filter === 'missing-reports') {
    if (!m.attendanceAvailable || !m.attendanceComplete || !m.cancellationsAvailable) return false;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    const numbered = Array.from({ length: 35 }, (_, i) => row[`date_${i + 1}`]);
    const dates = numbered.some(Boolean) ? numbered : (Array.isArray(row.meeting_dates) ? row.meeting_dates : []);
    return dates.some((date, index) => date && date < today && !m.cancelledDates.includes(date) && !m.attendance.some((r) => r.date === date && (String(r.meetingNo) === String(index + 1) || (!r.meetingNo && dates.filter((d) => d === date).length === 1))));
  }
  return true;
}
