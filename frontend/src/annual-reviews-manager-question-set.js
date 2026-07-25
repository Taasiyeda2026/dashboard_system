import { supabase } from './supabase-client.js';
import { escapeHtml } from './screens/shared/html.js';
import { registerAnnualReviewExtension } from './annual-reviews-safe-runtime.js';

const QUESTIONS = [
  {
    key: 'professional_quality',
    title: 'מקצועיות ואיכות הביצוע',
    prompt: 'באיזו מידה העובד/ת ביצע/ה את תחומי אחריותו/ה ברמה המקצועית ובאיכות הנדרשת?',
    rating: true
  },
  {
    key: 'task_management',
    title: 'ניהול משימות ואחריות',
    prompt: 'באיזו מידה העובד/ת ניהל/ה את משימותיו/ה, עמד/ה בהתחייבויות ופעל/ה בהתאם לסדרי העדיפויות וללוחות הזמנים?',
    rating: true
  },
  {
    key: 'collaboration_communication',
    title: 'שיתוף פעולה ותקשורת',
    prompt: 'באיזו מידה העובד/ת שיתף/ה פעולה, העביר/ה מידע בזמן והתנהל/ה באופן מקצועי מול המנהל, הצוות וממשקי העבודה?',
    rating: true
  },
  {
    key: 'initiative_problem_solving',
    title: 'יוזמה ופתרון בעיות',
    prompt: 'באיזו מידה העובד/ת זיהה/תה צרכים, הציע/ה פתרונות וקידם/ה משימות באופן עצמאי?',
    rating: true
  },
  {
    key: 'learning_feedback',
    title: 'למידה ויישום משוב',
    prompt: 'באיזו מידה העובד/ת הפגין/ה למידה, קיבל/ה משוב ויישם/ה אותו בעבודה?',
    rating: true
  },
  {
    key: 'achievements_strengths',
    title: 'הישגים וחוזקות',
    prompt: 'אילו הישגים, תרומות או חוזקות של העובד/ת בלטו בתקופה הנבחנת, ומה חשוב להמשיך לשמר?',
    rating: false
  },
  {
    key: 'improvement_lessons',
    title: 'נקודות לשיפור והפקת לקחים',
    prompt: 'אילו תחומים בהתנהלות או בביצוע דורשים חיזוק או שיפור, ואילו לקחים חשוב להפיק לקראת המשך העבודה?',
    rating: false
  },
  {
    key: 'managerial_support',
    title: 'אחריות וליווי ניהולי',
    prompt: 'אילו הבהרות, כלים, משאבים, תיאום או ליווי ניהולי נדרש ממך לספק כדי לאפשר לעובד/ת לבצע את תפקידו/ה בצורה מיטבית?',
    rating: false
  }
];

const timers = new WeakMap();

function ratingButtons(answer, editable, key) {
  const selected = Number(answer?.rating || 0);
  const notApplicable = Boolean(answer?.not_applicable);
  return `<div class="ar2-rating-wrap">
    <span class="ar2-rating-label">דירוג:</span>
    ${[1, 2, 3, 4, 5].map((value) => `<button type="button" class="ar2-rating ${selected === value && !notApplicable ? 'is-selected' : ''}" data-manager-rating="${value}" data-question-key="${escapeHtml(key)}" ${editable ? '' : 'disabled'}>${value}</button>`).join('')}
    <button type="button" class="ar2-rating ${notApplicable ? 'is-selected' : ''}" data-manager-rating="na" data-question-key="${escapeHtml(key)}" ${editable ? '' : 'disabled'}>לא רלוונטי</button>
  </div>`;
}

function questionHtml(question, answer, editable) {
  return `<div class="ar2-question" data-manager-question="${escapeHtml(question.key)}">
    <div class="ar2-question__title">${escapeHtml(question.title)}</div>
    <p class="ar2-question__prompt">${escapeHtml(question.prompt)}</p>
    ${question.rating ? ratingButtons(answer, editable, question.key) : ''}
    <textarea class="ar2-textarea" rows="3" name="${escapeHtml(question.key)}" ${editable ? '' : 'readonly'}>${escapeHtml(answer?.text || '')}</textarea>
  </div>`;
}

function valuesFromForm(form) {
  return Object.fromEntries(QUESTIONS.map((question) => {
    const node = form.querySelector(`[data-manager-question="${CSS.escape(question.key)}"]`);
    const selected = node?.querySelector('[data-manager-rating].is-selected')?.dataset.managerRating || '';
    return [question.key, {
      text: form.elements[question.key]?.value || '',
      rating: question.rating && selected && selected !== 'na' ? Number(selected) : null,
      not_applicable: question.rating && selected === 'na'
    }];
  }));
}

function setState(form, message, state = '') {
  form.dataset.saveState = state;
  const node = form.querySelector('[data-manager-save]');
  if (node) {
    node.textContent = message;
    node.dataset.state = state;
  }
  const button = form.closest('#ar2-manager-section')?.querySelector('[data-manager-question-submit]');
  if (button) button.disabled = ['dirty', 'saving', 'error'].includes(state) || button.dataset.busy === 'true';
}

