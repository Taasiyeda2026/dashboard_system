import { supabase } from './supabase-client.js';
import { escapeHtml } from './screens/shared/html.js';

const EMPLOYEE_QUESTIONS = [
  {
    key: 'readiness',
    title: 'היערכות לפתיחת שנת הלימודים',
    prompt: 'מה נדרש להשלים או לקדם כדי להתחיל את שנת הלימודים הבאה באופן מסודר ומוכן?'
  },
  {
    key: 'priorities',
    title: 'דגשים לתחילת שנת הלימודים',
    prompt: 'אילו אתגרים, צרכים או סדרי עדיפויות חשוב להביא בחשבון בתחילת שנת הלימודים הבאה?'
  }
];

const MANAGER_QUESTIONS = [
  {
    key: 'readiness',
    title: 'היערכות לפתיחת שנת הלימודים',
    prompt: 'מה נדרש מהעובד להשלים או לקדם לקראת פתיחת שנת הלימודים הבאה?'
  },
  {
    key: 'priorities',
    title: 'דגשים לתחילת שנת הלימודים',
    prompt: 'אילו סדרי עדיפויות, ציפיות או נושאים דורשים תשומת לב בתחילת שנת הלימודים הבאה?'
  }
];

const TABLES = {
  employee: 'employee_review_next_school_year',
  manager: 'manager_review_next_school_year'
};

const saveTimers = new Map();
const pendingSaves = new Map();
let processing = false;
let scheduled = false;

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
    userId,
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
  return `<div class="ar2-question" data-next-school-year-question="${escapeHtml(type)}:${escapeHtml(question.key)}">
    <div class="ar2-question__title">${escapeHtml(question.title)}</div>
    <p class="ar2-question__prompt">${escapeHtml(question.prompt)}</p>
    <textarea class="ar2-textarea" rows="4" data-next-school-year-field="${escapeHtml(question.key)}" ${editable ? '' : 'readonly'}>${escapeHtml(value || '')}</textarea>
  </div>`;
}

function insertQuestions(form, questions, row, editable, type) {
  const list = form.querySelector('.ar2-question-list');
  if (!list || list.querySelector(`[data-next-school-year-group="${type}"]`)) return null;

  const wrapper = document.createElement('div');
  wrapper.dataset.nextSchoolYearGroup = type;
  wrapper.dataset.reviewId = form.dataset.nextSchoolYearReviewId || '';
  wrapper.dataset.version = String(row?.version || '');
  wrapper.innerHTML = `${questions.map((question) => questionHtml(question, row?.[question.key], editable, type)).join('')}
    <div class="ar2-save" data-next-school-year-save aria-live="polite"></div>`;

  const goalsQuestion = list.querySelector('[data-question-key="goals"]');
  list.insertBefore(wrapper, goalsQuestion || null);
  return wrapper;
}

function setSaveState(group, message, kind = '') {
  const node = group?.querySelector('[data-next-school-year-save]');
  if (!node) return;
  node.textContent = message;
  node.dataset.state = kind;
}

function valuesFromGroup(group) {
  return Object.fromEntries(
    [...group.querySelectorAll('[data-next-school-year-field]')].map((field) => [field.dataset.nextSchoolYearField, field.value || ''])
  );
}

async function saveGroup(group) {
  if (!group || !group.querySelector('[data-next-school-year-field]:not([readonly])')) return;
  const type = group.dataset.nextSchoolYearGroup;
  const table = TABLES[type];
  const reviewId = group.dataset.reviewId;
  if (!table || !reviewId) return;

  const timerKey = `${reviewId}:${type}`;
  const timer = saveTimers.get(timerKey);
  if (timer) clearTimeout(timer);
  saveTimers.delete(timerKey);

  const values = valuesFromGroup(group);
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
  const type = group.dataset.nextSchoolYearGroup;
  const reviewId = group.dataset.reviewId;
  const key = `${reviewId}:${type}`;
  const existing = saveTimers.get(key);
  if (existing) clearTimeout(existing);
  setSaveState(group, 'ממתין לשמירה…');
  const timer = setTimeout(() => {
    saveGroup(group).catch((error) => console.error('[annual-reviews-next-school-year] save failed', error));
  }, 650);
  saveTimers.set(key, timer);
}

