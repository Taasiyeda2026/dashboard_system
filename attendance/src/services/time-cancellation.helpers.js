function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** @deprecated Legacy audit label parser kept for historical rows only. */
export function parseAutomaticCancellationLabel(auditText) {
  const match = compactText(auditText).match(/(?:אוטומטי|מחושב במקור)\s*:\s*(\d{1,3}:[0-5]\d)/);
  return match?.[1] || null;
}

export async function reconcileChangedTravelContext(reconcile, sourceRecordId) {
  const result = await reconcile(sourceRecordId);
  if (result?.eligible === false || result?.status === 'not_applicable') {
    return { ...result, linkedCancellationRemoved: true };
  }
  if (result?.status !== 'resolved') {
    throw new Error('החישוב מחדש של ביטול הזמן נכשל. נסו שוב.');
  }
  return result;
}

export function instructorTravelReportStatusLabel(compensation = {}) {
  const status = compensation.review_status || 'none';
  switch (status) {
    case 'awaiting_report':
      return 'ממתין לדיווח זמני נסיעה';
    case 'auto_matched':
      return 'דיווח תואם — ממתין לאישור מנהל';
    case 'pending_review':
      return 'נשלח לבקרת מנהל';
    case 'approved':
      return 'אושר לתשלום';
    case 'corrected':
      return 'אושר עם תיקון מנהל';
    case 'rejected':
      return 'נדחה';
    default:
      return compensation.show_travel_report_reminder
        ? 'מומלץ לדווח זמני נסיעה'
        : 'ניתן לדווח זמני נסיעה';
  }
}
