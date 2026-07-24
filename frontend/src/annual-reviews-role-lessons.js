import { supabase } from './supabase-client.js';
import { escapeHtml } from './screens/shared/html.js';

const MANAGER_QUESTIONS_BY_EMPLOYEE = {
  'גיל נאמן': [
    {
      key: 'activity_management_lessons',
      title: 'ניהול הפעילויות',
      prompt: 'אילו לקחים מרכזיים עולים מניהול הפעילויות השנה, ומה נכון לשנות בתכנון ובהוצאה לפועל בשנת הלימודים הבאה?'
    },
    {
      key: 'instructor_management_lessons',
      title: 'גיוס, שיבוץ וניהול מדריכים',
      prompt: 'אילו שינויים נדרשים בגיוס, בשיבוץ ובניהול המדריכים כדי לשפר את היציבות ואת איכות הביצוע?'
    },
    {
      key: 'coordination_control_reporting_lessons',
      title: 'תיאום, בקרה ודיווח',
      prompt: 'אילו תהליכי תיאום, בקרה ודיווח יש לשפר כדי לצמצם תקלות וחריגות בשנת הלימודים הבאה?'
    },
    {
      key: 'resources_and_decisions',
      title: 'משאבים והחלטות ניהוליות',
      prompt: 'אילו משאבים, כלים או החלטות ניהוליות נדרשים כדי לאפשר פתיחה מסודרת ורציפות תפעולית?'
    }
  ],
  'עדן כהן': [
    {
      key: 'coordination_lessons',
      title: 'תיאום הפעילויות',
      prompt: 'אילו לקחים עולים מתהליכי התיאום מול בתי הספר, המדריכים והצוות, ומה נכון לשנות בשנת הלימודים הבאה?'
    },
    {
      key: 'information_management_lessons',
      title: 'ניהול מידע ומעקב',
      prompt: 'אילו שיפורים נדרשים בניהול המידע, הטבלאות והסטטוסים כדי להבטיח תמונה עדכנית ואמינה?'
    },
    {
      key: 'task_closure_lessons',
      title: 'סגירת משימות ותהליכים',
      prompt: 'אילו משימות או תהליכים לא נסגרו באופן מיטבי, וכיצד ניתן לשפר את המעקב עד להשלמתם?'
    },
    {
      key: 'tools_procedures_responsibility',
      title: 'כלים, נהלים וחלוקת אחריות',
      prompt: 'אילו כלים, נהלים או שינויים בחלוקת האחריות יסייעו לשפר את העבודה האדמיניסטרטיבית והתפעולית?'
    }
  ],
  'טוני נעים': [
    {
      key: 'finance_payroll_reporting_lessons',
      title: 'הנהלת חשבונות, שכר ודיווחים',
      prompt: 'אילו לקחים עולים מתהליכי הנהלת החשבונות, השכר והדיווחים, ומה נכון לשפר בשנת הלימודים הבאה?'
    },
    {
      key: 'early_control_lessons',
      title: 'בקרה מוקדמת',
      prompt: 'באילו תהליכים נדרשת בקרה מוקדמת יותר כדי לצמצם טעויות, עיכובים או השלמות בדיעבד?'
    },
    {
      key: 'information_transfer_lessons',
      title: 'העברת מידע ותיאום',
      prompt: 'אילו שיפורים נדרשים בהעברת המידע ובתיאום מול ההנהלה והצוות לצורך עבודה כספית מדויקת ורציפה?'
    },
    {
      key: 'budget_control_lessons',
      title: 'בקרה תקציבית ודיווח כספי',
      prompt: 'אילו כלים, לוחות זמנים או נהלי עבודה יסייעו לשפר את הבקרה התקציבית ואת הדיווח הכספי?'
    }
  ],
  'הילה רוזן': [
    {
      key: 'instruction_quality_lessons',
      title: 'איכות ההדרכה',
      prompt: 'אילו לקחים מרכזיים עולים מאיכות ההדרכה בשטח, ומה נכון לשנות במערך ההדרכה בשנת הלימודים הבאה?'
    },
    {
      key: 'instructor_training_lessons',
      title: 'הכשרה וליווי מדריכים',
      prompt: 'אילו שיפורים נדרשים בתהליכי ההכשרה והליווי של המדריכים?'
    },
    {
      key: 'professional_consistency_lessons',
      title: 'אחידות מקצועית ופדגוגית',
      prompt: 'באילו תחומים נדרש לחזק את האחידות המקצועית והפדגוגית בין התוכניות, המדריכים והאזורים?'
    },
    {
      key: 'content_and_control_development',
      title: 'פיתוח תכנים וכלי בקרה',
      prompt: 'אילו תכנים, כלים או תהליכי בקרה יש לפתח או לעדכן לקראת שנת הלימודים הבאה?'
    }
  ]
};

