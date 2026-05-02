/**
 * sheet-schema.gs
 * מקור אמת יחיד למבנה workbook (Headers + תוויות + מדיניות שימור נתונים).
 *
 * data_long / data_short: כוללות grade + class_group בין school לבין activity_type.
 * settings: value_type במקום active בעמודה C (מכילה text/number/csv/date/boolean).
 * lists: label_he במקום active בעמודה C (מכילה תווית עברית).
 * permissions: 21 עמודות — ללא כפילויות. allowExtraColumns: true לטיפול ב-legacy cols.
 */

var __systemSheetSchemaCache_ = null;

function getSystemSheetSchema_() {
  if (__systemSheetSchemaCache_) return __systemSheetSchemaCache_;
  __systemSheetSchemaCache_ = {
  data_long: {
    sheetName: 'data_long', required: true, type: 'source',
    headers: ['RowID','activity_manager','authority','school','grade','class_group','activity_type','activity_no','activity_name','sessions','price','funding','start_time','end_time','emp_id','instructor_name','start_date','end_date','status','notes','finance_status','finance_notes'],
    hebrewLabels: ['RowID','מנהל פעילות','רשות','בית ספר','כיתה','קבוצה','סוג פעילות','מספר פעילות','שם פעילות','מפגשים','מחיר','מימון','שעת התחלה','שעת סיום','ת.ז. מדריך','שם מדריך','תאריך התחלה','תאריך סיום','סטטוס','הערות','סטטוס כספי','הערות כספיות'],
    dataStartRow: 3, allowExtraColumns: true, preserveExistingData: true, legacyFinanceColumns: false
  },
  data_short: {
    sheetName: 'data_short', required: true, type: 'source',
    headers: ['RowID','activity_manager','authority','school','grade','class_group','activity_type','activity_no','activity_name','sessions','price','funding','start_time','end_time','emp_id','instructor_name','emp_id_2','instructor_name_2','start_date','status','notes','finance_status','finance_notes'],
    hebrewLabels: ['RowID','מנהל פעילות','רשות','בית ספר','כיתה','קבוצה','סוג פעילות','מספר פעילות','שם פעילות','מפגשים','מחיר','מימון','שעת התחלה','שעת סיום','ת.ז. מדריך','שם מדריך','ת.ז. מדריך 2','שם מדריך 2','תאריך התחלה','סטטוס','הערות','סטטוס כספי','הערות כספיות'],
    dataStartRow: 3, allowExtraColumns: true, preserveExistingData: true, legacyFinanceColumns: false
  },
  activity_meetings: {
    sheetName: 'activity_meetings', required: true, type: 'source',
    headers: ['source_row_id','meeting_no','meeting_date','notes','active'],
    hebrewLabels: ['מזהה שורת מקור','מספר מפגש','תאריך מפגש','הערות','פעיל'],
    dataStartRow: 3, allowExtraColumns: true, preserveExistingData: true, legacyFinanceColumns: false
  },
  permissions: {
    sheetName: 'permissions', required: true, type: 'source',
    headers: ['user_id','entry_code','full_name','display_role','default_view','view_admin','view_dashboard','view_activities','view_week','view_month','view_instructors','view_exceptions','view_my_data','view_contacts','view_finance','view_permissions','can_request_edit','can_edit_direct','can_add_activity','can_review_requests','active'],
    hebrewLabels: ['מזהה משתמש','קוד כניסה','שם מלא','תפקיד תצוגה','מסך ברירת מחדל','ניהול','לוח בקרה','פעילויות','שבוע','חודש','מדריכים','חריגות','הנתונים שלי','אנשי קשר','כספים','הרשאות','בקשת עריכה','עריכה ישירה','הוספת פעילות','אישור בקשות','פעיל'],
    dataStartRow: 3, allowExtraColumns: true, preserveExistingData: true, legacyFinanceColumns: true
  },
  settings: {
    sheetName: 'settings', required: true, type: 'source',
    headers: ['setting_key','setting_value','value_type','notes','active'],
    hebrewLabels: ['מפתח הגדרה','ערך','סוג ערך','הערות','פעיל'],
    dataStartRow: 3, allowExtraColumns: true, preserveExistingData: true, legacyFinanceColumns: false
  },
  lists: {
    sheetName: 'lists', required: true, type: 'source',
    headers: ['name','value','label_he','parent_value','activity_no','activity_name','active'],
    hebrewLabels: ['שם רשימה','ערך','תווית עברית','ערך אב','מספר פעילות','שם פעילות','פעיל'],
    dataStartRow: 3, allowExtraColumns: true, preserveExistingData: true, legacyFinanceColumns: false
  },
  contacts_instructors: {
    sheetName: 'contacts_instructors', required: true, type: 'source',
    headers: ['emp_id','full_name','mobile','email','address','employment_type','direct_manager','active'],
    hebrewLabels: ['ת.ז.','שם מלא','נייד','דוא"ל','כתובת','סוג העסקה','מנהל ישיר','פעיל'],
    dataStartRow: 3, allowExtraColumns: true, preserveExistingData: true, legacyFinanceColumns: false
  },
  contacts_schools: {
    sheetName: 'contacts_schools', required: true, type: 'source',
    headers: ['authority','school','contact_name','contact_role','phone','mobile','email','address','notes','active'],
    hebrewLabels: ['רשות','בית ספר','שם איש קשר','תפקיד','טלפון','נייד','דוא"ל','כתובת','הערות','פעיל'],
    dataStartRow: 3, allowExtraColumns: true, preserveExistingData: true, legacyFinanceColumns: false
  },
  operations_private_notes: {
    sheetName: 'operations_private_notes', required: true, type: 'source',
    headers: ['source_sheet','source_row_id','note_text','updated_at','updated_by','active'],
    hebrewLabels: ['גיליון מקור','מזהה שורת מקור','תוכן הערה','עודכן בתאריך','עודכן על ידי','פעיל'],
    dataStartRow: 3, allowExtraColumns: true, preserveExistingData: true, legacyFinanceColumns: false
  },
  edit_requests: {
    sheetName: 'edit_requests', required: true, type: 'source',
    headers: ['request_id','source_sheet','source_row_id','field_name','old_value','new_value','requested_by_user_id','requested_by_name','requested_at','status','reviewed_at','reviewed_by','reviewer_notes','active'],
    hebrewLabels: ['מזהה בקשה','גיליון מקור','מזהה שורת מקור','שם שדה','ערך ישן','ערך חדש','מזהה מבקש','שם מבקש','תאריך בקשה','סטטוס','תאריך בדיקה','בודק','הערות בודק','פעיל'],
    dataStartRow: 3, allowExtraColumns: true, preserveExistingData: true, legacyFinanceColumns: false
  },
  view_activity_meetings: {
    sheetName: 'view_activity_meetings', required: true, type: 'view',
    headers: ['RowID','source_sheet','activity_type','activity_manager','start_date','end_date','status','emp_id','instructor_name'],
    hebrewLabels: ['RowID','גיליון מקור','סוג פעילות','מנהל פעילות','תאריך התחלה','תאריך סיום','סטטוס','ת.ז. מדריך','שם מדריך'],
    dataStartRow: 3, allowExtraColumns: false, preserveExistingData: false, legacyFinanceColumns: false
  },
  view_dashboard_monthly: {
    sheetName: 'view_dashboard_monthly', required: true, type: 'view',
    headers: ['month_ym','metric_key','metric_value','updated_at'],
    hebrewLabels: ['חודש','מפתח מדד','ערך מדד','עודכן בתאריך'],
    dataStartRow: 3, allowExtraColumns: false, preserveExistingData: false, legacyFinanceColumns: false
  },
  view_activities_summary: {
    sheetName: 'view_activities_summary', required: true, type: 'view',
    headers: ['month_ym','activity_type','total','updated_at'],
    hebrewLabels: ['חודש','סוג פעילות','סך הכול','עודכן בתאריך'],
    dataStartRow: 3, allowExtraColumns: false, preserveExistingData: false, legacyFinanceColumns: false
  },
  dashboard_refresh_control: {
    sheetName: 'dashboard_refresh_control', required: true, type: 'system',
    headers: ['key', 'value', 'label_he'],
    hebrewLabels: ['מפתח', 'ערך', 'תווית'],
    dataStartRow: 3, allowExtraColumns: false, preserveExistingData: false, legacyFinanceColumns: false
  },
  dashboard_summary_snapshot: {
    sheetName: 'dashboard_summary_snapshot', required: true, type: 'snapshot',
    headers: ['month_ym','month_label','updated_at','total_short_activities','total_long_activities','active_courses_current_month','active_workshops_current_month','active_tours_current_month','active_after_school_current_month','active_escape_room_current_month','exceptions_count','active_instructors_count','course_endings_current_month','active_courses_next_month','missing_instructor_count','missing_start_date_count','late_end_date_count','active_instructors_names'],
    hebrewLabels: ['חודש','תווית חודש','עודכן בתאריך','סך פעילויות חד-יומיות','סך תוכניות','קורסים פעילים בחודש נוכחי','סדנאות פעילות בחודש נוכחי','סיורים פעילים בחודש נוכחי','צהרונים פעילים בחודש נוכחי','חדרי בריחה פעילים בחודש נוכחי','חריגות','מדריכים פעילים','סיומי קורסים בחודש נוכחי','קורסים פעילים בחודש הבא','ללא מדריך','ללא תאריך התחלה','תאריך סיום מאוחר','שמות מדריכים פעילים'],
    dataStartRow: 3, allowExtraColumns: false, preserveExistingData: false, legacyFinanceColumns: false
  },
  dashboard_by_manager_snapshot: {
    sheetName: 'dashboard_by_manager_snapshot', required: true, type: 'snapshot',
    headers: ['month_ym','activity_manager','manager_display_name','total_short','total_long','total','num_instructors','course_endings','exceptions','active_instructors_names','updated_at','snapshot_key'],
    hebrewLabels: ['חודש','מנהל פעילות','שם תצוגה מנהל','חד-יומי','תוכניות','סך הכול','מספר מדריכים','סיומי קורסים','חריגות','שמות מדריכים פעילים','עודכן בתאריך','מפתח snapshot'],
    dataStartRow: 3, allowExtraColumns: false, preserveExistingData: false, legacyFinanceColumns: false
  },
  activities_snapshot: {
    sheetName: 'activities_snapshot', required: true, type: 'snapshot',
    headers: ['snapshot_key','updated_at','activity_type_counts_json','rows_json'],
    hebrewLabels: ['מפתח snapshot','עודכן בתאריך','ספירות לפי סוג פעילות','שורות פעילות לתצוגה'],
    dataStartRow: 3, allowExtraColumns: false, preserveExistingData: false, legacyFinanceColumns: false
  },
  read_models: {
    sheetName: 'read_models', required: true, type: 'system',
    headers: ['key','updated_at','version','hash','source_updated_at','status','duration_ms','rows_count','payload_size','last_error','storage_type','storage_ref'],
    hebrewLabels: ['מפתח','עודכן בתאריך','גרסה','hash','עודכן מקור','סטטוס','משך (ms)','מספר שורות','גודל payload','שגיאה אחרונה','סוג אחסון','מזהה אחסון'],
    dataStartRow: 3, allowExtraColumns: false, preserveExistingData: false, legacyFinanceColumns: false
  },
  אפיון: {
    sheetName: 'אפיון', required: false, type: 'documentation',
    headers: [], hebrewLabels: [],
    dataStartRow: 3, allowExtraColumns: true, preserveExistingData: true, legacyFinanceColumns: false
  }
  };
  return __systemSheetSchemaCache_;
}

function getSystemSheetSpec_(sheetName) {
  var schema = getSystemSheetSchema_();
  return schema[text_(sheetName)] || null;
}
