import { supabase } from '../supabase-client.js';
import { addGraphFileAttachment, createGraphDraft, delegatedMailToken, deleteGraphDraft, graphMailRequest } from '../microsoft/graph-mail.js';
import { coordinationMailContent, coordinationPdfFilename, documentDataHash, groupActivitiesForDispatch } from './domain.js';
import { blobToBase64, generateActivityCoordinationPdf } from './pdf.js';
import { finishDispatch, markDispatchDraft, recordReconciliationException, reserveDispatch } from './data.js';

export const COORDINATION_CORRELATION_PROPERTY = 'String {8ECCC264-8F4A-4E1A-934E-8C0C2A92D8B1} Name ActivityCoordinationDispatch';

export function dispatchGroups(items) {
  return groupActivitiesForDispatch(items.filter((item) => item.readiness.ready && item.recipient_email && !item.technical_blocker));
}

async function photographyApprovalAttachment() {
  const { data, error } = await supabase.functions.invoke('activity-coordination-photo-approval', { body: {} });
  if (error || !data?.content_bytes) throw new Error(data?.message || 'לא ניתן לטעון את אישור הצילום מ-SharePoint.');
  return { name: data.name || 'אישור צילום.pdf', contentType: data.content_type || 'application/pdf', contentBytes: data.content_bytes };
}

export async function prepareCoordinationDraftGroup(group, { token } = {}) {
  const snapshots = group.activities.map((item) => item.snapshot);
  const mail = coordinationMailContent(snapshots);
  const summaryFilename = coordinationPdfFilename(snapshots);
  const photoFilename = 'אישור צילום.pdf';
  const idempotencyKey = await documentDataHash({
    season: group.activity_season,
    school_id: String(group.school_id),
    recipient_email: group.recipient_email,
    items: group.activities.map((item) => `${item.activity_row_id}:${item.document_data_hash}`).sort()
  });
  const correlationId = crypto.randomUUID();
  const dispatch = await reserveDispatch(group, { subject: mail.subject, summaryFilename, photographyFilename: photoFilename, idempotencyKey, correlationId });
  if (dispatch.graph_message_id) return { dispatch, existing: true };
  if (String(dispatch.client_correlation_id) !== correlationId) return { dispatch, existing: true, pending: true };

  const pdfBlob = await generateActivityCoordinationPdf(snapshots);
  const [summaryBytes, photo] = await Promise.all([blobToBase64(pdfBlob), photographyApprovalAttachment()]);
  let draft;
  try {
    draft = await createGraphDraft({
      token, subject: mail.subject, body: mail.body, to: [group.recipient_email],
      cc: group.activities[0].cc_email ? [group.activities[0].cc_email] : [],
      extendedProperties: [{ id: COORDINATION_CORRELATION_PROPERTY, value: correlationId }]
    });
    await addGraphFileAttachment(token, draft.id, { name: summaryFilename, contentType: 'application/pdf', contentBytes: summaryBytes });
    await addGraphFileAttachment(token, draft.id, photo);
    await markDispatchDraft(dispatch.id, draft);
    return { dispatch: { ...dispatch, graph_message_id: draft.id }, draft, existing: false };
  } catch (error) {
    if (draft?.id) await deleteGraphDraft(token, draft.id).catch(() => {});
    await finishDispatch(dispatch.id, 'failed', null, String(error?.message || error)).catch(() => {});
    throw error;
  }
}

export async function prepareCoordinationDrafts(items, { loginHint = '', onProgress = () => {} } = {}) {
  const groups = dispatchGroups(items);
  const token = await delegatedMailToken(loginHint);
  return runSequentialGroups(groups, (group) => prepareCoordinationDraftGroup(group, { token }), onProgress);
}

export async function runSequentialGroups(groups, worker, onProgress = () => {}) {
  const results = [];
  for (let index = 0; index < groups.length; index += 1) {
    onProgress({ current: index + 1, total: groups.length, group: groups[index] });
    try { results.push({ ok: true, group: groups[index], value: await worker(groups[index], index) }); }
    catch (error) {
      results.push({ ok: false, group: groups[index], error });
      if (error?.status === 429 && error.retryAfter) await new Promise((resolve) => setTimeout(resolve, error.retryAfter * 1000));
    }
  }
  return results;
}

const normalizedAddresses = (recipients = []) => recipients.map((item) => String(item?.emailAddress?.address || '').trim().toLowerCase());

export function sentMessageEvidence(message, dispatch) {
  if (!message || message.isDraft !== false || !message.sentDateTime) return { valid: false, reason: 'message_not_sent' };
  if (!normalizedAddresses(message.toRecipients).includes(String(dispatch.recipient_email || '').toLowerCase())) return { valid: false, reason: 'original_recipient_removed' };
  const names = (message.attachments || []).map((item) => String(item?.name || ''));
  if (!names.includes(dispatch.summary_pdf_filename) || !names.includes(dispatch.photography_pdf_filename)) return { valid: false, reason: 'required_attachment_removed' };
  return { valid: true, sentAt: message.sentDateTime };
}

export async function reconcileDispatch(dispatch, token) {
  const select = '$select=id,isDraft,sentDateTime,toRecipients,internetMessageId&$expand=attachments($select=name)';
  let message = null;
  try { message = await graphMailRequest(token, `/me/messages/${encodeURIComponent(dispatch.graph_message_id)}?${select}`); }
  catch (error) { if (error?.status !== 404) throw error; }
  if (!message) {
    const filter = encodeURIComponent(`singleValueExtendedProperties/Any(ep: ep/id eq '${COORDINATION_CORRELATION_PROPERTY}' and ep/value eq '${dispatch.client_correlation_id}')`);
    const expanded = '$expand=attachments($select=name),singleValueExtendedProperties';
    const result = await graphMailRequest(token, `/me/mailFolders/sentitems/messages?$filter=${filter}&$top=1&$select=id,isDraft,sentDateTime,toRecipients,internetMessageId&${expanded}`);
    message = result?.value?.[0] || null;
  }
  if (!message) {
    const recorded = await recordReconciliationException(dispatch.id, 'הטיוטה לא נמצאה; מתבצע אימות חוזר', true);
    if (Number(recorded?.reconciliation_miss_count || 0) < 2) return { status: 'draft_missing_once' };
    await finishDispatch(dispatch.id, 'cancelled', null, 'הטיוטה הקודמת לא נמצאה');
    return { status: 'cancelled' };
  }
  if (message.isDraft !== false) {
    await recordReconciliationException(dispatch.id, '', false);
    return { status: 'draft' };
  }
  const evidence = sentMessageEvidence(message, dispatch);
  if (!evidence.valid) {
    const reason = evidence.reason === 'original_recipient_removed' ? 'הנמען המקורי הוסר לפני השליחה' : 'אחד ממסמכי החובה הוסר לפני השליחה';
    await recordReconciliationException(dispatch.id, reason);
    return { status: 'exception', reason: evidence.reason };
  }
  await finishDispatch(dispatch.id, 'sent', evidence.sentAt);
  return { status: 'sent', sentAt: evidence.sentAt };
}