function bindGroup(group) {
  group.querySelectorAll('[data-next-school-year-field]:not([readonly])').forEach((field) => {
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
  if (root.dataset.nextSchoolYearReady === 'true' || root.dataset.nextSchoolYearLoading === 'true') return;
  if (!root.querySelector('#ar2-employee-section, #ar2-manager-section')) return;

  root.dataset.nextSchoolYearLoading = 'true';
  try {
    const context = await resolveReview(root);
    if (!context) return;

    const { review, isEmployee, isManager } = context;
    const revealed = Boolean(review.answers_revealed_at);

    const employeeForm = root.querySelector('#ar2-employee-section form[data-ar2-form="employee"]');
    if (employeeForm && (isEmployee || revealed)) {
      const editable = isEmployee
        && review.status === 'employee_preparation'
        && !review.employee_section_submitted_at
        && !review.locked_at;
      const row = await loadRow(TABLES.employee, review.id);
      employeeForm.dataset.nextSchoolYearReviewId = review.id;
      const group = insertQuestions(employeeForm, EMPLOYEE_QUESTIONS, row, editable, 'employee');
      if (group) {
        group.dataset.reviewId = review.id;
        bindGroup(group);
      }
    }

    const managerForm = root.querySelector('#ar2-manager-section form[data-ar2-form="manager"]');
    if (managerForm && (isManager || revealed)) {
      const editable = isManager
        && review.status === 'employee_preparation'
        && !review.manager_section_submitted_at
        && !review.locked_at;
      const row = await loadRow(TABLES.manager, review.id);
      managerForm.dataset.nextSchoolYearReviewId = review.id;
      const group = insertQuestions(managerForm, MANAGER_QUESTIONS, row, editable, 'manager');
      if (group) {
        group.dataset.reviewId = review.id;
        bindGroup(group);
      }
    }

    root.dataset.nextSchoolYearReady = 'true';
  } catch (error) {
    console.error('[annual-reviews-next-school-year] render failed', error);
  } finally {
    delete root.dataset.nextSchoolYearLoading;
  }
}

async function flushForOperation(button, operation) {
  const root = button.closest('.ar2-screen');
  if (!root) return;
  const type = operation === 'submit_employee_section' ? 'employee' : 'manager';
  const group = root.querySelector(`[data-next-school-year-group="${type}"]`);
  if (group) await saveGroup(group);
  if (pendingSaves.size) await Promise.all([...pendingSaves.values()]);
}

function interceptSubmitButtons() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-ar2-operation]');
    if (!button) return;
    const operation = button.dataset.ar2Operation;
    if (!['submit_employee_section', 'submit_manager_section'].includes(operation)) return;
    if (button.dataset.nextSchoolYearBypass === 'true') {
      delete button.dataset.nextSchoolYearBypass;
      return;
    }

    const root = button.closest('.ar2-screen');
    const type = operation === 'submit_employee_section' ? 'employee' : 'manager';
    if (!root?.querySelector(`[data-next-school-year-group="${type}"]`)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;
    try {
      await flushForOperation(button, operation);
      button.dataset.nextSchoolYearBypass = 'true';
      button.disabled = false;
      button.click();
    } catch (error) {
      button.disabled = false;
      console.error('[annual-reviews-next-school-year] submit flush failed', error);
      window.alert(error.message || 'שמירת השאלות לקראת שנת הלימודים הבאה נכשלה.');
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

interceptSubmitButtons();
new MutationObserver(scheduleRender).observe(document.documentElement, { childList: true, subtree: true });
scheduleRender();