const EMPLOYEE_INTERFACE_QUESTIONS_BY_EMPLOYEE = {
  'עדן כהן': [
    {
      key: 'activity_managers_current_interface',
      title: 'ממשק העבודה מול מנהלי הפעילויות',
      prompt: 'כיצד מתנהל ממשק העבודה מול מנהלי הפעילויות מבחינת תיאום, העברת מידע, בהירות המשימות וחלוקת האחריות? מה חשוב לשמר ומה נדרש לשפר?'
    },
    {
      key: 'activity_managers_next_year_interface',
      title: 'שיפור הממשק לשנת הלימודים הבאה',
      prompt: 'אילו שינויים בממשק העבודה מול מנהלי הפעילויות יסייעו לקדם משימות, לקבל מידע ולסגור תהליכים באופן יעיל ומדויק יותר בשנת הלימודים הבאה?'
    }
  ],
  'הילה רוזן': [
    {
      key: 'activity_managers_current_interface',
      title: 'ממשק העבודה מול מנהלי הפעילויות',
      prompt: 'כיצד מתנהל ממשק העבודה מול מנהלי הפעילויות מבחינת העברת צורכי השטח, טיפול בקשיים, משוב מקצועי ומעקב אחר איכות הפעילות? מה חשוב לשמר ומה נדרש לשפר?'
    },
    {
      key: 'activity_managers_next_year_interface',
      title: 'שיפור הממשק מול מנהלי הפעילויות',
      prompt: 'אילו שינויים בממשק העבודה מול מנהלי הפעילויות יסייעו לזהות צרכים מקצועיים מוקדם יותר ולשפר את המענה למדריכים ולפעילויות בשנת הלימודים הבאה?'
    },
    {
      key: 'coordination_admin_current_interface',
      title: 'ממשק העבודה מול תחום תיאום הפעילויות והאדמיניסטרציה',
      prompt: 'כיצד מתנהל ממשק העבודה מול תחום תיאום הפעילויות והאדמיניסטרציה מבחינת תיאום ושיבוץ מדריכים, העברת מידע, ציוד, מסמכים ומעקב אחר צורכי ההדרכה? מה חשוב לשמר ומה נדרש לשפר?'
    },
    {
      key: 'coordination_admin_next_year_interface',
      title: 'שיפור תהליכי התיאום והשיבוץ',
      prompt: 'אילו שינויים בתהליכי התיאום והשיבוץ יסייעו לאפשר הכשרה, היערכות וליווי מקצועי מסודרים יותר בשנת הלימודים הבאה?'
    }
  ],
  'טוני נעים': [
    {
      key: 'coordination_admin_current_interface',
      title: 'ממשק העבודה מול תחום תיאום הפעילויות והאדמיניסטרציה',
      prompt: 'כיצד מתנהל ממשק העבודה מול תחום תיאום הפעילויות והאדמיניסטרציה בכל הקשור להעברת מסמכים, אישורי ביצוע, נתוני נוכחות ומידע הנדרש להנהלת החשבונות ולשכר?'
    },
    {
      key: 'coordination_admin_next_year_interface',
      title: 'שיפור העברת המידע והמסמכים',
      prompt: 'אילו שינויים בתהליך העברת המידע והמסמכים יסייעו לשפר את הדיוק, העמידה במועדים והרציפות בעבודה בשנת הלימודים הבאה?'
    },
    {
      key: 'activity_managers_current_interface',
      title: 'ממשק העבודה מול מנהלי הפעילויות',
      prompt: 'כיצד מתנהל ממשק העבודה מול מנהלי הפעילויות בכל הקשור לתקציבים, אישורים, דיווחים והעברת מידע כספי?'
    },
    {
      key: 'activity_managers_next_year_interface',
      title: 'שיפור הממשק מול מנהלי הפעילויות',
      prompt: 'אילו שינויים בממשק העבודה מול מנהלי הפעילויות יסייעו לצמצם עיכובים, חוסרים ותיקונים בדיעבד בשנת הלימודים הבאה?'
    }
  ]
};

