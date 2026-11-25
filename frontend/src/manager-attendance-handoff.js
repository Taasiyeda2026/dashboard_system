/**
 * Read-only manager monthly signoff -> admin review -> payroll dispatch status.
 *
 * Admin final approval and dispatch are intentionally separate, server-gated
 * operations. This module never invokes them.
 */
const txt = (value) => String(value ?? '').trim();

export function managerAttendanceHandoffState({
  workflow = {},
  finalApproval = null,
  auditCount = 0
} = {}) {
  const workflowStatus = txt(workflow.workflow_status || workflow.workflowStatus);
  const submissionStatus = txt(workflow.attendance_submission_status || workflow.attendanceSubmissionStatus);
  const finalStatus = txt(finalApproval?.status);
  const signed = workflowStatus === 'manager_approved'
    || Boolean(workflow.manager_approved_at || workflow.managerApprovedAt);

  let step = 'instructor';
  let label = 'ממתין להגשת המדריך';
  let description = 'המדריך צריך להשלים ולאשר את החודש.';
  if (finalStatus === 'approved_for_payroll') {
    step = 'sent_to_payroll';
    label = 'הועבר לשכר';
    description = 'הבקרה הסופית הושלמה והדוח הועבר לשכר.';
  } else if (finalStatus === 'admin_approved') {
    step = 'admin_approved';
    label = 'אושר סופית · ממתין להעברה לשכר';
    description = 'רק מנהל מערכת יכול להעביר את הדוח לשכר בפעולה נפרדת.';
  } else if (signed) {
    const hasPdf = Boolean(txt(workflow.manager_pdf_sharepoint_url || workflow.managerPdfSharepointUrl));
    step = hasPdf ? 'awaiting_admin' : 'pdf_pending';
    label = hasPdf ? 'אושר מנהל · ממתין לבקרה סופית' : 'אושר מנהל · PDF עדיין חסר';
    description = hasPdf
      ? 'הדוח ננעל והועבר לתור הבקרה הסופית של מנהל המערכת.'
      : 'אישור המנהל נשמר, אך יש להשלים את הפקת ה־PDF לפני האישור הסופי.';
  } else if (workflowStatus === 'submitted' && submissionStatus !== 'reopened') {
    step = 'awaiting_manager';
    label = 'ממתין לאישור מנהל';
    description = 'יש להשלים בקרת רשומות, נסיעות והוצאות לפני החתימה.';
  } else if (submissionStatus === 'reopened') {
    step = 'returned';
    label = 'הוחזר למדריך לתיקון';
    description = 'המדריך צריך לתקן ולהגיש מחדש.';
  }

  return {
    step, label, description,
    needsInvestigation: Number(auditCount) > 0 && signed,
    pdfPending: step === 'pdf_pending',
    awaitingAdmin: step === 'awaiting_admin',
    readyToDispatch: step === 'admin_approved',
    dispatched: step === 'sent_to_payroll'
  };
}

export function managerAttendanceHandoffTotals(items = []) {
  return (Array.isArray(items) ? items : []).reduce((out, state) => {
    if (state.awaitingAdmin) out.awaitingAdmin += 1;
    if (state.pdfPending) out.pdfPending += 1;
    if (state.readyToDispatch) out.adminApproved += 1;
    if (state.dispatched) out.sentToPayroll += 1;
    if (state.needsInvestigation) out.reviewExceptions += 1;
    return out;
  }, { awaitingAdmin: 0, pdfPending: 0, adminApproved: 0, sentToPayroll: 0, reviewExceptions: 0 });
}
