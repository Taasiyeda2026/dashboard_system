import { registerAnnualReviewExtension, loadAnnualReviewRow, insertVersionedQuestionGroup } from './annual-reviews-safe-runtime.js';

const QUESTIONS = {
  employee: [
    { key: 'readiness', title: 'היערכות לפתיחת שנת הלימודים', prompt: 'מה נדרש להשלים או לקדם כדי להתחיל את שנת הלימודים הבאה באופן מסודר ומוכן?' },
    { key: 'priorities', title: 'דגשים לתחילת שנת הלימודים', prompt: 'אילו אתגרים, צרכים או סדרי עדיפויות חשוב להביא בחשבון בתחילת שנת הלימודים הבאה?' }
  ],
  manager: [
    { key: 'readiness', title: 'היערכות לפתיחת שנת הלימודים', prompt: 'מה נדרש מהעובד להשלים או לקדם לקראת פתיחת שנת הלימודים הבאה?' },
    { key: 'priorities', title: 'דגשים לתחילת שנת הלימודים', prompt: 'אילו סדרי עדיפויות, ציפיות או נושאים דורשים תשומת לב בתחילת שנת הלימודים הבאה?' }
  ]
};

const TABLES = {
  employee: 'employee_review_next_school_year',
  manager: 'manager_review_next_school_year'
};

registerAnnualReviewExtension(async (root, context) => {
  const { review, isEmployee, isManager } = context;
  const revealed = Boolean(review.answers_revealed_at);

  const employeeForm = root.querySelector('#ar2-employee-section form[data-ar2-form="employee"]');
  if (employeeForm && (isEmployee || revealed) && !employeeForm.querySelector('[data-safe-group="next-year-employee"]')) {
    const row = await loadAnnualReviewRow(TABLES.employee, review.id);
    insertVersionedQuestionGroup(employeeForm, {
      id: 'next-year-employee',
      title: 'היערכות לשנת הלימודים הבאה',
      questions: QUESTIONS.employee,
      row,
      editable: isEmployee && review.status === 'employee_preparation' && !review.employee_section_submitted_at && !review.locked_at,
      owner: 'employee',
      table: TABLES.employee,
      mode: 'plain',
      reviewId: review.id
    });
  }

  const managerForm = root.querySelector('#ar2-manager-section form[data-ar2-form="manager"]');
  if (managerForm && (isManager || revealed) && !managerForm.querySelector('[data-safe-group="next-year-manager"]')) {
    const row = await loadAnnualReviewRow(TABLES.manager, review.id);
    insertVersionedQuestionGroup(managerForm, {
      id: 'next-year-manager',
      title: 'היערכות לשנת הלימודים הבאה',
      questions: QUESTIONS.manager,
      row,
      editable: isManager && review.status === 'employee_preparation' && !review.manager_section_submitted_at && !review.locked_at,
      owner: 'manager',
      table: TABLES.manager,
      mode: 'plain',
      reviewId: review.id
    });
  }
});
