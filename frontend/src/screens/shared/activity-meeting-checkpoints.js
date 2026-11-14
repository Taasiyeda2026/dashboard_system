/** The existing manager-board midpoint rule, shared without changing its meaning. */
export function midpointMeetingNumbers(totalMeetings) {
  const numbers = new Set();
  if (totalMeetings > 1) {
    if (totalMeetings % 2 === 0) {
      numbers.add(totalMeetings / 2);
      numbers.add(totalMeetings / 2 + 1);
    } else numbers.add(Math.ceil(totalMeetings / 2));
  }
  return numbers;
}

export function activityMeetingCheckpoints(row) {
  const numbered = Array.from({ length: 35 }, (_, i) => row[`date_${i + 1}`] || row[`Date${i + 1}`]);
  const source = numbered.some(Boolean) ? numbered : Array.isArray(row.meeting_schedule) && row.meeting_schedule.length ? row.meeting_schedule.map((m) => m.date)
    : Array.isArray(row.meeting_dates) ? row.meeting_dates
      : Array.isArray(row.date_cols) ? row.date_cols : Array.from({ length: 35 }, (_, i) => row[`date_${i + 1}`]);
  const total = Number(row.sessions || row.meetings_total);
  const midpoint = midpointMeetingNumbers(Number.isInteger(total) && total > 0 ? total : 0);
  const points = [];
  source.forEach((date, index) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return;
    if (index === 0) points.push({ label: 'התחלה לפי לוח', date });
    if (midpoint.has(index + 1)) points.push({ label: 'אמצע לפי לוח', date });
    if (index + 1 === total) points.push({ label: 'סיום לפי לוח', date });
  });
  if (!points.some((point) => point.label === 'סיום לפי לוח') && /^\d{4}-\d{2}-\d{2}$/.test(String(row.end_date || ''))) points.push({ label: 'תאריך סיום', date: row.end_date });
  return points.sort((a, b) => a.date.localeCompare(b.date));
}
