const sectorLabel = (value) => String(value || 'general').trim();

export function organizationalCalendarEvents(calendarRows, birthdays, month) {
  const year = Number(month.slice(0, 4));
  const result = (Array.isArray(calendarRows) ? calendarRows : [])
    .filter((row) => String(row.start_date || '').slice(0, 7) === month)
    .map((row) => ({ date: row.start_date, title: row.title, meta: `${row.category || 'אירוע'} · ${sectorLabel(row.calendar_sector)}` }));
  (Array.isArray(birthdays) ? birthdays : []).forEach((row) => {
    if (Number(row.birth_month) === Number(month.slice(5, 7))) result.push({ date: `${year}-${String(row.birth_month).padStart(2, '0')}-${String(row.birth_day).padStart(2, '0')}`, title: `יום הולדת ל${row.employee_name}`, meta: 'יום הולדת' });
  });
  return result.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
