import { supabase, waitForSupabaseAuthSession } from '../supabase-client.js';
import {
  buildActivityDocumentSnapshot,
  coordinationStatus,
  documentDataHash,
  normalizeRecipientEmail,
  readinessForActivity,
  validCoordinationSchoolId
} from './domain.js';

export const COORDINATION_DOCUMENT_VERSION = 'coordination-pdf-v7';

const rowId = (row) => String(row?.row_id || row?.RowID || '').trim();

async function activityCoordinationSendAccess() {
  const session = await waitForSupabaseAuthSession({ timeoutMs: 8000 });
  if (!session?.user?.id) return false;
  const { data, error } = await supabase.rpc('activity_coordination_is_admin');
  if (error) throw new Error(error.message || 'activity_coordination_access_check_failed');
  return data === true;
}

function managerContacts(settings = {}) {
  const raw = settings.activity_manager_contacts;
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === 'object'
    ? Object.entries(raw).map(([name, value]) => ({ name, ...(typeof value === 'object' ? value : { phone: value }) }))
    : [];
  return new Map(rows.map((item) => [String(item?.name || '').trim(), item]));
}

export async function loadActivityCoordinationContext(activities = [], settings = {}) {
  const canSend = await activityCoordinationSendAccess();
  if (!canSend) return { items: [], byActivityId: new Map(), access: 'denied' };

  const rows = activities.filter((row) => String(row?.activity_season || '').trim() === 'school_2027');
  const ids = rows.map(rowId).filter(Boolean);
  const contactIds = [...new Set(rows.map((row) => Number(row?.school_contact_id)).filter(Number.isFinite))];
  const empIds = [...new Set(rows.map((row) => Number(row?.emp_id)).filter(Number.isFinite))];
  const [statuses, syllabus, emails, contacts, instructors] = await Promise.all([
    ids.length ? supabase.from('activity_coordination_activity_status_view').select('*').in('activity_row_id', ids) : { data: [] },
    supabase.from('catalog_program_syllabus').select('program_number,meeting_order,school_preparation').order('meeting_order'),
    contactIds.length ? supabase.rpc('activity_coordination_contact_emails', { p_contact_ids: contactIds }) : { data: [] },
    contactIds.length ? supabase.from('contacts_schools').select('id,contact_name,contact_role,phone,mobile,email').in('id', contactIds) : { data: [] },
    empIds.length ? supabase.from('contacts_instructors').select('emp_id,full_name,mobile').in('emp_id', empIds) : { data: [] }
  ]);
  for (const result of [statuses, syllabus, emails, contacts, instructors]) {
    if (result?.error) throw new Error(result.error.message || 'activity_coordination_load_failed');
  }
  const statusByActivity = new Map((statuses.data || []).map((item) => [String(item.activity_row_id), item]));
  const contactById = new Map((contacts.data || []).map((item) => [Number(item.id), item]));
  const instructorById = new Map((instructors.data || []).map((item) => [Number(item.emp_id), item]));
  const primaryEmailByContact = new Map();
  for (const item of emails.data || []) {
    const current = primaryEmailByContact.get(Number(item.contact_id));
    if (!current || item.is_primary) primaryEmailByContact.set(Number(item.contact_id), item.email);
  }
  const managers = managerContacts(settings);
  const items = [];
  for (const activity of rows) {
    const contact = contactById.get(Number(activity.school_contact_id)) || {};
    const resolvedContact = activity.resolved_school_2027_contact || {};
    const contactName = contact.contact_name || resolvedContact.name || activity.resolved_contact_name || activity.contact_name || '';
    const contactRole = contact.contact_role || resolvedContact.role || activity.resolved_contact_role || activity.contact_role || '';
    const contactPhone = contact.mobile || contact.phone || resolvedContact.phone || activity.resolved_contact_phone || activity.contact_phone || '';
    const instructor = instructorById.get(Number(activity.emp_id)) || {};
    const manager = managers.get(String(activity.activity_manager || '').trim()) || {};
    const activityForReadiness = {
      ...activity,
      contact_name: contactName || activity.contact_name,
      resolved_contact_name: contactName || activity.resolved_contact_name
    };
    const snapshot = buildActivityDocumentSnapshot({
      activity,
      syllabusRows: syllabus.data || [],
      contact: { name: contactName, role: contactRole, phone: contactPhone },
      instructor: { name: instructor.full_name, mobile: instructor.mobile },
      activityManager: manager
    });
    const hash = await documentDataHash({ document_version: COORDINATION_DOCUMENT_VERSION, snapshot });
    const persisted = statusByActivity.get(rowId(activity)) || {};
    const readiness = readinessForActivity(activityForReadiness);
    const recipientEmail = normalizeRecipientEmail(
      primaryEmailByContact.get(Number(activity.school_contact_id))
      || resolvedContact.email
      || activity.resolved_contact_email
      || activity.contact_email
      || contact.email
    );
    const hasValidSchoolId = validCoordinationSchoolId(activity.school_id);
    items.push({
      activity,
      activity_season: String(activity.activity_season || ''),
      school_id: String(activity.school_id || ''),
      activity_row_id: rowId(activity),
      snapshot,
      document_data_hash: hash,
      readiness,
      recipient_email: recipientEmail,
      technical_blocker: !hasValidSchoolId ? 'חסר מזהה בית ספר תקין' : (recipientEmail ? '' : 'חסרה כתובת מייל פעילה לנמען'),
      cc_email: normalizeRecipientEmail(manager.email),
      cc_warning: manager.email ? '' : 'לא נמצאה כתובת CC למנהל/ת הפעילות',
      status: coordinationStatus({
        readiness,
        currentHash: hash,
        latestSent: persisted.latest_sent_document_data_hash ? { document_data_hash: persisted.latest_sent_document_data_hash } : null,
        activeDraft: persisted.active_draft_document_data_hash ? { document_data_hash: persisted.active_draft_document_data_hash } : null
      }),
      persisted
    });
  }
  return { items, byActivityId: new Map(items.map((item) => [item.activity_row_id, item])), access: 'allowed' };
}

