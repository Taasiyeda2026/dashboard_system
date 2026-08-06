import { supabase } from './supabase-client.js';
import { escapeHtml } from './screens/shared/html.js';

const mountedRoots = new WeakSet();
const saveTimers = new WeakMap();
const pendingSaves = new Set();
let cachedUserId = '';

function installStyles() {
  if (document.getElementById('annual-reviews-shared-stage-styles')) return;
  const style = document.createElement('style');
  style.id = 'annual-reviews-shared-stage-styles';
  style.textContent = `
    #app .ar-shared-grid{display:grid;gap:12px}
    #app .ar-shared-field{display:grid;gap:6px}
    #app .ar-shared-field>span{font-weight:700;font-size:.9rem}
    #app .ar-shared-goals{display:grid;gap:12px;margin-top:14px}
    #app .ar-shared-goal{border:1px solid var(--ds-border,#d9dee7);border-radius:11px;padding:13px;display:grid;gap:10px}
    #app .ar-shared-goal__title{font-weight:800}
    #app .ar-shared-goal__row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    #app .ar-shared-save{min-height:18px;color:var(--ds-text-muted,#64748b);font-size:.78rem}
    #app .ar-shared-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
    #app .ar-shared-stage textarea,#app .ar-shared-stage input,#app .ar-shared-stage select{width:100%}
    @media(max-width:720px){#app .ar-shared-goal__row{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function replaceAnnualTitles(root = document) {
  const exact = new Map([
    ['משוב שנתי', 'משוב'],
    ['ניהול משובים שנתיים', 'ניהול משובים'],
    ['המשוב השנתי שלי', 'המשוב שלי']
  ]);

  root.querySelectorAll('h1,h2,.ar2-topbar__title').forEach((node) => {
    const replacement = exact.get(node.textContent.trim());
    if (replacement) node.textContent = replacement;
  });

  root.querySelectorAll('.ar2-review-row__name .ar2-muted').forEach((node) => node.remove());

  const headerMeta = root.querySelector('main.ar2-body > header.ar2-card .ar2-card__head .ar2-muted');
  if (headerMeta) {
    const lines = headerMeta.innerHTML
      .split('<br>')
      .map((line) => line.replace(/\s*·\s*20\d{2}\s*/g, '').trim())
      .filter((line) => line && !line.startsWith('תפקיד:'));
    headerMeta.innerHTML = lines.join('<br>');
  }
}

function detailRoot() {
  return [...document.querySelectorAll('.ar2-screen')].find((root) =>
    root.querySelector('main.ar2-body > header.ar2-card')
  ) || null;
}

function employeeNameFromRoot(root) {
  const items = [...root.querySelectorAll('.ar2-signatures span')];
  const employee = items.find((node) => /^(שם העובד\/ת|עובד\/ת):/.test(node.textContent.trim()));
  return employee ? employee.textContent.replace(/^[^:]+:/, '').trim() : '';
}

function yearFromRoot(root) {
  const text = root.querySelector('main.ar2-body > header.ar2-card')?.textContent || '';
  const match = text.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function conversationSection(root) {
  const byId = root.querySelector('#ar2-conversation');
  if (byId) return byId;
  return [...root.querySelectorAll('main.ar2-body > section.ar2-card')].find((section) =>
    section.querySelector('h2')?.textContent.trim() === 'שיחת המשוב'
  ) || null;
}

async function ensureUserId() {
  if (cachedUserId) return cachedUserId;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  cachedUserId = data.session?.user?.id || '';
  if (!cachedUserId) throw new Error('לא נמצאה התחברות פעילה.');
  return cachedUserId;
}

async function resolveReview(employeeName, reviewYear) {
  if (!employeeName) throw new Error('לא ניתן לזהות את העובד במשוב.');

  const { data: assignment, error: assignmentError } = await supabase
    .from('annual_review_assignments')
    .select('employee_id,manager_id,employee_name')
    .eq('employee_name', employeeName)
    .maybeSingle();
  if (assignmentError) throw assignmentError;
  if (!assignment) throw new Error('לא נמצאה הקצאת משוב מתאימה.');

  let query = supabase
    .from('annual_reviews')
    .select('*')
    .eq('employee_id', assignment.employee_id)
    .order('review_year', { ascending: false })
    .limit(1);
  if (reviewYear) query = query.eq('review_year', reviewYear);

  const { data: rows, error: reviewError } = await query;
  if (reviewError) throw reviewError;
  const review = rows?.[0];
  if (!review) throw new Error('המשוב לא נמצא.');

  return { review, assignment };
}

async function loadSharedData(reviewId) {
  const [{ data: summary, error: summaryError }, { data: goals, error: goalsError }] = await Promise.all([
    supabase.from('review_conversation_summary').select('*').eq('review_id', reviewId).maybeSingle(),
    supabase.from('review_goals').select('*').eq('review_id', reviewId).order('sort_order')
  ]);
  if (summaryError) throw summaryError;
  if (goalsError) throw goalsError;
  return { summary, goals: goals || [] };
}

function textarea(name, label, value, editable, rows = 3) {
  return `<label class="ar-shared-field">
    <span>${escapeHtml(label)}</span>
    <textarea class="ar2-textarea" name="${escapeHtml(name)}" rows="${rows}" ${editable ? '' : 'readonly'}>${escapeHtml(value || '')}</textarea>
  </label>`;
}

function goalHtml(goal, editable) {
  const owner = goal?.owner || '';
  return `<div class="ar-shared-goal" data-ar-shared-goal data-goal-id="${escapeHtml(goal?.id || '')}" data-version="${escapeHtml(String(goal?.version || ''))}">
    <div class="ar-shared-goal__title">יעד ${escapeHtml(String(goal?.sort_order || ''))}</div>
    ${textarea('goal', 'היעד', goal?.goal, editable)}
    ${textarea('agreed_actions', 'הפעולות הנדרשות', goal?.agreed_actions, editable)}
    ${textarea('success_measure', 'מדד להצלחה', goal?.success_measure, editable)}
    <div class="ar-shared-goal__row">
      <label class="ar-shared-field">
        <span>אחריות</span>
        <select class="ar2-select" name="owner" ${editable ? '' : 'disabled'}>
          <option value="" ${owner ? '' : 'selected'}>בחירה</option>
          <option value="employee" ${owner === 'employee' ? 'selected' : ''}>עובד/ת</option>
          <option value="manager" ${owner === 'manager' ? 'selected' : ''}>מנהל</option>
          <option value="shared" ${owner === 'shared' ? 'selected' : ''}>משותפת</option>
        </select>
      </label>
      <label class="ar-shared-field">
        <span>מועד יעד</span>
        <input class="ar2-input" type="date" name="target_date" value="${escapeHtml(goal?.target_date || '')}" ${editable ? '' : 'readonly'}>
      </label>
    </div>
    <div class="ar-shared-save" aria-live="polite"></div>
  </div>`;
}

function normalizedGoals(goals) {
  const byOrder = new Map(goals.map((goal) => [Number(goal.sort_order), goal]));
  return [1, 2, 3].map((sortOrder) => byOrder.get(sortOrder) || {
    id: '',
    version: '',
    sort_order: sortOrder,
    goal: '',
    agreed_actions: '',
    success_measure: '',
    owner: '',
    target_date: ''
  });
}

function simpleStage(section, complete, button = '') {
  section.id = 'ar2-conversation';
  section.classList.add('ar-shared-stage');
  section.innerHTML = `<div class="ar2-card__head">
    <div><h2>סיכום ויעדים</h2></div>
    <span class="ar2-status ${complete ? 'is-complete' : ''}">${complete ? 'הושלם' : 'טרם הושלם'}</span>
  </div>${button}`;
}

function renderSharedStage(section, review, shared, userId) {
  const completed = Boolean(review.conversation_completed_at)
    || ['manager_preparation', 'awaiting_employee_response', 'completed_locked'].includes(review.status);

  if (!['ready_for_conversation', 'conversation_in_progress', 'manager_preparation', 'awaiting_employee_response', 'completed_locked'].includes(review.status)) {
    simpleStage(section, false);
    return;
  }

  const isManager = review.manager_id === userId;
  const isEmployee = review.employee_id === userId;

  if (review.status === 'ready_for_conversation') {
    simpleStage(
      section,
      false,
      isManager
        ? '<div class="ar-shared-actions ar2-no-print"><button type="button" class="ar2-btn ar2-btn--primary" data-ar-shared-start>התחלת שיחת המשוב</button></div>'
        : ''
    );
    return;
  }

  const summary = shared.summary || {};
  const goals = normalizedGoals(shared.goals);
  const editable = review.status === 'conversation_in_progress'
    && !review.employee_approved_at
    && !review.manager_approved_at;

  const employeeButton = review.status === 'conversation_in_progress'
    && isEmployee
    && !review.employee_approved_at
    ? '<button type="button" class="ar2-btn ar2-btn--primary" data-ar-shared-approve="employee">אישור העובד/ת</button>'
    : '';

  const managerButton = review.status === 'conversation_in_progress'
    && isManager
    && !review.manager_approved_at
    ? '<button type="button" class="ar2-btn ar2-btn--primary" data-ar-shared-approve="manager">אישור המנהל</button>'
    : '';

  section.id = 'ar2-conversation';
  section.classList.add('ar-shared-stage');
  section.innerHTML = `<div class="ar2-card__head">
    <div><h2>סיכום ויעדים</h2></div>
    <span class="ar2-status ${completed ? 'is-complete' : ''}">${completed ? 'הושלם' : 'טרם הושלם'}</span>
  </div>
  <form class="ar-shared-grid" data-ar-shared-summary data-version="${escapeHtml(String(summary.version || ''))}">
    ${textarea('agreed_summary', 'נקודות מרכזיות שסוכמו', summary.agreed_summary, editable, 4)}
    ${textarea('support_needed', 'תמיכה נדרשת', summary.support_needed, editable)}
    ${textarea('follow_up_actions', 'פעולות המשך', summary.follow_up_actions, editable)}
    <div class="ar-shared-save" aria-live="polite"></div>
  </form>
  <div class="ar-shared-goals">${goals.map((goal) => goalHtml(goal, editable)).join('')}</div>
  ${(employeeButton || managerButton) ? `<div class="ar-shared-actions ar2-no-print">${employeeButton}${managerButton}</div>` : ''}`;

  section.dataset.reviewId = review.id;
  section.dataset.reviewVersion = String(review.version);
}

function setSaveState(node, message) {
  const output = node.querySelector('.ar-shared-save');
  if (output) output.textContent = message;
}

async function saveSummary(form, reviewId) {
  if (!form.querySelector('textarea:not([readonly])')) return;
  const version = Number(form.dataset.version || 0);
  setSaveState(form, 'שומר…');
  const values = {
    agreed_summary: form.elements.agreed_summary?.value || '',
    support_needed: form.elements.support_needed?.value || '',
    follow_up_actions: form.elements.follow_up_actions?.value || ''
  };

  let query = supabase.from('review_conversation_summary').update(values).eq('review_id', reviewId);
  if (version) query = query.eq('version', version);
  const promise = query.select().maybeSingle();
  pendingSaves.add(promise);
  try {
    const { data, error } = await promise;
    if (error) throw error;
    if (!data) throw new Error('המידע השתנה במקום אחר. יש לרענן את המשוב.');
    form.dataset.version = String(data.version || '');
    setSaveState(form, 'נשמר');
  } finally {
    pendingSaves.delete(promise);
  }
}

async function saveGoal(node) {
  if (!node.querySelector('textarea:not([readonly]),input:not([readonly]),select:not([disabled])')) return;
  const id = node.dataset.goalId;
  const version = Number(node.dataset.version || 0);
  if (!id) throw new Error('יעדי השיחה טרם נוצרו. יש לרענן את המשוב.');

  setSaveState(node, 'שומר…');
  const values = {
    goal: node.querySelector('[name="goal"]')?.value || '',
    agreed_actions: node.querySelector('[name="agreed_actions"]')?.value || '',
    success_measure: node.querySelector('[name="success_measure"]')?.value || '',
    owner: node.querySelector('[name="owner"]')?.value || '',
    target_date: node.querySelector('[name="target_date"]')?.value || null
  };

  let query = supabase.from('review_goals').update(values).eq('id', id);
  if (version) query = query.eq('version', version);
  const promise = query.select().maybeSingle();
  pendingSaves.add(promise);
  try {
    const { data, error } = await promise;
    if (error) throw error;
    if (!data) throw new Error('היעד השתנה במקום אחר. יש לרענן את המשוב.');
    node.dataset.version = String(data.version || '');
    setSaveState(node, 'נשמר');
  } finally {
    pendingSaves.delete(promise);
  }
}

function scheduleSave(node, callback) {
  const existing = saveTimers.get(node);
  if (existing) clearTimeout(existing);
  setSaveState(node, 'ממתין לשמירה…');
  const timer = setTimeout(() => {
    saveTimers.delete(node);
    callback().catch((error) => showMessage(friendlyError(error), true));
  }, 650);
  saveTimers.set(node, timer);
}

async function flushSharedStage(section) {
  const summary = section.querySelector('[data-ar-shared-summary]');
  if (summary?.querySelector('textarea:not([readonly])')) {
    const timer = saveTimers.get(summary);
    if (timer) clearTimeout(timer);
    saveTimers.delete(summary);
    await saveSummary(summary, section.dataset.reviewId);
  }

  for (const goal of section.querySelectorAll('[data-ar-shared-goal]')) {
    if (!goal.querySelector('textarea:not([readonly]),input:not([readonly]),select:not([disabled])')) continue;
    const timer = saveTimers.get(goal);
    if (timer) clearTimeout(timer);
    saveTimers.delete(goal);
    await saveGoal(goal);
  }

  if (pendingSaves.size) await Promise.all([...pendingSaves]);
}

function friendlyError(error) {
  const message = String(error?.message || error || '');
  const replacements = [
    ['annual_review_shared_summary_required', 'יש למלא את הנקודות המרכזיות שסוכמו.'],
    ['annual_review_goal_required', 'יש למלא לפחות יעד אחד.'],
    ['annual_review_goal_incomplete', 'יש להשלים את כל הפרטים בכל יעד שנפתח.'],
    ['annual_review_conversation_not_editable', 'הסיכום והיעדים אינם ניתנים עוד לעריכה.'],
    ['annual_review_version_conflict', 'המשוב השתנה במקום אחר. יש לרענן ולנסות שוב.'],
    ['annual_review_invalid_state', 'הפעולה אינה זמינה בשלב הנוכחי.']
  ];
  return replacements.find(([key]) => message.includes(key))?.[1] || message || 'הפעולה נכשלה.';
}

function showMessage(message, error = false) {
  let toast = document.querySelector('.ar-shared-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'ar2-toast ar-shared-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.dataset.tone = error ? 'error' : 'success';
  toast.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.hidden = true;
  }, 3500);
}

async function reopenCurrentReview(root, reviewId) {
  const back = root.querySelector('[data-ar2-back]');
  if (!back) {
    window.location.reload();
    return;
  }
  back.click();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 80));
    const open = document.querySelector(`[data-ar2-open="${CSS.escape(reviewId)}"]`);
    if (open) {
      open.click();
      return;
    }
  }
  window.location.reload();
}

async function runStageOperation(root, section, review, operation) {
  const confirmation = operation === 'start_review_conversation'
    ? 'להתחיל את שיחת המשוב?'
    : 'לאשר את הסיכום והיעדים המשותפים? לאחר האישור לא ניתן יהיה לערוך אותם.';
  if (!window.confirm(confirmation)) return;

  const button = section.querySelector(
    operation === 'start_review_conversation'
      ? '[data-ar-shared-start]'
      : operation.endsWith('employee')
        ? '[data-ar-shared-approve="employee"]'
        : '[data-ar-shared-approve="manager"]'
  );
  if (button) button.disabled = true;

  try {
    if (operation !== 'start_review_conversation') await flushSharedStage(section);
    const { error } = await supabase.rpc(operation, {
      p_review_id: review.id,
      p_expected_version: review.version
    });
    if (error) throw error;
    await reopenCurrentReview(root, review.id);
    showMessage('הפעולה הושלמה.');
  } catch (error) {
    if (button) button.disabled = false;
    showMessage(friendlyError(error), true);
  }
}

function bindSharedStage(root, section, review) {
  const summary = section.querySelector('[data-ar-shared-summary]');
  if (summary) {
    const schedule = () => scheduleSave(summary, () => saveSummary(summary, review.id));
    summary.addEventListener('input', schedule);
    summary.addEventListener('change', schedule);
  }

  section.querySelectorAll('[data-ar-shared-goal]').forEach((goal) => {
    const schedule = () => scheduleSave(goal, () => saveGoal(goal));
    goal.addEventListener('input', schedule);
    goal.addEventListener('change', schedule);
  });

  section.querySelector('[data-ar-shared-start]')?.addEventListener('click', () =>
    runStageOperation(root, section, review, 'start_review_conversation')
  );
  section.querySelector('[data-ar-shared-approve="employee"]')?.addEventListener('click', () =>
    runStageOperation(root, section, review, 'approve_conversation_as_employee')
  );
  section.querySelector('[data-ar-shared-approve="manager"]')?.addEventListener('click', () =>
    runStageOperation(root, section, review, 'approve_conversation_as_manager')
  );
}

async function mountSharedStage(root) {
  if (mountedRoots.has(root)) return;
  const section = conversationSection(root);
  if (!section) return;

  mountedRoots.add(root);
  const employeeName = employeeNameFromRoot(root);
  const reviewYear = yearFromRoot(root);
  try {
    const userId = await ensureUserId();
    const { review } = await resolveReview(employeeName, reviewYear);
    const shared = ['conversation_in_progress', 'manager_preparation', 'awaiting_employee_response', 'completed_locked'].includes(review.status)
      ? await loadSharedData(review.id)
      : { summary: null, goals: [] };

    renderSharedStage(section, review, shared, userId);
    bindSharedStage(root, section, review);
  } catch (error) {
    mountedRoots.delete(root);
    console.warn('[annual-reviews-shared-stage]', error);
  }
}

let scanQueued = false;
function scan() {
  replaceAnnualTitles(document);
  const root = detailRoot();
  if (root) mountSharedStage(root);
}

function scheduleScan() {
  if (scanQueued) return;
  scanQueued = true;
  queueMicrotask(() => {
    scanQueued = false;
    scan();
  });
}

installStyles();
new MutationObserver(scheduleScan).observe(document.documentElement, {
  childList: true,
  subtree: true
});
scheduleScan();
