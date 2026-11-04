/**
 * Map instructor attendance write failures to short Hebrew guidance.
 * Keep raw server codes out of the UI unless no known mapping exists.
 */

function rawMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return String(error.message || error.code || error.details || error.hint || '');
}

export function instructorAttendanceError(error, fallback = 'הפעולה נכשלה. נסו שוב.') {
  const raw = rawMessage(error);
  const compact = raw.replace(/\s+/g, ' ').trim();
  const haystack = `${compact} ${String(error?.code || '')}`.toLowerCase();

  if (/attendance_month_locked|av2_can_write_month|month_locked/.test(haystack)
    || /42501/.test(haystack) && /month|attendance|policy|rls/.test(haystack)) {
    return 'החודש נעול לעריכה (כולל נסיעות והוצאות). אם כבר הגשתם אותו — פנו למנהל לפתיחה מחדש. אחרת עברו לחודש הפתוח לדיווח.';
  }
  if (/attendance_month_submission_required|not_submitted/.test(haystack)) {
    return 'יש להגיש את החודש לפני המשך הבקרה.';
  }
  if (/attendance_existing_legacy_approved_travel_conflict/.test(haystack)) {
    return 'לחישוב זה כבר קיים אישור נסיעה קודם. פנו למנהל לבדיקה.';
  }
  if (/attendance_between_activities_requires_report/.test(haystack)) {
    return 'יש להשלים את דיווח הנסיעה בין הפעילויות לפני השמירה.';
  }
  if (/daily_travel|attendance_travel_report_required|travel_report/.test(haystack)) {
    return 'יש להשלים את דיווח הנסיעות ליום זה לפני ההמשך.';
  }
  if (/expense/.test(haystack) && /locked|denied|42501/.test(haystack)) {
    return 'לא ניתן לשמור הוצאה לחודש שנעול. פנו למנהל אם נדרשת פתיחה מחדש.';
  }
  if (/attendance_manual_cancellation_blocked_system_travel_path/.test(haystack)) {
    return 'לא ניתן לדווח ביטול זמן ידני ליום שיש בו פעילות עם מסלול נסיעות במערכת. השתמשו בדיווח הנסיעות, או פנו למנהל לחריג.';
  }
  if (/attendance_double_cancellation_same_day/.test(haystack)) {
    return 'קיים כפל ביטול זמן באותו יום. יש להשאיר מסלול תשלום אחד בלבד לפני העברה לשכר.';
  }
  if (/attendance_payroll_hold_active/.test(haystack)) {
    return 'העברה לשכר מושהית לחודש זה. הסירו את ההשהיה רק אחרי רענון הדוח.';
  }
  if (/duplicate|23505/.test(haystack)) {
    return 'כבר קיימת רשומה דומה. רעננו את הרשימה ובדקו לפני שמירה חוזרת.';
  }
  if (/network|failed to fetch|timeout|503|502/.test(haystack)) {
    return 'תקלת תקשורת זמנית. בדקו חיבור ונסו שוב.';
  }
  // Strip noisy Postgres/PostgREST prefixes when the remainder is already Hebrew.
  const cleaned = compact
    .replace(/^שגיאה ב[^:]+:\s*/u, '')
    .replace(/^error[:\s]*/i, '')
    .trim();
  if (/[\u0590-\u05FF]/.test(cleaned) && cleaned.length <= 180) return cleaned;
  return fallback;
}
