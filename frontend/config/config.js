// ============================================================
// config.js — Central configuration for the entire app
// ============================================================

export const CONFIG = {
  // Replace with the deployed Apps Script Web App URL
  API_URL: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec",

  APP_NAME: "תעשיידע",
  APP_VERSION: "1.0.0",

  // Cache duration in milliseconds
  CACHE_TTL: 5 * 60 * 1000, // 5 minutes

  // Session key for localStorage
  SESSION_KEY: "taasiyeda_session",

  // Default screen after login (overridden by user's default_view)
  DEFAULT_SCREEN: "dashboard",
};

export const SCREENS = [
  { id: "dashboard",    label: "דשבורד",         icon: "⊞",  perm: "view_dashboard" },
  { id: "activities",   label: "פעילויות",        icon: "◈",  perm: "view_activities" },
  { id: "week",         label: "שבוע",            icon: "▦",  perm: "view_week" },
  { id: "month",        label: "חודש",            icon: "▣",  perm: "view_month" },
  { id: "instructors",  label: "מדריכים",         icon: "◉",  perm: "view_instructors" },
  { id: "exceptions",   label: "חריגות",          icon: "⚠",  perm: "view_exceptions" },
  { id: "my_data",      label: "המסך שלי",        icon: "◎",  perm: "view_my_data" },
  { id: "contacts",     label: "אנשי קשר",        icon: "◐",  perm: "view_contacts" },
  { id: "finance",      label: "כספים",           icon: "◑",  perm: "view_finance" },
  { id: "permissions",  label: "הרשאות",          icon: "◒",  perm: "view_permissions" },
];

export const ACTIVITY_TYPES = [
  { value: "all",          label: "הכל" },
  { value: "course",       label: "קורס" },
  { value: "after_school", label: "חוג" },
  { value: "workshop",     label: "סדנה" },
  { value: "tour",         label: "סיור" },
  { value: "escape_room",  label: "חדר בריחה" },
];

export const STATUSES = {
  active:        { open: "פעיל",    closed: "סגור" },
  finance:       { open: "פתוח",   closed: "סגור" },
  edit_requests: { pending: "ממתין", approved: "אושר", rejected: "נדחה" },
};
