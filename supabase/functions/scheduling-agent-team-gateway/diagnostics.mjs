// Safe, actionable scheduling errors for the staff MCP gateway.
// Do not forward raw database error messages, SQL details or identities.
const REASONS = Object.freeze({
  activity_notes_permission_denied: ['אין לחשבון הרשאת עריכה ישירה של פעילויות.', 'הפעולה משתמשת בהרשאות המערכת הקיימות; יש לפנות למנהל לקבלת הרשאה מתאימה.'],
  activity_notes_not_found: ['פעילות הקורס לא נמצאה בשנת הפעילות הנוכחית.', 'בדוק את מזהה הפעילות באמצעות read_snapshot.'],
  activity_notes_invalid: ['פרטי ההערה אינם תקינים.', 'קרא read_activity_notes והשתמש בגרסה ובמזהה בקשה תקינים.'],
  activity_notes_version_conflict: ['הערות הפעילות השתנו מאז הקריאה.', 'קרא read_activity_notes מחדש ובדוק את ההערות העדכניות לפני הוספה.'],
  activity_notes_request_conflict: ['מזהה הבקשה כבר שימש להערה אחרת.', 'קרא את ההערות; אל תשנה את תוכן הבקשה בעת ניסיון חוזר.'],
  activity_notes_capacity: ['שדה ההערות הגיע למגבלת האורך.', 'אין למחוק הערות קיימות אוטומטית; נדרשת בדיקה במערכת.'],
  activity_notes_verification_failed: ['הערת הפעילות לא נשמרה כמצופה והפעולה בוטלה.', 'בדוק את הערות הפעילות ואת לוגי המערכת לפני ניסיון נוסף.'],
  planning_intent_invalid: ['פרטי התכנון אינם תקינים.', 'קרא את התכנון השמור ובדוק את המזהים והגרסה.'],
  planning_intent_version_conflict: ['התכנון השתנה מאז הקריאה האחרונה.', 'קרא read_planning_intents מחדש ובדוק את השינוי לפני שמירה נוספת.'],
  planning_intent_protected: ['לקורס שמור מדריך מיועד מוגן.', 'הצג את הבחירה השמורה. החלפה או שחרור מחייבים הוראה מפורשת של המשתמש.'],
  scheduling_activity_dates_missing: ['תאריכי המפגשים חסרים בפעילות.', 'הכן תאריכים מדויקים לכל המפגשים, בקש אישור ולאחריו השתמש ב-stage_schedule_batch.'],
  scheduling_activity_hours_missing: ['שעות המפגש חסרות או אינן תקינות.', 'בדוק שעות התחלה וסיום והצג אותן לאישור לפני שמירה.'],
  scheduling_proposed_dates_invalid: ['רשימת התאריכים שגויה או אינה מסודרת.', 'בדוק שכל תאריך תקין, בסדר עולה וללא כפילויות; אל תתקן שנת לימודים בלי לשאול.'],
  scheduling_proposed_meeting_count_mismatch: ['מספר המפגשים אינו תואם לפעילות.', 'השווה את מספר השורות בקובץ למספר המפגשים במערכת.'],
  scheduling_agent_schedule_missing: ['חסרים תאריכים או שעות לוח המפגשים.', 'הכן לוח מפגשים מלא וקבל אישור.'],
  scheduling_agent_schedule_count_mismatch: ['מספר התאריכים שונה ממספר המפגשים שהוגדר בקורס.', 'ודא שהקובץ והקורס מתייחסים לאותה קבוצה.'],
  scheduling_agent_schedule_only_new: ['ניתן לקלוט לוח מפגשים בדרך זו רק לפעילות ללא תאריכים ושיבוצים קיימים.', 'עצור ובקש מסלול שינוי מועדים נפרד ומאושר; אין לדרוס לוח קיים.'],
  scheduling_agent_schedule_duplicate: ['אותה פעילות הופיעה פעמיים בבקשה.', 'הסר כפילויות לפני אישור.'],
  scheduling_agent_schedule_invalid_date: ['קיים תאריך שגוי או מחוץ לשנת הפעילות.', 'הצג את התאריך החריג והצע תיקון מפורש לאישור.'],
  scheduling_agent_schedule_invalid_time: ['שעות פעילות אינן בפורמט תקין.', 'בקש שעות התחלה וסיום מדויקות לכל קבוצה.'],
  scheduling_agent_schedule_stale: ['נתוני הפעילות או טיוטת השיבוץ השתנו.', 'קרא מחדש את מצב הפעילות וודא אישור מחודש לשינויים.'],
  scheduling_agent_team_draft_ownership_required: ['ניתן לאשר רק טיוטת שיבוץ שנוצרה מחשבון העובד המחובר.', 'בדוק שהטיוטה נוצרה מחשבון עדן או איסראא המבצע את הפעולה.'],
  scheduling_permission_denied: ['לחשבון המחובר אין הרשאה לבצע שיבוץ זה.', 'פנה למנהל ההרשאות ואל תנסה לעקוף את המגבלה.'],
  scheduling_school_sector_missing: ['מגזר בית הספר לא הוגדר בצורה שמאפשרת אימות מועדים.', 'בקש תיקון של פרטי המוסד על ידי גורם מורשה.'],
  scheduling_school_calendar_blocked: ['התאריך חסום בלוח השנה הרלוונטי.', 'הצע תאריך חלופי ובקש אישור.'],
  scheduling_agent_team_course_only: ['הפעילות אינה קורס תשפ״ז פתוח המתאים לכלי.', 'בדוק מזהה פעילות, שנת פעילות וסטטוס.'],
  scheduling_agent_invalid_selection: ['פרטי הפעילות או המדריך אינם תקינים.', 'זהה את הרשומה המדויקת במערכת ונסה שוב רק לאחר אימות.'],
  scheduling_agent_team_draft_changed: ['פרטי טיוטת השיבוץ השתנו מאז האישור.', 'קרא מחדש את הטיוטה ובקש אישור לפרטים העדכניים.'],
  scheduling_agent_batch_item_failed: ['אחת הפעילויות בקבוצת השיבוצים נדחתה; הבקשה כולה בוטלה.', 'הצג איזו פעילות נכשלה, מה הסיבה ואיזה תיקון נדרש; אל תנסה לשמור חלקית.'],
  scheduling_transition_distance_forbidden: ['מרחק המעבר עולה על הסף המותר ואינו ניתן לאישור חריג.', 'בחר מדריך או לוח מפגשים חלופי; אין לעקוף חסימה זו.'],
  scheduling_transition_insufficient: ['אין מספיק זמן לנסיעה ולמרווח המעבר בין המפגשים.', 'הצע שעות חלופיות לאחר אימות זמן הנסיעה.'],
  scheduling_transition_unverified: ['מסלול המעבר בין המפגשים אינו מאומת.', 'אמת את המסלול לפני שמירה.'],
  scheduling_instructor_unavailable: ['המדריך אינו זמין בשעות המבוקשות.', 'בחר חלון זמין או מדריך חלופי.'],
  edit_request_already_reviewed: ['בקשת האישור כבר טופלה.', 'קרא מחדש את מצב האישור ואל תגיש את אותה החלטה שוב.'],
  edit_request_not_found: ['בקשת האישור לא נמצאה.', 'קרא מחדש את מצב האישור וזיהוי הבקשה.'],
  scheduling_home_route_unverified: ['מסלול הנסיעה לבית הספר אינו מאומת.', 'בדוק מיקום ומסלול שמור לפני אישור חריגה.'],
  scheduling_home_distance_exceeded: ['המרחק לבית הספר חורג מהמגבלה הרגילה.', 'בדוק האם נדרש אישור מנהל לפי מרחק המסלול המאומת.'],
  scheduling_transition_distance_exceeded: ['המרחק בין פעילויות עוקבות חורג מהמותר.', 'בדוק מעבר בין בתי ספר ואת מסלול אישור החריגה.'],
  scheduling_availability_missing: ['אין למדריך חלון זמינות מאושר במועד הזה.', 'בדוק את זמינות המדריך ביום ובשעות שנבחרו.'],
  scheduling_language_mismatch: ['שפת ההדרכה אינה תואמת לשפה המבוקשת בפעילות.', 'בדוק את שפת הפעילות ואת שפות ההדרכה המאושרות למדריך.'],
  scheduling_gender_mismatch: ['הפעילות דורשת מדריך או מדריכה בהתאם לתנאי שלא מתקיים.', 'הצע מדריך מתאים או העבר לשינוי דרישה מוסמך.'],
  scheduling_course_blocked: ['למדריך קיימת חסימה לתוכנית הזאת.', 'בחר מדריך שאינו חסום לתוכנית; אין לעקוף את החסימה.'],
  scheduling_authority_blocked: ['המדריך חסום לעבודה ברשות זו.', 'בחר מדריך חלופי; אין לעקוף את חסימת הרשות.'],
  scheduling_instructor_profile_incomplete: ['פרופיל המדריך אינו שלם.', 'השלם פרטי כשירות, שפה או כתובת באמצעות הגורם המורשה.'],
  scheduling_conflict_detected: ['קיימת התנגשות בין מפגשים.', 'זהה את היום והשעות החופפים והצע חלופה לאישור.'],
  scheduling_overlap: ['יש חפיפה בין מפגשי הדרכה.', 'בדוק שיבוצים קיימים והצע שעות חלופיות.'],
  scheduling_school_calendar_blocked: ['התאריך חסום בלוח השנה של בית הספר.', 'הצע מועד חלופי ובקש אישור.'],
  scheduling_saturday_blocked: ['לא ניתן לשבץ פעילות ביום שבת עבור בית הספר הזה.', 'בדוק את מגזר בית הספר והצע מועד מתאים.'],
  scheduling_friday_not_allowed: ['המדריך אינו זמין לפעילות ביום שישי.', 'בחר יום שבו המדריך זמין.'],
  scheduling_manager_approval_required: ['השיבוץ דורש אישור מנהל לפני קיבוע.', 'בדוק manager_approval_state והצג חריגה מובנית וערכים מאומתים; נימוק חופשי אינו חריגה. הגש בקשת מנהל רק אם approval_required=true ולאחר הסכמה מפורשת.'],
  scheduling_assignment_locked: ['הפעילות כבר משובצת או נעולה.', 'אל תדרוס שיבוץ קיים; בקש אישור למסלול החלפה מתאים.'],
  scheduling_activity_not_open: ['הפעילות אינה פתוחה לשיבוץ.', 'בדוק את סטטוס הפעילות לפני פעולה נוספת.'],
  instructor_not_found: ['המדריך לא נמצא במאגר.', 'בדוק את מזהה המדריך במערכת.'],
  instructor_inactive: ['המדריך אינו פעיל.', 'בחר מדריך פעיל או פנה לגורם המורשה.'],
  permission_denied: ['לחשבון המחובר אין הרשאה לביצוע הפעולה.', 'יש לפנות למנהל המערכת; אין לעקוף הרשאות.']
});

