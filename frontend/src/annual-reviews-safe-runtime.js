import { supabase } from './supabase-client.js';
import { escapeHtml } from './screens/shared/html.js';

const installers = new Set();
const saveTimers = new WeakMap();
let scheduleToken = 0;

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

export async function resolveAnnualReviewContext(root) {
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
    employeeName,
    isEmployee: review.employee_id === userId,
    isManager: review.manager_id === userId
  };
}

export async function loadAnnualReviewRow(table, reviewId) {
  const { data, error } = await supabase.from(table).select('*').eq('review_id', reviewId).maybeSingle();
  if (error) throw error;
  return data || null;
}

export function syncCoreSubmit(root) {
  if (!root) return;
  for (const type of ['employee', 'manager']) {
    const groups = [...root.querySelectorAll(`[data-safe-owner="${type}"]`)]
      .filter((group) => group.querySelector('textarea:not([readonly])'));
    const blocked = groups.some((group) => ['dirty', 'saving', 'error'].includes(group.dataset.saveState));
    const operation = type === 'employee' ? 'submit_employee_section' : 'submit_manager_section';
    const button = root.querySelector(`[data-ar2-operation="${operation}"]`);
    if (button) button.disabled = blocked;
  }
  const sharedBlocked = [...root.querySelectorAll('[data-safe-shared-save-group]')]
    .some((group) => ['dirty', 'saving', 'error'].includes(group.dataset.saveState));
  root.querySelectorAll('[data-safe-shared-approve]').forEach((button) => {
    button.disabled = sharedBlocked || button.dataset.busy === 'true';
  });
}

export function setSafeSaveState(group, message, state = '') {
  group.dataset.saveState = state;
  const node = group.querySelector('[data-safe-save]');
  if (node) {
    node.textContent = message;
    node.classList.toggle('ar-safe-error', state === 'error');
  }
  syncCoreSubmit(group.closest('.ar2-screen'));
}

export function clearSafeSaveTimer(group) {
  const timer = saveTimers.get(group);
  if (timer) clearTimeout(timer);
  saveTimers.delete(group);
}

function valuesFromGroup(group) {
  return Object.fromEntries([...group.querySelectorAll('[data-safe-field]')]
    .map((field) => [field.dataset.safeField, field.value || '']));
}

export async function saveVersionedQuestionGroup(group) {
  if (!group?.querySelector('textarea:not([readonly])')) return;
  clearSafeSaveTimer(group);
  const table = group.dataset.safeTable;
  const reviewId = group.dataset.reviewId;
  const mode = group.dataset.safeMode;
  const version = Number(group.dataset.version || 0);
  const payload = mode === 'json' ? { answers: valuesFromGroup(group) } : valuesFromGroup(group);
  setSafeSaveState(group, 'שומר…', 'saving');
  const request = version
    ? supabase.from(table).update(payload).eq('review_id', reviewId).eq('version', version).select().maybeSingle()
    : supabase.from(table).insert({ review_id: reviewId, ...payload }).select().single();
  try {
    const { data, error } = await request;
    if (error) throw error;
    if (!data) throw new Error('המידע השתנה במקום אחר. יש לרענן את המשוב.');
    group.dataset.version = String(data.version || '');
    setSafeSaveState(group, 'נשמר', 'saved');
  } catch (error) {
    setSafeSaveState(group, error.message || 'השמירה נכשלה', 'error');
    throw error;
  }
}

function bindVersionedGroup(group) {
  if (group.dataset.safeBound === 'true') return;
  group.dataset.safeBound = 'true';
  group.querySelectorAll('textarea:not([readonly])').forEach((field) => {
    const schedule = () => {
      setSafeSaveState(group, 'ממתין לשמירה…', 'dirty');
      clearSafeSaveTimer(group);
      saveTimers.set(group, setTimeout(() => {
        saveVersionedQuestionGroup(group).catch((error) => console.error('[annual-reviews-safe-runtime] save failed', error));
      }, 450));
    };
    field.addEventListener('input', schedule);
    field.addEventListener('change', schedule);
  });
  setSafeSaveState(group, '', 'saved');
}

function questionHtml(question, value, editable) {
  return `<div class="ar2-question"><div class="ar2-question__title">${escapeHtml(question.title)}</div>
    <p class="ar2-question__prompt">${escapeHtml(question.prompt)}</p>
    <textarea class="ar2-textarea" rows="4" data-safe-field="${escapeHtml(question.key)}" ${editable ? '' : 'readonly'}>${escapeHtml(value || '')}</textarea></div>`;
}

export function insertVersionedQuestionGroup(form, options) {
  const { id, title, questions, row, editable, owner, table, mode, reviewId } = options;
  const list = form?.querySelector('.ar2-question-list');
  if (!list || list.querySelector(`[data-safe-group="${id}"]`)) return null;
  const wrapper = document.createElement('div');
  wrapper.className = 'ar-safe-extra';
  Object.assign(wrapper.dataset, {
    safeGroup: id,
    safeOwner: owner,
    safeTable: table,
    safeMode: mode,
    reviewId,
    version: String(row?.version || '')
  });
  wrapper.innerHTML = `<h3>${escapeHtml(title)}</h3>${questions.map((question) =>
    questionHtml(question, mode === 'json' ? row?.answers?.[question.key] : row?.[question.key], editable)
  ).join('')}<div class="ar-safe-save" data-safe-save aria-live="polite"></div>`;
  const goalsQuestion = list.querySelector('[data-question-key="goals"]');
  list.insertBefore(wrapper, goalsQuestion || null);
  bindVersionedGroup(wrapper);
  return wrapper;
}

async function runInstallers() {
  for (const root of document.querySelectorAll('.ar2-screen')) {
    if (root.dataset.safeExtensionsResolved === 'true') continue;
    if (!root.querySelector('#ar2-employee-section, #ar2-manager-section, #ar2-conversation')) continue;
    let context;
    try {
      context = await resolveAnnualReviewContext(root);
      if (!context) continue;
    } catch (error) {
      console.error('[annual-reviews-safe-runtime] context failed', error);
      continue;
    }
    let failed = false;
    for (const installer of installers) {
      try {
        await installer(root, context);
      } catch (error) {
        failed = true;
        console.error('[annual-reviews-safe-runtime] extension failed', error);
      }
    }
    if (!failed) root.dataset.safeExtensionsResolved = 'true';
  }
}

export function scheduleAnnualReviewExtensions() {
  const token = ++scheduleToken;
  [0, 80, 200, 500, 1000, 2000, 4000, 8000].forEach((delay) => {
    setTimeout(() => {
      if (token !== scheduleToken) return;
      runInstallers();
    }, delay);
  });
}

export function registerAnnualReviewExtension(installer) {
  installers.add(installer);
  scheduleAnnualReviewExtensions();
}

document.addEventListener('click', (event) => {
  if (event.target?.closest?.('[data-ar2-open],[data-ar2-back],[data-ar2-operation],[data-ar2-dashboard]')) {
    scheduleAnnualReviewExtensions();
  }
}, true);
document.addEventListener('app:navigate', scheduleAnnualReviewExtensions);
