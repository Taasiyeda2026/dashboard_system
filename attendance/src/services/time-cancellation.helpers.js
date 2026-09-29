function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

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
