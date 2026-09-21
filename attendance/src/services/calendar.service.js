import { supabase } from '../api/client.js';

function pad(value) {
  return String(value).padStart(2, '0');
}

export function attendanceCalendarMonthRange(year, month) {
  const fromDate = `${year}-${pad(month)}-01`;
  const lastDay = new Date(Number(year), Number(month), 0).getDate();
  const toDate = `${year}-${pad(month)}-${pad(lastDay)}`;
  return { fromDate, toDate };
}

export async function loadAttendanceCalendarContext(year, month) {
  const { fromDate, toDate } = attendanceCalendarMonthRange(year, month);

  const [activityResult, schoolResult, birthdayResult] = await Promise.all([
    supabase.rpc('av2_get_current_instructor_calendar_events', {
      p_from: fromDate,
      p_to: toDate,
    }),
    supabase
      .from('school_calendar')
      .select('external_key,title,category,calendar_sector,start_date,end_date,resume_date,day_status,blocks_scheduling,show_on_main_calendar,is_active')
      .eq('is_active', true)
      .eq('show_on_main_calendar', true)
      .lte('start_date', toDate)
      .order('start_date', { ascending: true }),
    supabase
      .from('employee_birthdays')
      .select('employee_name,birth_day,birth_month,display_order')
      .eq('is_active', true)
      .eq('birth_month', Number(month))
      .order('birth_day', { ascending: true })
      .order('display_order', { ascending: true })
      .order('employee_name', { ascending: true }),
  ]);

  if (activityResult.error) {
    throw new Error(activityResult.error.message || 'שגיאה בטעינת פעילויות ללוח השנה');
  }

  const schoolRows = Array.isArray(schoolResult.data)
    ? schoolResult.data.filter((row) => {
        const start = String(row?.start_date || '').slice(0, 10);
        const end = String(row?.end_date || row?.start_date || '').slice(0, 10);
        return start && end && start <= toDate && end >= fromDate;
      })
    : [];

  if (schoolResult.error) {
    console.warn('[attendance-calendar] school calendar read failed', schoolResult.error);
  }
  if (birthdayResult.error) {
    console.warn('[attendance-calendar] birthday read failed', birthdayResult.error);
  }

  return {
    activities: Array.isArray(activityResult.data) ? activityResult.data : [],
    schoolEvents: schoolRows,
    birthdays: Array.isArray(birthdayResult.data) ? birthdayResult.data : [],
    fromDate,
    toDate,
  };
}

export function attendanceCalendarEventsForDate(context = {}, dateStr = '') {
  const date = String(dateStr || '').slice(0, 10);
  if (!date) return { activities: [], schoolEvents: [], birthdays: [] };

  const [, month, day] = date.split('-').map(Number);

  const activities = (context.activities || []).filter(
    (row) => String(row?.date || '').slice(0, 10) === date,
  );

  const schoolEvents = (context.schoolEvents || []).filter((row) => {
    const start = String(row?.start_date || '').slice(0, 10);
    const end = String(row?.end_date || row?.start_date || '').slice(0, 10);
    return start && end && date >= start && date <= end;
  });

  const birthdays = (context.birthdays || []).filter(
    (row) => Number(row?.birth_month) === month && Number(row?.birth_day) === day,
  );

  return { activities, schoolEvents, birthdays };
}
