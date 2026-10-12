const STATUSES = Object.freeze({
  not_due: ['טרם הגיע מועד', 'muted'],
  pending: ['ממתין לשליחה', 'pending'],
  sent: ['נשלח', 'success'],
  failed: ['נכשל', 'warning'],
  needs_attention: ['דורש טיפול', 'warning']
});

export function staffDeliveryStatus(value) {
  const [label, tone] = STATUSES[value] || STATUSES.needs_attention;
  return { label, tone };
}

export function staffStatusIndex(rows = []) {
  return new Map(rows.map((row) => [`${row.activity_row_id}|${row.stage}`, row]));
}
