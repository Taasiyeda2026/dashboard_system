/**
 * Business capability registry. Every user-facing route, workspace tab and
 * management tool must be represented here as managed or admin-only.
 */
export const CAPABILITY_REGISTRY = Object.freeze([
  { id: 'dashboard', label: 'לוח בקרה', type: 'page', permission: 'view_dashboard', route: 'dashboard' },
  { id: 'activities', label: 'פעילויות', type: 'workspace', permission: 'view_activities', route: 'activities' },
  { id: 'activities.calendar', parent: 'activities', label: 'תצוגות שבוע וחודש', type: 'tab', permission: 'view_activity_calendar', routes: ['week', 'month'] },
  { id: 'activities.exceptions', parent: 'activities', label: 'חריגות', type: 'tab', permission: 'view_activity_exceptions', route: 'exceptions' },
  { id: 'activities.end_dates', parent: 'activities', label: 'תאריכי סיום', type: 'tab', permission: 'view_activity_end_dates', route: 'end-dates' },
  { id: 'activities.archive', parent: 'activities', label: 'ארכיון', type: 'tab', permission: 'view_activity_archive', route: 'archive' },
  { id: 'activities.archive_manage', parent: 'activities.archive', label: 'הערות פרטיות ופתיחה מחדש', type: 'action', permission: 'manage_activity_archive' },
  { id: 'activities.add', parent: 'activities', label: 'הוספת פעילות', type: 'action', permission: 'can_add_activity' },
  { id: 'activities.edit', parent: 'activities', label: 'עריכה ישירה', type: 'action', permission: 'can_edit_direct' },
  { id: 'activities.request_edit', parent: 'activities', label: 'בקשת שינוי', type: 'action', permission: 'can_request_edit' },
  { id: 'activities.request_create', parent: 'activities', label: 'בקשת יצירת פעילות', type: 'action', permission: 'can_request_create_activity' },
  { id: 'activities.review', parent: 'activities', label: 'אישור בקשות', type: 'action', permission: 'can_review_requests', route: 'edit-requests' },
  { id: 'contacts', label: 'אנשי קשר', type: 'page', permission: 'view_contacts', route: 'contacts' },

  { id: 'instructors', label: 'מדריכים', type: 'workspace', permission: 'view_instructors' },
  { id: 'instructors.list', parent: 'instructors', label: 'רשימת מדריכים', type: 'tab', permission: 'view_instructor_list', route: 'instructors', tab: 'list' },
  { id: 'instructors.contacts', parent: 'instructors', label: 'אנשי קשר מדריכים', type: 'tab', permission: 'view_instructor_contacts', route: 'instructor-contacts' },
  { id: 'instructors.scheduling', parent: 'instructors', label: 'שיבוצים', type: 'tab', permission: 'view_operations_scheduling', route: 'course-scheduling', tab: 'scheduling' },
  { id: 'instructors.work_schedule', parent: 'instructors', label: 'סידור עבודה', type: 'tab', permission: 'view_instructor_work_schedule', route: 'operations-management', tab: 'work-schedule', context: 'instructors' },
  { id: 'instructors.attendance_control', parent: 'instructors', label: 'בקרת נוכחות', type: 'tab', permission: 'view_attendance_control', route: 'operations-management', tab: 'payroll-control', context: 'instructors' },
  { id: 'instructors.maintenance', parent: 'instructors', label: 'תחזוקה', type: 'tab', permission: 'manage_instructor_maintenance', route: 'course-scheduling', tab: 'maintenance' },
  { id: 'instructors.employee_files', parent: 'instructors', label: 'תיקי עובדים', type: 'tool', permission: 'view_employee_files' },
  { id: 'attendance_reporting', label: 'מערכת דיווח נוכחות למדריך', type: 'external_app', permission: 'access_attendance_reporting' },

  { id: 'instructor_portal', label: 'אזור אישי למדריך', type: 'workspace', permission: 'view_instructor_portal' },
  { id: 'instructor_portal.calendar', parent: 'instructor_portal', label: 'לוח שנה', type: 'page', permission: 'view_instructor_calendar', route: 'instructor-calendar' },
  { id: 'instructor_portal.data', parent: 'instructor_portal', label: 'הפעילויות שלי', type: 'page', permission: 'view_instructor_data', route: 'my-data' },
  { id: 'instructor_portal.approvals', parent: 'instructor_portal', label: 'אישורי ביצוע', type: 'page', permission: 'view_instructor_completion_approvals', route: 'instructor-completion-approvals' },
  { id: 'instructor_portal.guidelines', parent: 'instructor_portal', label: 'נהלים', type: 'page', permission: 'view_instructor_guidelines', route: 'instructor-guidelines' },

  { id: 'operations', label: 'תפעול', type: 'workspace', permission: 'view_operations_management', route: 'operations-management' },
  { id: 'operations.authorities', parent: 'operations', label: 'רשויות ובתי ספר', type: 'tab', permission: 'view_operations_schedule_overview', tab: 'authorities' },
  { id: 'operations.approvals', parent: 'operations', label: 'אישורי פעילות', type: 'tab', permission: 'view_activity_approvals', tab: 'completion_approval' },
  { id: 'operations.stock', parent: 'operations', label: 'מלאי סדנאות', type: 'tab', permission: 'view_workshop_stock', tab: 'workshops' },
  { id: 'operations.distributions', parent: 'operations.stock', label: 'הפצות מלאי', type: 'tool', permission: 'view_workshop_stock_distributions' },
  { id: 'operations.orders', parent: 'operations', label: 'הזמנות לאירועים', type: 'page', permission: 'view_orders', routes: ['invitations', 'orders'] },
  { id: 'operations.catalog', parent: 'operations', label: 'קטלוג', type: 'page', permission: 'view_catalog', route: 'catalog' },
  { id: 'operations.catalog_manage', parent: 'operations.catalog', label: 'ניהול הקטלוג', type: 'action', permission: 'manage_catalog' },
  { id: 'operations.certificates', parent: 'operations', label: 'תעודות', type: 'page', permission: 'view_certificates', route: 'certificates' },
  { id: 'operations.workshop_training', parent: 'operations', label: 'הכשרות סדנאות', type: 'tab', permission: 'manage_workshop_training', tab: 'summer_training_matrix' },
  { id: 'operations.course_training', parent: 'operations', label: 'הכשרות קורסים', type: 'tab', permission: 'manage_course_training', tab: 'course_training_matrix' },
  { id: 'operations.print_kits', parent: 'operations', label: 'ערכות דפוס', type: 'tab', permission: 'manage_print_kits', tab: 'course_print_kits' },

  { id: 'proposals', label: 'הצעות מחיר והסכמים', type: 'page', permission: 'view_proposals_agreements', route: 'proposals-agreements' },
  { id: 'proposals.manage', parent: 'proposals', label: 'יצירה, עריכה וניהול', type: 'action', permission: 'manage_proposals_agreements' },
  { id: 'proposals.approve', parent: 'proposals', label: 'אישור וחתימה', type: 'action', permission: 'approve_proposals_agreements' },
  { id: 'finance', label: 'כספים', type: 'workspace', permission: 'finance_access', route: 'finance' },
  { id: 'finance.attendance', parent: 'finance', label: 'נוכחות ושכר', type: 'tool', permission: 'view_finance_payroll' },
  { id: 'finance.collection', parent: 'finance', label: 'מעקב גבייה', type: 'tool', permission: 'view_finance_collection' },
  { id: 'finance.transactions', parent: 'finance', label: 'חשבונות עסקה', type: 'tool', permission: 'manage_finance_transactions' },
  { id: 'reports', label: 'דוחות אישיים', type: 'page', permission: 'can_access_personal_reports', route: 'personal-reports' },
  { id: 'reports.manage', parent: 'reports', label: 'ניהול דוחות עובדים', type: 'action', permission: 'personal_reports_manager' },
  { id: 'israa', label: 'ניהול איסראא', type: 'page', permission: 'view_israa_management', route: 'israa-management' },

  { id: 'admin.home', label: 'מרכז הניהול', type: 'workspace', adminOnly: true, route: 'admin-home' },
  { id: 'admin.permissions', parent: 'admin.home', label: 'הרשאות', type: 'page', adminOnly: true, route: 'permissions' },
  { id: 'admin.settings', parent: 'admin.home', label: 'הגדרות מערכת', type: 'page', adminOnly: true, route: 'admin-settings' },
  { id: 'admin.lists', parent: 'admin.home', label: 'ניהול רשימות', type: 'page', adminOnly: true, route: 'admin-lists' },
  { id: 'admin.attendance', parent: 'admin.home', label: 'בקרת נוכחות אדמין ושכר', type: 'tool', adminOnly: true },
  { id: 'admin.team_board', parent: 'admin.home', label: 'לוח מנהל צוות', type: 'tool', adminOnly: true },
  { id: 'admin.messages', parent: 'admin.home', label: 'הודעות לעובדים', type: 'tool', adminOnly: true },
  { id: 'admin.data', parent: 'admin.home', label: 'כלי נתונים', type: 'tool', adminOnly: true },
  { id: 'admin.summer_feedback', parent: 'admin.home', label: 'משוב קיץ', type: 'external_app', adminOnly: true }
]);

