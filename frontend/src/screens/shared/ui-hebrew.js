/** Visible UI strings only (Hebrew). Internal API values stay English where required. */

/** Display names for short vs long activity families (UI only; not API/sheet keys). */
export const UI_ACTIVITY_FAMILY_SHORT = 'סדנאות וסיורים';
export const UI_ACTIVITY_FAMILY_LONG = 'תוכניות';

export const HEBREW_ROLE = {
  admin: 'מנהל/ת',
  operations_reviewer: 'בקר/ת תפעול',
  authorized_user: 'משתמש/ת מורשה',
  instructor: 'מדריך/ה',
  finance: 'כספים',
  operation_manager: 'מנהל/ת תפעול',
  activities_manager: 'מנהל/ת פעילויות',
  domain_manager: 'מנהל/ת תחום',
  manager_instructor: 'מדריך/ת-מנהל/ת'
};

export function hebrewRole(role) {
  if (role === undefined || role === null || role === '') return '';
  const k = String(role).trim();
  return HEBREW_ROLE[k] || 'לא מוגדר';
}

export const HEBREW_ACTIVITY_TYPE = {
  all: 'הכול',
  course: 'קורס',
  after_school: 'צהרון',
  workshop: 'סדנה',
  tour: 'טיול',
  escape_room: 'חדר בריחה'
};

export function hebrewActivityType(value) {
  if (value === undefined || value === null || value === '') return '—';
  const k = String(value).trim();
  return HEBREW_ACTIVITY_TYPE[k] || 'לא מסווג';
}

export function hebrewFinanceStatus(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'open') return 'פתוח';
  if (v === 'closed') return 'סגור';
  return value || '—';
}

export const HEBREW_EXCEPTION_TYPE = {
  missing_instructor: 'חסר מדריך',
  missing_start_date: 'חסר תאריך התחלה',
  late_end_date: 'תאריך סיום מאוחר'
};

export function hebrewExceptionType(value) {
  if (!value) return '—';
  const k = String(value).trim();
  return HEBREW_EXCEPTION_TYPE[k] || 'לא מסווג';
}

const COLUMN_LABELS = {
  RowID: 'מזהה שורה',
  activity_name: 'שם פעילות',
  finance_status: 'סטטוס כספים',
  status: 'סטטוס',
  emp_id: 'מזהה עובד',
  full_name: 'שם מלא',
  mobile: 'נייד',
  email: 'דוא״ל',
  employment_type: 'סוג העסקה',
  direct_manager: 'מנהל ישיר',
  active: 'פעיל',
  kind: 'סוג',
  authority: 'גורם מממן',
  school: 'בית ספר',
  contact_name: 'איש קשר',
  phone: 'טלפון',
  start_date: 'תאריך התחלה',
  end_date: 'תאריך סיום',
  activity_type: 'סוג פעילות',
  user_id: 'מזהה משתמש',
  display_role: 'תפקיד',
  actions: 'פעולות',
  exception_type: 'סוג חריגה',
  private_note: 'הערה פרטית'
};

export function hebrewColumn(key) {
  if (key === undefined || key === null) return 'שדה';
  const k = String(key).trim();
  return COLUMN_LABELS[k] || 'שדה';
}

const HEBREW_EMPLOYMENT_TYPE = {
  full_time: 'משרה מלאה',
  part_time: 'משרה חלקית',
  contractor: 'קבלן',
  external: 'חיצוני',
  employee: 'עובד/ת',
  salaried: 'שכיר/ה',
  hourly: 'לפי שעה',
  temporary: 'זמני/ת'
};

export function hebrewEmploymentType(value) {
  if (value === undefined || value === null || value === '') return '—';
  const s = String(value).trim();
  if (/[\u0590-\u05FF]/.test(s)) return s;
  const k = s.toLowerCase();
  return HEBREW_EMPLOYMENT_TYPE[k] || 'לא מסווג';
}

const HEBREW_CONTACT_KIND = {
  school: 'בית ספר',
  authority: 'גורם מממן',
  instructor: 'מדריך/ה',
  contact: 'איש קשר',
  vendor: 'ספק',
  partner: 'שותף'
};

export function hebrewContactKind(value) {
  if (value === undefined || value === null || value === '') return '—';
  const s = String(value).trim();
  if (/[\u0590-\u05FF]/.test(s)) return s;
  const k = s.toLowerCase();
  return HEBREW_CONTACT_KIND[k] || 'לא מסווג';
}

const API_ERROR_HE = {
  unauthorized: 'ההרשאה פגה — נדרשת התחברות מחדש',
  forbidden: 'אין הרשאה לביצוע הפעולה',
  'not found': 'הפריט לא נמצא',
  not_found: 'הפריט לא נמצא',
  bad_request: 'הבקשה אינה תקינה',
  invalid_credentials: 'מזהה משתמש או קוד כניסה שגויים',
  invalid_user: 'מזהה משתמש או קוד כניסה שגויים',
  login_failed: 'ההתחברות נכשלה',
  server_error: 'שגיאת שרת — נסו שוב מאוחר יותר',
  network_error: 'בעיית תקשורת — בדקו את החיבור לאינטרנט',
  offline: 'אין חיבור לרשת'
};

/** Maps common API English errors to Hebrew; leaves Hebrew messages unchanged. */
export function translateApiErrorForUser(message) {
  if (message === undefined || message === null || message === '') return 'אירעה שגיאה';
  const raw = String(message).trim();
  if (/[\u0590-\u05FF]/.test(raw)) return raw;
  const key = raw.toLowerCase();
  if (API_ERROR_HE[key]) return API_ERROR_HE[key];
  if (/^5\d\d\b/.test(key) || key.includes('internal')) return API_ERROR_HE.server_error;
  if (key.includes('network') || key.includes('fetch')) return API_ERROR_HE.network_error;
  return 'אירעה שגיאה';
}
