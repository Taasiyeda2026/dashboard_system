const CONFIG = {
  SYSTEM_NAME: 'Dashboard Taasiyeda',
  SPREADSHEET_ID: '1odLLnhpm7gLwSsDrgzxjIy2cuHXZGNNQYXCkuhAt52s',
  HEADER_ROW: 1,
  DATA_START_ROW: 3,
  LATE_END_DATE_CUTOFF: '2026-06-15',
  SESSION_CACHE_SECONDS: 60 * 60 * 8,
  /** Script cache TTL for dashboard / permissions list (seconds). */
  SCRIPT_CACHE_SECONDS: 60 * 30,
  /** Meetings map changes less frequently; keep a dedicated longer TTL. */
  MEETINGS_MAP_CACHE_SECONDS: 3600,
  SHEETS: {
    DATA_SHORT: 'data_short',
    DATA_LONG: 'data_long',
    MEETINGS: 'activity_meetings',
    PERMISSIONS: 'permissions',
    SETTINGS: 'settings',
    LISTS: 'lists',
    /** אנשי קשר מדריכים — מקור מידע למסך instructor-contacts בלבד; לא מקור תפעולי לזיהוי מדריך בפעילות */
    CONTACTS_INSTRUCTORS: 'contacts_instructors',
    SCHOOLS: 'contacts_schools',
    EDIT_REQUESTS: 'edit_requests',
    PRIVATE_NOTES: 'operations_private_notes',
    DASHBOARD_SUMMARY_SNAPSHOT: 'dashboard_summary_snapshot',
    DASHBOARD_BY_MANAGER_SNAPSHOT: 'dashboard_by_manager_snapshot',
    DASHBOARD_REFRESH_CONTROL: 'dashboard_refresh_control'
  },
  /** ברירת מחדל כשגיליון lists ריק או חסר — מיושר ל־lists במקור הנתונים */
  DEFAULT_PROGRAM_ACTIVITY_TYPES: ['course', 'after_school'],
  DEFAULT_ONE_DAY_ACTIVITY_TYPES: ['workshop', 'tour', 'escape_room'],
  DEFAULT_FINANCE_DISPLAY_RULE: 'ended_until_today',
  DEFAULT_FINANCE_GROUPING_RULE: 'gafen_by_school_else_funding',
  ACTIVITY_TYPES: ['all', 'course', 'after_school', 'workshop', 'tour', 'escape_room'],
  FINANCE_STATUSES: ['open', 'closed'],
  EDIT_REQUEST_STATUSES: ['pending', 'approved', 'rejected']
};
