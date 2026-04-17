const CONFIG = {
  SPREADSHEET_ID: '1odLLnhpm7gLwSsDrgzxjIy2cuHXZGNNQYXCkuhAt52s',
  LATE_END_DATE_CUTOFF: '2026-06-15',
  SHEETS: {
    data_short: [
      'RowID','activity_manager','authority','school','activity_type','activity_no','activity_name','sessions','price','funding','start_time','end_time','emp_id','instructor_name','emp_id_2','instructor_name_2','start_date','status','notes','finance_status','finance_notes'
    ],
    data_long: [
      'RowID','activity_manager','authority','school','activity_type','activity_no','activity_name','sessions','price','funding','start_time','end_time','emp_id','instructor_name','start_date','end_date','status','notes','finance_status','finance_notes'
    ],
    activity_meetings: ['source_row_id','meeting_no','meeting_date','notes','active'],
    permissions: ['user_id','entry_code','full_name','display_role','default_view','view_admin','view_dashboard','view_activities','view_week','view_month','view_instructors','view_exceptions','view_my_data','view_contacts','view_finance','view_permissions','can_request_edit','can_edit_direct','can_add_activity','can_review_requests','active'],
    lists: ['list_name','value','label','parent_value','activity_type','activity_no','activity_name','active'],
    contacts_instructors: ['emp_id','full_name','mobile','email','address','employment_type','direct_manager','active'],
    contacts_schools: ['authority','school','contact_name','contact_role','phone','mobile','email','address','notes','active'],
    edit_requests: ['request_id','source_sheet','source_row_id','field_name','old_value','new_value','requested_by_user_id','requested_by_name','requested_at','status','reviewed_at','reviewed_by','reviewer_notes','active'],
    operations_private_notes: ['source_sheet','source_row_id','note_text','updated_at','updated_by','active']
  },
  MODULES: [
    { id: 'dashboard', title: 'Dashboard', type: 'derived', permission: 'view_dashboard' },
    { id: 'activities', title: 'Activities', type: 'derived', permission: 'view_activities', sheets: ['data_short', 'data_long'] },
    { id: 'activity_meetings', title: 'Activity Meetings', sheet: 'activity_meetings', permission: 'view_activities' },
    { id: 'lists', title: 'Lists', sheet: 'lists', permission: 'view_admin' },
    { id: 'contacts_instructors', title: 'Instructor Contacts', sheet: 'contacts_instructors', permission: 'view_contacts' },
    { id: 'contacts_schools', title: 'School Contacts', sheet: 'contacts_schools', permission: 'view_contacts' },
    { id: 'edit_requests', title: 'Edit Requests', sheet: 'edit_requests', permission: 'can_review_requests' },
    { id: 'permissions', title: 'Permissions', sheet: 'permissions', permission: 'view_permissions' },
    { id: 'operations_private_notes', title: 'Operations Notes', sheet: 'operations_private_notes', permission: 'view_admin' }
  ]
};
