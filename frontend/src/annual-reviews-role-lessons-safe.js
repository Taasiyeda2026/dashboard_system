import { registerAnnualReviewExtension, loadAnnualReviewRow, insertVersionedQuestionGroup } from './annual-reviews-safe-runtime.js';

const MANAGER_QUESTIONS = {
  'גיל נאמן': [
    { key: 'activity_management_lessons', title: 'ניהול הפעילויות', prompt: 'אילו לקחים מרכזיים עולים מניהול הפעילויות השנה, ומה נכון לשנות בתכנון ובהוצאה לפועל בשנת הלימודים הבאה?' },
    { key: 'instructor_management_lessons', title: 'גיוס, שיבוץ וניהול מדריכים', prompt: 'אילו שינויים נדרשים בגיוס, בשיבוץ ובניהול המדריכים כדי לשפר את היציבות ואת איכות הביצוע?' },
    { key: 'coordination_control_reporting_lessons', title: 'תיאום, בקרה ודיווח', prompt: 'אילו תהליכי תיאום, בקרה ודיווח יש לשפר כדי לצמצם תקלות וחריגות בשנת הלימודים הבאה?' },
    { key: 'resources_and_decisions', title: 'משאבים והחלטות ניהוליות', prompt: 'אילו משאבים, כלים או החלטות ניהוליות נדרשים כדי לאפשר פתיחה מסודרת ורציפות תפעולית?' }
  ],
  'עדן כהן': [
    { key: 'coordination_lessons', title: 'תיאום הפעילויות', prompt: 'אילו לקחים עולים מתהליכי התיאום מול בתי הספר, המדריכים והצוות, ומה נכון לשנות בשנת הלימודים הבאה?' },
    { key: 'information_management_lessons', title: 'ניהול מידע ומעקב', prompt: 'אילו שיפורים נדרשים בניהול המידע, הטבלאות והסטטוסים כדי להבטיח תמונה עדכנית ואמינה?' },
    { key: 'task_closure_lessons', title: 'סגירת משימות ותהליכים', prompt: 'אילו משימות או תהליכים לא נסגרו באופן מיטבי, וכיצד ניתן לשפר את המעקב עד להשלמתם?' },
    { key: 'tools_procedures_responsibility', title: 'כלים, נהלים וחלוקת אחריות', prompt: 'אילו כלים, נהלים או שינויים בחלוקת האחריות יסייעו לשפר את העבודה האדמיניסטרטיבית והתפעולית?' }
  ],
  'טוני נעים': [
    { key: 'finance_payroll_reporting_lessons', title: 'הנהלת חשבונות, שכר ודיווחים', prompt: 'אילו לקחים עולים מתהליכי הנהלת החשבונות, השכר והדיווחים, ומה נכון לשפר בשנת הלימודים הבאה?' },
    { key: 'early_control_lessons', title: 'בקרה מוקדמת', prompt: 'באילו תהליכים נדרשת בקרה מוקדמת יותר כדי לצמצם טעויות, עיכובים או השלמות בדיעבד?' },
    { key: 'information_transfer_lessons', title: 'העברת מידע ותיאום', prompt: 'אילו שיפורים נדרשים בהעברת המידע ובתיאום מול ההנהלה והצוות לצורך עבודה כספית מדויקת ורציפה?' },
    { key: 'budget_control_lessons', title: 'בקרה תקציבית ודיווח כספי', prompt: 'אילו כלים, לוחות זמנים או נהלי עבודה יסייעו לשפר את הבקרה התקציבית ואת הדיווח הכספי?' }
  ],
  'הילה רוזן': [
    { key: 'instruction_quality_lessons', title: 'איכות ההדרכה', prompt: 'אילו לקחים מרכזיים עולים מאיכות ההדרכה בשטח, ומה נכון לשנות במערך ההדרכה בשנת הלימודים הבאה?' },
    { key: 'instructor_training_lessons', title: 'הכשרה וליווי מדריכים', prompt: 'אילו שיפורים נדרשים בתהליכי ההכשרה והליווי של המדריכים?' },
    { key: 'professional_consistency_lessons', title: 'אחידות מקצועית ופדגוגית', prompt: 'באילו תחומים נדרש לחזק את האחידות המקצועית והפדגוגית בין התוכניות, המדריכים והאזורים?' },
    { key: 'content_and_control_development', title: 'פיתוח תכנים וכלי בקרה', prompt: 'אילו תכנים, כלים או תהליכי בקרה יש לפתח או לעדכן לקראת שנת הלימודים הבאה?' }
  ]
};

