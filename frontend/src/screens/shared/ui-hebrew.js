/** Visible UI strings only (Hebrew). Internal API values stay English where required. */

/** Display names for short vs long activity families (UI only; not API/sheet keys). */
export const UI_ACTIVITY_FAMILY_SHORT = 'חד-יומיות';
export const UI_ACTIVITY_FAMILY_LONG = 'תוכניות';

export const HEBREW_ROLE = {
  admin: 'מנהל/ת',
  operation_manager: 'מנהל/ת תפעול',
  authorized_user: 'משתמש/ת מורשה',
  instructor: 'מדריך/ה',
  finance: 'כספים',
  activities_manager: 'מנהל/ת פעילויות',
  domain_manager: 'מנהל/ת תחום',
  business_development_manager: 'מנהלת פיתוח עסקי',
  instructor_manager: 'מנהל/ת הדרכה / מדריך/ת מנהל/ת'
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
  if (k === 'end_date_after_cutoff' || k === 'end_date_passed') return 'danger';
  if (k === 'missing_instructor' || k === 'missing_start_date') return 'warning';
  return 'neutral';
}

export const HEBREW_EXCEPTION_TYPE = {
  missing_instructor:       'ללא מדריך',
  missing_district:         'ללא מחוז / לא משויך',
  missing_start_date:       'ללא תאריך התחלה',
  missing_end_date:         'ללא תאריך סיום',
  end_date_after_cutoff:    'תאריך סיום מאוחר',
  end_date_passed:          'הסתיימה ולא נסגרה'
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
  authority: 'רשות',
  school: 'בית ספר',
  grade: 'שכבה',
  class_group: 'כיתה',
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
  source_sheet: 'גיליון מקור',
  instructor_name: 'שם מדריך',
  instructor_name_2: 'שם מדריך נוסף',
  notes: 'הערות'
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
  view_catalog: 'צפייה — קטלוג',
  view_orders: 'צפייה — הזמנות',
  view_invitations: 'צפייה — הזמנות',
  view_week: 'צפייה — שבוע',
  view_month: 'צפייה — חודש',
  view_instructors: 'צפייה — מדריכים',
  view_exceptions: 'צפייה — חריגות',
  view_my_data: 'צפייה — הנתונים שלי',
  view_operations_data: 'צפייה — נתוני תפעול',
  view_operations_management: 'צפייה — ניהול תפעול',
  finance_access: 'גישה — כספים / גבייה',
  can_access_personal_reports: 'גישה — דוחות אישיים',
  view_contacts_instructors: 'צפייה — אנשי קשר מדריכים',
  'view_contacts_instructors 2': 'צפייה — אנשי קשר מדריכים (2)',
  view_permissions: 'צפייה — הרשאות',
  view_edit_requests: 'צפייה — בקשות עריכה',
  view_final_approvals: 'צפייה — אישורים סופיים',
  view_contacts: 'צפייה — אנשי קשר (מקור ישן)',
  view_proposals: 'צפייה — הצעות מחיר',
  view_israa_management: 'צפייה — ניהול איסראא',
  can_request_edit: 'יכול לבקש עריכה',
  can_request_edit_2: 'יכול לבקש עריכה 2',
  can_request_create_activity: 'יכול לבקש הוספת פעילות',
  can_edit_direct: 'עריכה ישירה',
  can_add_activity: 'הוספת פעילות',
  can_review_requests: 'אישור בקשות',
  can_review_requests_2: 'אישור בקשות 2'
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
  authority: 'רשות',
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
  validation_error: 'השמירה נכשלה בגלל נתונים לא תקינים — בדקו את השדות ונסו שוב',
  conflict: 'השמירה נכשלה בגלל התנגשות נתונים — רעננו ונסו שוב',
  rls_forbidden: 'אין הרשאת שמירה לנתון הזה — פנו למנהל המערכת לבדיקת הרשאות/RLS',
  activity_not_found_or_forbidden: 'הפעילות לא נמצאה או שאין הרשאה לערוך אותה',
  delete_activity_not_confirmed: 'הפעילות לא נמחקה. ייתכן שאין הרשאה או שהפעילות לא נמצאה.',
  submit_edit_request_failed: 'שליחת בקשת העריכה נכשלה — פנו למנהל המערכת',
  save_failed: 'שמירת הפעילות נכשלה — פנו למנהל המערכת',
  missing_row_id: 'חסר מזהה פעילות לשמירה',
  'user_id is required': 'יש להזין מזהה משתמש',
  invalid_credentials: 'מספר עובד או קוד שגויים',
  no_supabase_client: 'חיבור Supabase אינו מוגדר — פנה למנהל המערכת',
  missing_user_id_or_entry_code: 'יש להזין מזהה משתמש וקוד כניסה',
  user_not_found: 'המשתמש/ת לא נמצא/ה במערכת',
  inactive_user: 'המשתמש אינו פעיל',
  entry_code_mismatch: 'קוד הכניסה שגוי',
  users_query_failed: 'בדיקת המשתמשים נכשלה — פנה למנהל המערכת',
  user_inactive: 'המשתמש אינו פעיל',
  invalid_role: 'תפקיד המשתמש אינו מוגדר כראוי — פנה למנהל המערכת',
  invalid_or_inactive_code: 'מספר עובד או קוד שגויים',
  entry_code_is_required: 'יש להזין קוד כניסה',
  'entry_code is required': 'יש להזין קוד כניסה',
  invalid_user: 'מספר עובד או קוד שגויים',
  login_failed: 'ההתחברות נכשלה',
  bootstrap_failed: 'כשל בטעינת נתוני משתמש אחרי התחברות',
  timeout: 'הבקשה נמשכה יותר מהצפוי — נסו שוב',
  request_timeout: 'הבקשה נמשכה יותר מהצפוי — נסו שוב',
  save_timeout: 'השמירה נמשכת זמן רב. ייתכן שהשינוי נשמר — רעננו בעוד רגע ובדקו שוב.',
  server_error: 'שגיאת שרת — נסו שוב מאוחר יותר',
  network_error: 'בעיית תקשורת — בדקו את החיבור לאינטרנט',
  offline: 'אין חיבור לרשת',
  user_already_exists: 'מזהה המשתמש כבר קיים במערכת',
  cannot_deactivate_self: 'לא ניתן להשבית את עצמך',
  cannot_delete_self: 'לא ניתן למחוק את עצמך',
  cannot_delete_active_user: 'ניתן למחוק משתמש/ת לא פעיל/ה בלבד',
  dashboard_sheet_missing: 'גיליון הדשבורד לא נמצא במסמך. פנה למנהל המערכת.',
  DASHBOARD_SHEET_MISSING: 'גיליון הדשבורד לא נמצא במסמך. פנה למנהל המערכת.'
};