export function schedulingError(body, httpStatus) {
  const rawMessage = typeof body?.message === 'string' ? body.message : '';
  // Recognize only explicit, approved business codes. Never return arbitrary SQL text.
  const explicit = Object.hasOwn(REASONS, rawMessage) ? rawMessage : '';
  let activityId = null, innerCode = '';
  if (rawMessage === 'scheduling_agent_batch_item_failed') {
    const parts = typeof body?.details === 'string' ? body.details.split('|') : [];
    if (parts.length === 2 && /^[a-zA-Z0-9_-]{1,200}$/.test(parts[0])) {
      activityId = parts[0];
      innerCode = Object.hasOwn(REASONS, parts[1]) ? parts[1] : '';
    }
  }
  let code = explicit || (body?.code === '42501' || httpStatus === 401 || httpStatus === 403 ? 'permission_denied' : 'request_rejected');
  const effectiveCode = innerCode || code;
  const [message, nextStep] = httpStatus >= 500 ? [
    'תוצאת הפעולה אינה ידועה עקב תקלה בשירות.',
    'קרא מחדש את מצב הפעילות או הבקשה לפני ניסיון נוסף; אין להסיק שהפעולה בוטלה.'
  ] : REASONS[effectiveCode] || [
    'הפעולה נדחתה על ידי המערכת; לא ניתן לקבוע מהסוכן את הסיבה המדויקת.',
    'עצור, בדוק את מזהי הפעילות וההרשאות ופנה לבדיקת תקלה עם מזהה הבקשה; אל תנסה לעקוף את האימות.'
  ];
  return {
    error: code,
    reasonCode: innerCode || (code === 'request_rejected' ? null : code),
    diagnosticCode: typeof body?.code === 'string' && /^[A-Z0-9_]{1,20}$/.test(body.code) ? body.code : null,
    message,
    nextStep,
    ...(activityId ? { activityId } : {}),
    retrySameRequest: false,
    writesCommitted: httpStatus >= 500 ? null : false
  };
}

export function describeSchedulingSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.rows)) return snapshot;
  return {
    ...snapshot,
    rows: snapshot.rows.map(row => {
      const missing = [];
      if (!row.startDate && !row.endDate) missing.push('meeting_dates');
      if (!row.startTime || !row.endTime) missing.push('meeting_hours');
      return {
        ...row,
        readiness: {
          complete: missing.length === 0,
          missing,
          ...(missing.length ? { nextStep: row.draftInstructorId ? 'קיימת טיוטת שיבוץ. בדוק manager_approval_state ואת המועדים השמורים בטיוטה; אין ליצור אותה מחדש בגלל היעדר מועדים רשמיים. לאחר בדיקות ואישור סופי השתמש ב-confirm_schedule_batch.' : 'לשמירת מדריך מיועד ללא מועדים השתמש ב-save_intended_instructor; זו אינה טיוטה מאומתת או שיבוץ סופי. לטיוטת לוח מפגשים קבל אישור לתאריכים ולשעות והשתמש ב-stage_schedule_batch.' } : {})
        }
      };
    })
  };
}