const EMPLOYEE_QUESTIONS = {
  'עדן כהן': [
    { key: 'activity_managers_current_interface', title: 'ממשק העבודה מול מנהלי הפעילויות', prompt: 'כיצד מתנהל ממשק העבודה מול מנהלי הפעילויות מבחינת תיאום, העברת מידע, בהירות המשימות וחלוקת האחריות? מה חשוב לשמר ומה נדרש לשפר?' },
    { key: 'activity_managers_next_year_interface', title: 'שיפור הממשק לשנת הלימודים הבאה', prompt: 'אילו שינויים בממשק העבודה מול מנהלי הפעילויות יסייעו לקדם משימות, לקבל מידע ולסגור תהליכים באופן יעיל ומדויק יותר בשנת הלימודים הבאה?' }
  ],
  'הילה רוזן': [
    { key: 'activity_managers_current_interface', title: 'ממשק העבודה מול מנהלי הפעילויות', prompt: 'כיצד מתנהל ממשק העבודה מול מנהלי הפעילויות מבחינת העברת צורכי השטח, טיפול בקשיים, משוב מקצועי ומעקב אחר איכות הפעילות? מה חשוב לשמר ומה נדרש לשפר?' },
    { key: 'activity_managers_next_year_interface', title: 'שיפור הממשק מול מנהלי הפעילויות', prompt: 'אילו שינויים בממשק העבודה מול מנהלי הפעילויות יסייעו לזהות צרכים מקצועיים מוקדם יותר ולשפר את המענה למדריכים ולפעילויות בשנת הלימודים הבאה?' },
    { key: 'coordination_admin_current_interface', title: 'ממשק העבודה מול תחום תיאום הפעילויות והאדמיניסטרציה', prompt: 'כיצד מתנהל ממשק העבודה מול תחום תיאום הפעילויות והאדמיניסטרציה מבחינת תיאום ושיבוץ מדריכים, העברת מידע, ציוד, מסמכים ומעקב אחר צורכי ההדרכה? מה חשוב לשמר ומה נדרש לשפר?' },
    { key: 'coordination_admin_next_year_interface', title: 'שיפור תהליכי התיאום והשיבוץ', prompt: 'אילו שינויים בתהליכי התיאום והשיבוץ יסייעו לאפשר הכשרה, היערכות וליווי מקצועי מסודרים יותר בשנת הלימודים הבאה?' }
  ],
  'טוני נעים': [
    { key: 'coordination_admin_current_interface', title: 'ממשק העבודה מול תחום תיאום הפעילויות והאדמיניסטרציה', prompt: 'כיצד מתנהל ממשק העבודה מול תחום תיאום הפעילויות והאדמיניסטרציה בכל הקשור להעברת מסמכים, אישורי ביצוע, נתוני נוכחות ומידע הנדרש להנהלת החשבונות ולשכר?' },
    { key: 'coordination_admin_next_year_interface', title: 'שיפור העברת המידע והמסמכים', prompt: 'אילו שינויים בתהליך העברת המידע והמסמכים יסייעו לשפר את הדיוק, העמידה במועדים והרציפות בעבודה בשנת הלימודים הבאה?' },
    { key: 'activity_managers_current_interface', title: 'ממשק העבודה מול מנהלי הפעילויות', prompt: 'כיצד מתנהל ממשק העבודה מול מנהלי הפעילויות בכל הקשור לתקציבים, אישורים, דיווחים והעברת מידע כספי?' },
    { key: 'activity_managers_next_year_interface', title: 'שיפור הממשק מול מנהלי הפעילויות', prompt: 'אילו שינויים בממשק העבודה מול מנהלי הפעילויות יסייעו לצמצם עיכובים, חוסרים ותיקונים בדיעבד בשנת הלימודים הבאה?' }
  ]
};

const TABLES = {
  employee: 'employee_review_interface_feedback',
  manager: 'manager_review_role_lessons'
};

registerAnnualReviewExtension(async (root, context) => {
  const { review, isEmployee, isManager, employeeName } = context;
  const revealed = Boolean(review.answers_revealed_at);

  const employeeQuestions = EMPLOYEE_QUESTIONS[employeeName] || [];
  const employeeForm = root.querySelector('#ar2-employee-section form[data-ar2-form="employee"]');
  if (employeeQuestions.length && employeeForm && (isEmployee || revealed) && !employeeForm.querySelector('[data-safe-group="interface-employee"]')) {
    const row = await loadAnnualReviewRow(TABLES.employee, review.id);
    insertVersionedQuestionGroup(employeeForm, {
      id: 'interface-employee',
      title: 'ממשקי עבודה',
      questions: employeeQuestions,
      row,
      editable: isEmployee && review.status === 'employee_preparation' && !review.employee_section_submitted_at && !review.locked_at,
      owner: 'employee',
      table: TABLES.employee,
      mode: 'json',
      reviewId: review.id
    });
  }

  const managerQuestions = MANAGER_QUESTIONS[employeeName] || [];
  const managerForm = root.querySelector('#ar2-manager-section form[data-ar2-form="manager"]');
  if (managerQuestions.length && managerForm && (isManager || revealed) && !managerForm.querySelector('[data-safe-group="lessons-manager"]')) {
    const row = await loadAnnualReviewRow(TABLES.manager, review.id);
    insertVersionedQuestionGroup(managerForm, {
      id: 'lessons-manager',
      title: 'הפקת לקחים לפי תחום האחריות',
      questions: managerQuestions,
      row,
      editable: isManager && review.status === 'employee_preparation' && !review.manager_section_submitted_at && !review.locked_at,
      owner: 'manager',
      table: TABLES.manager,
      mode: 'json',
      reviewId: review.id
    });
  }
});