export async function reserveDispatch(group, { subject, summaryFilename, photographyFilename, idempotencyKey, correlationId }) {
  if (!validCoordinationSchoolId(group?.school_id)) throw new Error('חסר מזהה בית ספר תקין');
  const first = group.activities[0];
  const { data, error } = await supabase.rpc('reserve_activity_coordination_dispatch', {
    p_school_id: Number(group.school_id), p_activity_season: group.activity_season,
    p_recipient_contact_id: first.activity.school_contact_id || null,
    p_recipient_email: group.recipient_email, p_recipient_name: first.snapshot.contact.name,
    p_cc_email: first.cc_email || null, p_subject: subject,
    p_summary_pdf_filename: summaryFilename, p_photography_pdf_filename: photographyFilename,
    p_idempotency_key: idempotencyKey, p_client_correlation_id: correlationId,
    p_items: group.activities.map((item) => ({ activity_row_id: item.activity_row_id, document_data_hash: item.document_data_hash }))
  });
  if (error) throw new Error(error.message || 'activity_coordination_reservation_failed');
  return data;
}

export async function markDispatchDraft(dispatchId, draft) {
  const { data, error } = await supabase.rpc('mark_activity_coordination_dispatch_draft', {
    p_dispatch_id: dispatchId, p_graph_message_id: draft.id,
    p_graph_internet_message_id: draft.internetMessageId || null, p_graph_web_link: draft.webLink || null
  });
  if (error) throw new Error(error.message || 'activity_coordination_draft_record_failed');
  return data;
}

export async function finishDispatch(dispatchId, status, sentAt = null, reconciliationError = '') {
  const { data, error } = await supabase.rpc('finish_activity_coordination_dispatch', {
    p_dispatch_id: dispatchId, p_status: status, p_sent_at: sentAt, p_reconciliation_error: reconciliationError || null
  });
  if (error) throw new Error(error.message || 'activity_coordination_finish_failed');
  return data;
}

export async function recordReconciliationException(dispatchId, message = '', incrementMissing = false) {
  const { data, error } = await supabase.rpc('record_activity_coordination_reconciliation', {
    p_dispatch_id: dispatchId, p_reconciliation_error: message || null, p_increment_missing: incrementMissing
  });
  if (error) throw new Error(error.message || 'activity_coordination_reconciliation_record_failed');
  return data;
}