async function saveNow(form) {
  const timer = timers.get(form);
  if (timer) clearTimeout(timer);
  timers.delete(form);
  if (!form.querySelector('textarea:not([readonly])')) return;

  const reviewId = form.dataset.reviewId;
  const version = Number(form.dataset.version || 0);
  const payload = { answers: valuesFromForm(form) };
  setState(form, 'שומר…', 'saving');

  const request = version
    ? supabase.from('manager_review_preparation').update(payload).eq('review_id', reviewId).eq('version', version).select().maybeSingle()
    : supabase.from('manager_review_preparation').insert({ review_id: reviewId, ...payload }).select().single();

  const { data, error } = await request;
  if (error) {
    setState(form, error.message || 'השמירה נכשלה', 'error');
    throw error;
  }
  if (!data) {
    const conflict = new Error('המידע השתנה במקום אחר. יש לרענן את המשוב.');
    setState(form, conflict.message, 'error');
    throw conflict;
  }

  form.dataset.version = String(data.version || '');
  setState(form, 'נשמר', 'saved');
}

function scheduleSave(form) {
  setState(form, 'ממתין לשמירה…', 'dirty');
  const previous = timers.get(form);
  if (previous) clearTimeout(previous);
  timers.set(form, setTimeout(() => {
    saveNow(form).catch((error) => console.error('[annual-reviews-manager-question-set] save failed', error));
  }, 500));
}

function removeLegacyManagerContent(section) {
  section.querySelector('form[data-ar2-form="manager"]')?.remove();
  const metrics = section.querySelector('.ar2-metrics');
  if (metrics?.parentElement) metrics.parentElement.remove();
  section.querySelectorAll('[data-safe-group="next-year-manager"],[data-safe-group="role-lessons-manager"]').forEach((node) => node.remove());
}

function replaceSubmitButton(section, form, review) {
  const original = section.querySelector('[data-ar2-operation="submit_manager_section"]');
  if (!original) return;
  const button = original.cloneNode(true);
  button.removeAttribute('data-ar2-operation');
  button.dataset.managerQuestionSubmit = 'true';
  original.replaceWith(button);

  button.addEventListener('click', async () => {
    if (!window.confirm('לאחר האישור לא ניתן יהיה לערוך את חלק המנהל. התוכן ייחשף רק לאחר אישור חלק העובד. להמשיך?')) return;
    button.dataset.busy = 'true';
    button.disabled = true;
    try {
      await saveNow(form);
      const { error } = await supabase.rpc('submit_manager_section', {
        p_review_id: review.id,
        p_expected_version: review.version
      });
      if (error) throw error;
      window.location.reload();
    } catch (error) {
      button.dataset.busy = 'false';
      setState(form, error.message || 'אישור חלק המנהל נכשל.', 'error');
      window.alert(error.message || 'אישור חלק המנהל נכשל.');
    }
  });
}

registerAnnualReviewExtension(async (root, context) => {
  const section = root.querySelector('#ar2-manager-section');
  if (!section || section.dataset.managerQuestionSet === 'v2') return;

  const { review, isManager } = context;
  const revealed = Boolean(review.answers_revealed_at);
  if (!isManager && !revealed) return;

  const { data: row, error } = await supabase
    .from('manager_review_preparation')
    .select('*')
    .eq('review_id', review.id)
    .maybeSingle();
  if (error) throw error;

  const editable = isManager
    && review.status === 'employee_preparation'
    && !review.manager_section_submitted_at
    && !review.locked_at;

  removeLegacyManagerContent(section);

  const description = section.querySelector('.ar2-card__head .ar2-muted');
  if (description) description.textContent = 'הערכת המנהל מבוססת על ביצועים והתנהלות שנצפו במסגרת העבודה והניהול הישיר.';

  const form = document.createElement('form');
  form.className = 'ar2-manager-question-set';
  form.dataset.reviewId = review.id;
  form.dataset.version = String(row?.version || '');
  form.innerHTML = `<div class="ar2-question-list">${QUESTIONS.map((question) => questionHtml(question, row?.answers?.[question.key], editable)).join('')}</div>
    <div class="ar2-save" data-manager-save aria-live="polite"></div>`;

  const actions = section.querySelector('.ar2-actions');
  section.insertBefore(form, actions || null);
  section.dataset.managerQuestionSet = 'v2';

  if (editable) {
    form.addEventListener('input', () => scheduleSave(form));
    form.addEventListener('change', () => scheduleSave(form));
    form.querySelectorAll('[data-manager-rating]').forEach((button) => {
      button.addEventListener('click', () => {
        const question = button.closest('[data-manager-question]');
        question?.querySelectorAll('[data-manager-rating]').forEach((item) => item.classList.remove('is-selected'));
        button.classList.add('is-selected');
        scheduleSave(form);
      });
    });
    replaceSubmitButton(section, form, review);
  }

  setState(form, '', 'saved');
});
