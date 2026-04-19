/** Visible UI strings only (Hebrew). Internal API values stay English where required. */

/** Display names for short vs long activity families (UI only; not API/sheet keys). */
export const UI_ACTIVITY_FAMILY_SHORT = 'חד-יומיות';
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

/** Visible Hebrew labels for activities UI (tabs + type column). Order for tabs after "הכל" is in ACTIVITY_TAB_ORDER. */
export const ACTIVITY_TAB_ORDER = ['course', 'workshop', 'after_school', 'escape_room', 'tour'];

const VISIBLE_ACTIVITY_LABELS = {
  all: 'הכל',
  course: 'קורסים',
  workshop: 'סדנאות',
  after_school: 'חוגים',
  escape_room: 'חדרי בריחה',
  tour: 'סיורים'
};

export function visibleActivityCategoryLabel(value) {
  const k = String(value || '').trim();
  if (VISIBLE_ACTIVITY_LABELS[k]) return VISIBLE_ACTIVITY_LABELS[k];
  return 'לא מסווג';
}

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

/** מפתח ל־dsStatusChip: success / warning / danger / neutral */
export function financeStatusVariant(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'closed') return 'success';
  if (v === 'open') return 'warning';
  return 'neutral';
}

/** חריגות: עוצמת chip לפי סוג */
export function exceptionTypeVariant(exceptionType) {
  const k = String(exceptionType || '').trim();
  if (k === 'late_end_date') return 'danger';
  if (k === 'missing_instructor' || k === 'missing_start_date') return 'warning';
  return 'neutral';
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
  activity_manager: 'מנהל פעילויות',
  user_id: 'מזהה משתמש',
  default_view: 'מסך ברירת מחדל',
  display_role: 'תפקיד',
  actions: 'פעולות',
  exception_type: 'סוג חריגה',
  private_note: 'הערה פרטית',
  address: 'כתובת',
  funding: 'מימון',
  finance_notes: 'הערות כספים',
  sessions: 'מפגשים',
  price: 'מחיר',
  amount: 'סכום',
  source_sheet: 'גיליון מקור'
};

export function hebrewColumn(key) {
  if (key === undefined || key === null) return 'שדה';
  const k = String(key).trim();
  return COLUMN_LABELS[k] || 'שדה';
}

/** תוויות לשדות הרשאה (מקור: גיליון permissions) */
const PERMISSION_FIELD_LABELS = {
  default_view: 'מסך ברירת מחדל',
  display_role2: 'תיאור תפקיד',
  entry_code: 'קוד כניסה',
  full_name: 'שם מלא',
  view_admin: 'צפייה — ניהול',
  view_dashboard: 'צפייה — לוח בקרה',
  view_activities: 'צפייה — פעילויות',
  view_week: 'צפייה — שבוע',
  view_month: 'צפייה — חודש',
  view_instructors: 'צפייה — מדריכים',
  view_exceptions: 'צפייה — חריגות',
  view_my_data: 'צפייה — הנתונים שלי',
  view_operations_data: 'צפייה — נתוני תפעול',
  view_contacts_instructors: 'צפייה — אנשי קשר מדריכים',
  'view_contacts_instructors 2': 'צפייה — אנשי קשר מדריכים (2)',
  view_finance: 'צפייה — כספים',
  view_permissions: 'צפייה — הרשאות',
  view_edit_requests: 'צפייה — בקשות עריכה',
  view_final_approvals: 'צפייה — אישורים סופיים',
  view_contacts: 'צפייה — אנשי קשר (מקור ישן)',
  can_request_edit: 'יכול לבקש עריכה',
  can_edit_direct: 'עריכה ישירה',
  can_add_activity: 'הוספת פעילות',
  can_review_requests: 'אישור בקשות'
};

export function hebrewPermissionField(key) {
  const k = String(key || '').trim();
  if (PERMISSION_FIELD_LABELS[k]) return PERMISSION_FIELD_LABELS[k];
  const norm = k.replace(/\s+/g, '_');
  if (PERMISSION_FIELD_LABELS[norm]) return PERMISSION_FIELD_LABELS[norm];
  if (COLUMN_LABELS[norm]) return COLUMN_LABELS[norm];
  return k || 'שדה';
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
  offline: 'אין חיבור לרשת',
  user_already_exists: 'מזהה המשתמש כבר קיים במערכת',
  user_not_found: 'המשתמש/ת לא נמצא/ה במערכת',
  cannot_deactivate_self: 'לא ניתן להשבית את עצמך',
  cannot_delete_self: 'לא ניתן למחוק את עצמך',
  cannot_delete_active_user: 'ניתן למחוק משתמש/ת לא פעיל/ה בלבד'
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