const TABLES = {
  employee: 'employee_review_interface_feedback',
  manager: 'manager_review_role_lessons'
};

const SECTION_TITLES = {
  employee: 'ממשקי עבודה',
  manager: 'הפקת לקחים לפי תחום האחריות'
};

const saveTimers = new Map();
const pendingSaves = new Map();
let processing = false;
let scheduled = false;

function installStyles() {
  if (document.getElementById('annual-reviews-role-lessons-styles')) return;
  const style = document.createElement('style');
  style.id = 'annual-reviews-role-lessons-styles';
  style.textContent = `
    #app [data-role-review-group]{display:grid;gap:12px;margin-top:14px;padding-top:14px;border-top:1px solid var(--ds-border,#d9dee7)}
    #app [data-role-review-group] > h3{margin:0;font-size:1rem}
  `;
  document.head.appendChild(style);
}

function employeeNameFromRoot(root) {
  const footerItems = [...root.querySelectorAll('.ar2-signatures span')];
  const item = footerItems.find((node) => /^(?:שם\s*)?העובד\/ת:|^עובד\/ת:/.test(node.textContent.trim()));
  if (item) return item.textContent.replace(/^(?:שם\s*)?העובד\/ת:\s*|^עובד\/ת:\s*/, '').trim();

  const headerText = root.querySelector('main.ar2-body > header.ar2-card .ar2-muted')?.textContent || '';
  return headerText.split('·')[0]?.trim() || '';
}

function yearFromRoot(root) {
  const match = root.textContent.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

async function resolveReview(root) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const userId = sessionData.session?.user?.id;
  if (!userId) return null;

  const employeeName = employeeNameFromRoot(root);
  if (!employeeName) return null;

  const { data: assignment, error: assignmentError } = await supabase
    .from('annual_review_assignments')
    .select('employee_id,manager_id,employee_name')
    .eq('employee_name', employeeName)
    .maybeSingle();
  if (assignmentError) throw assignmentError;
  if (!assignment) return null;

  let query = supabase
    .from('annual_reviews')
    .select('*')
    .eq('employee_id', assignment.employee_id)
    .order('review_year', { ascending: false })
    .limit(1);

  const reviewYear = yearFromRoot(root);
  if (reviewYear) query = query.eq('review_year', reviewYear);

  const { data: reviews, error: reviewError } = await query;
  if (reviewError) throw reviewError;
  const review = reviews?.[0];
  if (!review) return null;

  return {
    review,
    employeeName,
    isEmployee: review.employee_id === userId,
    isManager: review.manager_id === userId
  };
}