export const capabilityById = new Map(CAPABILITY_REGISTRY.map((item) => [item.id, item]));
export const MANAGED_CAPABILITIES = Object.freeze(CAPABILITY_REGISTRY.filter((item) => item.permission));
export const ADMIN_ONLY_CAPABILITIES = Object.freeze(CAPABILITY_REGISTRY.filter((item) => item.adminOnly));
export const ALL_PERMISSION_KEYS = Object.freeze([...new Set(MANAGED_CAPABILITIES.map((item) => item.permission))]);

const yesFlags = (...keys) => Object.freeze(Object.fromEntries(keys.map((key) => [key, 'yes'])));
const STAFF_COMMON = [
  'view_dashboard', 'view_activities', 'view_activity_calendar', 'view_activity_exceptions',
  'view_activity_end_dates', 'view_activity_archive', 'view_contacts', 'view_instructors',
  'view_instructor_list', 'view_instructor_contacts', 'view_certificates',
  'can_access_personal_reports', 'view_operations_management'
];

export const ROLE_PERMISSION_TEMPLATES = Object.freeze({
  admin: yesFlags(...ALL_PERMISSION_KEYS),
  operation_manager: yesFlags(...STAFF_COMMON, 'can_add_activity', 'can_edit_direct', 'can_request_edit',
    'can_request_create_activity', 'can_review_requests', 'manage_activity_archive',
    'view_operations_management', 'view_operations_scheduling', 'view_instructor_work_schedule',
    'view_operations_schedule_overview',
    'view_attendance_control', 'manage_instructor_maintenance', 'view_activity_approvals',
    'view_workshop_stock', 'view_workshop_stock_distributions', 'view_orders', 'view_catalog',
    'view_proposals_agreements', 'manage_proposals_agreements', 'view_employee_files'),
  activities_manager: yesFlags(...STAFF_COMMON, 'can_add_activity', 'can_request_edit',
    'can_request_create_activity', 'view_operations_management', 'view_instructor_work_schedule',
    'view_operations_schedule_overview', 'view_orders', 'view_catalog', 'view_employee_files'),
  finance: yesFlags(...STAFF_COMMON, 'finance_access', 'view_attendance_control', 'view_orders',
    'view_catalog', 'view_employee_files', 'view_finance_payroll', 'view_finance_collection',
    'manage_finance_transactions'),
  domain_manager: yesFlags(...STAFF_COMMON, 'view_orders', 'view_catalog',
    'view_proposals_agreements', 'manage_proposals_agreements', 'view_employee_files'),
  business_development_manager: yesFlags(...STAFF_COMMON, 'can_add_activity', 'can_request_edit',
    'can_request_create_activity', 'view_orders', 'view_catalog', 'view_proposals_agreements',
    'view_employee_files'),
  instructor_manager: yesFlags(...STAFF_COMMON, 'can_add_activity', 'can_request_edit',
    'can_request_create_activity', 'view_orders', 'view_catalog', 'view_employee_files'),
  authorized_user: yesFlags(...STAFF_COMMON, 'can_add_activity', 'can_request_edit', 'can_request_create_activity'),
  instructor: yesFlags('access_attendance_reporting', 'view_instructor_portal', 'view_instructor_calendar',
    'view_instructor_data', 'view_instructor_completion_approvals', 'view_instructor_guidelines')
});

export function capabilityTree() {
  const children = new Map();
  for (const item of CAPABILITY_REGISTRY) {
    if (!children.has(item.parent || '')) children.set(item.parent || '', []);
    children.get(item.parent || '').push({ ...item, children: [] });
  }
  const nodes = new Map([...children.values()].flat().map((item) => [item.id, item]));
  for (const item of nodes.values()) item.children = children.get(item.id) || [];
  return children.get('') || [];
}

export function routeCapability(route) {
  return CAPABILITY_REGISTRY.find((item) => item.route === route || item.routes?.includes(route));
}

export function tabCapability(tab, context = '') {
  return CAPABILITY_REGISTRY.find((item) => item.tab === tab && (!item.context || item.context === context));
}