/**
 * Maps an internal source key (e.g. 'activities', 'contacts_instructors')
 * to a short Hebrew label for display in screen sub-headers.
 */
const SHEET_LABEL_HE = {
  activities:           'פעילויות',
  contacts_instructors: 'אנשי קשר מדריכים',
  contacts_schools:     'אנשי קשר מוסדות',
  permissions:          'הרשאות',
  settings:             'הגדרות',
  lists:                'רשימות'
};

export function hebrewSheetLabel(sheetName) {
  if (!sheetName) return '';
  const k = String(sheetName).trim().toLowerCase();
  return SHEET_LABEL_HE[k] || sheetName;
}

/**
 * Given an array of instructors_screen_sources (sheet keys), return a
 * human-readable Hebrew description of the data origin.
 */
export function hebrewInstructorsSourcesLabel(sources) {
  const arr = Array.isArray(sources) ? sources : [];
  return arr.map(hebrewSheetLabel).join(', ') || 'כל הפעילויות';
}

/** Maps common API English errors to Hebrew; leaves Hebrew messages unchanged. */
export function translateApiErrorForUser(message) {
  if (message === undefined || message === null || message === '') return API_ERROR_HE.server_error;
  const raw = String(message).trim();
  if (/^DASHBOARD_MONTH_NOT_FOUND:/i.test(raw)) {
    return 'החודש שנבחר לא קיים בגיליון הדשבורד.';
  }
  if (/^DASHBOARD_SHEET_MISSING$/i.test(raw) || raw === 'DASHBOARD_SHEET_MISSING') {
    return API_ERROR_HE.DASHBOARD_SHEET_MISSING;
  }
  if (/[\u0590-\u05FF]/.test(raw)) return raw;
  const key = raw.toLowerCase();
  if (API_ERROR_HE[key]) return API_ERROR_HE[key];
  if (key.includes('activity_not_found_or_forbidden')) return API_ERROR_HE.activity_not_found_or_forbidden;
  if (/row-level security|rls|permission denied|violates row-level security/.test(key)) return API_ERROR_HE.rls_forbidden;
  if (/\b(400|pgrst102|pgrst204)\b/.test(key) || key.includes('bad request')) return API_ERROR_HE.bad_request;
  if (/\b(401|jwt|unauthorized)\b/.test(key)) return API_ERROR_HE.unauthorized;
  if (/\b403\b/.test(key) || key.includes('forbidden')) return API_ERROR_HE.forbidden;
  if (/\b404\b/.test(key) || key.includes('not found')) return API_ERROR_HE.not_found;
  if (/\b409\b/.test(key) || key.includes('duplicate key') || key.includes('conflict')) return API_ERROR_HE.conflict;
  if (/\b422\b/.test(key) || key.includes('invalid input') || key.includes('violates not-null') || key.includes('violates check')) return API_ERROR_HE.validation_error;
  if (key.includes('timeout') || key.includes('timed_out')) return API_ERROR_HE.timeout;
  if (/^5\d\d\b/.test(key) || /\b5\d\d\b/.test(key) || key.includes('internal')) return API_ERROR_HE.server_error;
  if (key.includes('network') || key.includes('fetch') || key.includes('cors') || key.includes('failed to fetch')) return API_ERROR_HE.network_error;
  return API_ERROR_HE.server_error;
}
