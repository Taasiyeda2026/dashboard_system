const CONFIG = {
  SPREADSHEET_ID: '1odLLnhpm7gLwSsDrgzxjIy2cuHXZGNNQYXCkuhAt52s',
  HEADER_ROW: 1,
  DATA_START_ROW: 3,
  LATE_END_DATE_CUTOFF: '2026-06-15',
  SESSION_CACHE_SECONDS: 60 * 60 * 8,
  SHEETS: {
    DATA_SHORT: 'data_short',
    DATA_LONG: 'data_long',
    MEETINGS: 'activity_meetings',
    PERMISSIONS: 'permissions',
    LISTS: 'lists',
    INSTRUCTORS: 'contacts_instructors',
    SCHOOLS: 'contacts_schools',
    EDIT_REQUESTS: 'edit_requests',
    PRIVATE_NOTES: 'operations_private_notes'
  },
  ACTIVITY_TYPES: ['all', 'course', 'after_school', 'workshop', 'tour', 'escape_room'],
  FINANCE_STATUSES: ['open', 'closed'],
  EDIT_REQUEST_STATUSES: ['pending', 'approved', 'rejected']
};
