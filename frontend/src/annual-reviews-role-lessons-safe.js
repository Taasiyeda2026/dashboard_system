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

const COMMON_EMPLOYEE_QUESTIONS = [
  { key: 'period_overview', title: 'מבט כללי על התקופה', prompt: 'כיצד את/ה מסכם/ת את התקופה הנבחנת מנקודת מבטך?' },
  { key: 'direct_manager_interface', title: 'ממשק העבודה עם המנהל הישיר', prompt: 'כיצד מתנהל ממשק העבודה שלך עם המנהל הישיר מבחינת תקשורת, תיאום ציפיות, קבלת החלטות, משוב והעברת מידע? מה חשוב לשמר ומה נדרש לשפר?' },
  { key: 'managerial_support', title: 'ליווי ותמיכה ניהולית', prompt: 'אילו הבהרות, כלים, החלטות, משאבים או ליווי ניהולי יסייעו לך לבצע את תפקידך בצורה מיטבית?' },
  { key: 'marketing_pedagogy_interface', title: 'ממשק העבודה מול מנהלת השיווק והפדגוגיה', prompt: 'כיצד מתנהל ממשק העבודה מול יעל אביב, מנהלת השיווק והפדגוגיה, מבחינת תיאום, העברת מידע, חלוקת אחריות ולוחות זמנים? מה חשוב לשמר ומה נדרש לשפר?' },
  { key: 'marketing_pedagogy_improvement', title: 'שיפור העבודה המשותפת עם השיווק והפדגוגיה', prompt: 'אילו שינויים בתהליכי העבודה המשותפים עם תחומי השיווק והפדגוגיה יסייעו לקדם משימות ותוצרים באופן יעיל, ברור ומתואם יותר?' }
];

const ROLE_EMPLOYEE_QUESTIONS = {
  'גיל נאמן': [
    { key: 'operations_current_interface', title: 'ממשק העבודה מול תפעול הפעילויות, התיאום והשיבוץ', prompt: 'כיצד מתנהל ממשק העבודה מול תחום תפעול הפעילויות בכל הקשור לתכנון הפעילויות, העברת מידע, תיאום, שיבוץ מדריכים, שינויים וטיפול בחריגים? מה חשוב לשמר ומה נדרש לשפר?' },
    { key: 'operations_improvement_interface', title: 'שיפור הממשק בין ניהול הפעילויות לתפעול', prompt: 'אילו שינויים בתהליכי העבודה המשותפים בין ניהול הפעילויות לתפעול הפעילויות יסייעו לשפר את התיאום, זמינות המידע, השיבוץ והמעקב אחר ביצוע הפעילויות?' }
  ],
  'עדן כהן': [
    { key: 'activity_management_current_interface', title: 'ממשק העבודה מול תחום ניהול הפעילויות', prompt: 'כיצד מתנהל ממשק העבודה בין תפעול הפעילויות לתחום ניהול הפעילויות מבחינת תיאום, העברת מידע, בהירות המשימות, שיבוץ וחלוקת האחריות? מה חשוב לשמר ומה נדרש לשפר?' },
    { key: 'activity_management_improvement_interface', title: 'שיפור הממשק בין התפעול לניהול הפעילויות', prompt: 'אילו שינויים בתהליכי העבודה המשותפים בין תפעול הפעילויות לניהול הפעילויות יסייעו לקדם משימות, לקבל מידע ולסגור תהליכים באופן יעיל ומדויק יותר?' }
  ],
  'הילה רוזן': [
    { key: 'activity_management_current_interface', title: 'ממשק העבודה מול ניהול הפעילויות', prompt: 'כיצד מתנהל הממשק בין תחום ההדרכה לניהול הפעילויות מבחינת העברת צורכי השטח, טיפול בקשיים, משוב מקצועי ומעקב אחר איכות הפעילות? מה חשוב לשמר ומה נדרש לשפר?' },
    { key: 'activity_management_improvement_interface', title: 'שיפור הממשק מול ניהול הפעילויות', prompt: 'אילו שינויים בממשק העבודה בין תחום ההדרכה לניהול הפעילויות יסייעו לזהות צרכים מקצועיים מוקדם יותר ולשפר את המענה למדריכים ולפעילויות?' },
    { key: 'operations_current_interface', title: 'ממשק העבודה מול תפעול הפעילויות, התיאום והשיבוץ', prompt: 'כיצד מתנהל הממשק בין תחום ההדרכה לתפעול הפעילויות בכל הקשור לתיאום ושיבוץ מדריכים, העברת מידע, ציוד, מסמכים ומעקב אחר צורכי ההדרכה? מה חשוב לשמר ומה נדרש לשפר?' },
    { key: 'operations_improvement_interface', title: 'שיפור הממשק מול תפעול הפעילויות', prompt: 'אילו שינויים בתהליכי העבודה המשותפים בין תחום ההדרכה לתפעול הפעילויות יסייעו לאפשר הכשרה, היערכות וליווי מקצועי מסודרים יותר?' }
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

  const employeeQuestions = [
    ...COMMON_EMPLOYEE_QUESTIONS,
    ...(ROLE_EMPLOYEE_QUESTIONS[employeeName] || [])
  ];
  const employeeForm = root.querySelector('#ar2-employee-section form[data-ar2-form="employee"]');
  if (employeeForm && (isEmployee || revealed) && !employeeForm.querySelector('[data-safe-group="interface-employee"]')) {
    const row = await loadAnnualReviewRow(TABLES.employee, review.id);
    const employeeGroup = insertVersionedQuestionGroup(employeeForm, {
      id: 'interface-employee',
      title: 'פתיחה וממשקי עבודה',
      questions: employeeQuestions,
      row,
      editable: isEmployee && review.status === 'employee_preparation' && !review.employee_section_submitted_at && !review.locked_at,
      owner: 'employee',
      table: TABLES.employee,
      mode: 'json',
      reviewId: review.id
    });
    if (employeeGroup) employeeForm.querySelector('.ar2-question-list')?.prepend(employeeGroup);
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