async function loadRow(table, reviewId) {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('review_id', reviewId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function questionHtml(question, value, editable, type) {
  return `<div class="ar2-question" data-role-review-question="${escapeHtml(type)}:${escapeHtml(question.key)}">
    <div class="ar2-question__title">${escapeHtml(question.title)}</div>
    <p class="ar2-question__prompt">${escapeHtml(question.prompt)}</p>
    <textarea class="ar2-textarea" rows="4" data-role-review-field="${escapeHtml(question.key)}" ${editable ? '' : 'readonly'}>${escapeHtml(value || '')}</textarea>
  </div>`;
}

function insertGroup(form, questions, row, editable, type, reviewId) {
  const list = form.querySelector('.ar2-question-list');
  if (!list || list.querySelector(`[data-role-review-group="${type}"]`)) return null;

  const wrapper = document.createElement('div');
  wrapper.dataset.roleReviewGroup = type;
  wrapper.dataset.reviewId = reviewId;
  wrapper.dataset.version = String(row?.version || '');
  wrapper.innerHTML = `<h3>${escapeHtml(SECTION_TITLES[type])}</h3>
    ${questions.map((question) => questionHtml(question, row?.answers?.[question.key], editable, type)).join('')}
    <div class="ar2-save" data-role-review-save aria-live="polite"></div>`;

  const goalsQuestion = list.querySelector('[data-question-key="goals"]');
  list.insertBefore(wrapper, goalsQuestion || null);
  return wrapper;
}

function hideLegacyRoleMetrics(root) {
  const managerSection = root.querySelector('#ar2-manager-section');
  if (!managerSection) return;

  const metrics = managerSection.querySelector('.ar2-metrics');
  if (metrics?.parentElement) {
    metrics.parentElement.hidden = true;
    metrics.parentElement.dataset.roleMetricsReplaced = 'true';
    return;
  }

  const heading = [...managerSection.querySelectorAll('h3')]
    .find((node) => node.textContent.trim().includes('מדדים מקצועיים'));
  if (heading?.parentElement) {
    heading.parentElement.hidden = true;
    heading.parentElement.dataset.roleMetricsReplaced = 'true';
  }
}

function setSaveState(group, message, kind = '') {
  const node = group?.querySelector('[data-role-review-save]');
  if (!node) return;
  node.textContent = message;
  node.dataset.state = kind;
}

function valuesFromGroup(group) {
  return Object.fromEntries(
    [...group.querySelectorAll('[data-role-review-field]')]
      .map((field) => [field.dataset.roleReviewField, field.value || ''])
  );
}

async function saveGroup(group) {
  if (!group || !group.querySelector('[data-role-review-field]:not([readonly])')) return;
  const type = group.dataset.roleReviewGroup;
  const table = TABLES[type];
  const reviewId = group.dataset.reviewId;
  if (!table || !reviewId) return;

  const timerKey = `${reviewId}:${type}`;
  const timer = saveTimers.get(timerKey);
  if (timer) clearTimeout(timer);
  saveTimers.delete(timerKey);

  const values = { answers: valuesFromGroup(group) };
  const version = Number(group.dataset.version || 0);
  setSaveState(group, 'שומר…', 'saving');

  const request = version
    ? supabase.from(table).update(values).eq('review_id', reviewId).eq('version', version).select().maybeSingle()
    : supabase.from(table).insert({ review_id: reviewId, ...values }).select().single();

  pendingSaves.set(timerKey, request);
  try {
    const { data, error } = await request;
    if (error) throw error;
    if (!data) throw new Error('המידע השתנה במקום אחר. יש לרענן את המשוב.');
    group.dataset.version = String(data.version || '');
    setSaveState(group, 'נשמר', 'saved');
  } catch (error) {
    setSaveState(group, error.message || 'השמירה נכשלה', 'error');
    throw error;
  } finally {
    pendingSaves.delete(timerKey);
  }
}

function scheduleSave(group) {
  const type = group.dataset.roleReviewGroup;
  const reviewId = group.dataset.reviewId;
  const key = `${reviewId}:${type}`;
  const existing = saveTimers.get(key);
  if (existing) clearTimeout(existing);
  setSaveState(group, 'ממתין לשמירה…');
  const timer = setTimeout(() => {
    saveGroup(group).catch((error) => console.error('[annual-reviews-role-lessons] save failed', error));
  }, 650);
  saveTimers.set(key, timer);
}

function bindGroup(group) {
  group.querySelectorAll('[data-role-review-field]:not([readonly])').forEach((field) => {
    field.addEventListener('input', (event) => {
      event.stopPropagation();
      scheduleSave(group);
    });
    field.addEventListener('change', (event) => {
      event.stopPropagation();
      scheduleSave(group);
    });
  });
}

async function renderForRoot(root) {
  if (root.dataset.roleLessonsReady === 'true' || root.dataset.roleLessonsLoading === 'true') return;
  if (!root.querySelector('#ar2-employee-section, #ar2-manager-section')) return;

  root.dataset.roleLessonsLoading = 'true';
  try {
    const context = await resolveReview(root);
    if (!context) return;

    const { review, employeeName, isEmployee, isManager } = context;
    const revealed = Boolean(review.answers_revealed_at);
    const managerQuestions = MANAGER_QUESTIONS_BY_EMPLOYEE[employeeName] || [];
    const employeeQuestions = EMPLOYEE_INTERFACE_QUESTIONS_BY_EMPLOYEE[employeeName] || [];

    hideLegacyRoleMetrics(root);

    const employeeForm = root.querySelector('#ar2-employee-section form[data-ar2-form="employee"]');
    if (employeeQuestions.length && employeeForm && (isEmployee || revealed)) {
      const editable = isEmployee
        && review.status === 'employee_preparation'
        && !review.employee_section_submitted_at
        && !review.locked_at;
      const row = await loadRow(TABLES.employee, review.id);
      const group = insertGroup(employeeForm, employeeQuestions, row, editable, 'employee', review.id);
      if (group) bindGroup(group);
    }

    const managerForm = root.querySelector('#ar2-manager-section form[data-ar2-form="manager"]');
    if (managerQuestions.length && managerForm && (isManager || revealed)) {
      const editable = isManager
        && review.status === 'employee_preparation'
        && !review.manager_section_submitted_at
        && !review.locked_at;
      const row = await loadRow(TABLES.manager, review.id);
      const group = insertGroup(managerForm, managerQuestions, row, editable, 'manager', review.id);
      if (group) bindGroup(group);
    }

    root.dataset.roleLessonsReady = 'true';
  } catch (error) {
    console.error('[annual-reviews-role-lessons] render failed', error);
  } finally {
    delete root.dataset.roleLessonsLoading;
  }
}

async function flushForOperation(button, operation) {
  const root = button.closest('.ar2-screen');
  if (!root) return;
  const type = operation === 'submit_employee_section' ? 'employee' : 'manager';
  const group = root.querySelector(`[data-role-review-group="${type}"]`);
  if (group) await saveGroup(group);
  if (pendingSaves.size) await Promise.all([...pendingSaves.values()]);
}

function interceptSubmitButtons() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-ar2-operation]');
    if (!button) return;
    const operation = button.dataset.ar2Operation;
    if (!['submit_employee_section', 'submit_manager_section'].includes(operation)) return;

    if (button.dataset.roleLessonsBypass === 'true') {
      delete button.dataset.roleLessonsBypass;
      return;
    }

    const root = button.closest('.ar2-screen');
    const type = operation === 'submit_employee_section' ? 'employee' : 'manager';
    if (!root?.querySelector(`[data-role-review-group="${type}"]`)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;
    try {
      await flushForOperation(button, operation);
      button.dataset.roleLessonsBypass = 'true';
      button.dataset.nextSchoolYearBypass = 'true';
      button.disabled = false;
      button.click();
    } catch (error) {
      button.disabled = false;
      console.error('[annual-reviews-role-lessons] submit flush failed', error);
      window.alert(error.message || 'שמירת שאלות הפקת הלקחים נכשלה.');
    }
  }, true);
}

function scheduleRender() {
  if (scheduled || processing) return;
  scheduled = true;
  queueMicrotask(async () => {
    scheduled = false;
    processing = true;
    try {
      for (const root of document.querySelectorAll('.ar2-screen')) await renderForRoot(root);
    } finally {
      processing = false;
    }
  });
}

installStyles();
interceptSubmitButtons();
new MutationObserver(scheduleRender).observe(document.documentElement, { childList: true, subtree: true });
scheduleRender();
