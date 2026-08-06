import { supabase } from './supabase-client.js';
import { escapeHtml } from './screens/shared/html.js';
import {
  registerAnnualReviewExtension,
  setSafeSaveState,
  syncCoreSubmit,
  clearSafeSaveTimer
} from './annual-reviews-safe-runtime.js';

const saveTimers = new WeakMap();

function installStyles() {
  if (document.getElementById('annual-reviews-shared-stage-safe-styles')) return;
  const style = document.createElement('style');
  style.id = 'annual-reviews-shared-stage-safe-styles';
  style.textContent = `
    #app .ar-safe-shared{display:grid;gap:14px;margin-top:14px}
    #app .ar-safe-shared-grid{display:grid;gap:12px}
    #app .ar-safe-goal{display:grid;gap:9px;padding:12px;border:1px solid var(--ds-border,#d9dee7);border-radius:10px}
    #app .ar-safe-goal-row{display:grid;grid-template-columns:1fr 1fr;gap:9px}
    #app .ar-safe-actions{display:flex;gap:8px;flex-wrap:wrap}
    @media(max-width:720px){#app .ar-safe-goal-row{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function clearTimer(group) {
  const timer = saveTimers.get(group);
  if (timer) clearTimeout(timer);
  saveTimers.delete(group);
  clearSafeSaveTimer(group);
}

function summaryValues(group) {
  return Object.fromEntries([...group.querySelectorAll('[data-safe-field]')]
    .map((field) => [field.dataset.safeField, field.value || '']));
}

async function saveSummary(group) {
  if (!group?.querySelector('textarea:not([readonly])')) return;
  clearTimer(group);
  const reviewId = group.dataset.reviewId;
  const version = Number(group.dataset.version || 0);
  setSafeSaveState(group, 'שומר…', 'saving');
  const values = summaryValues(group);
  const request = version
    ? supabase.from('review_conversation_summary').update(values).eq('review_id', reviewId).eq('version', version).select().maybeSingle()
    : supabase.from('review_conversation_summary').insert({ review_id: reviewId, ...values }).select().single();
  try {
    const { data, error } = await request;
    if (error) throw error;
    if (!data) throw new Error('הסיכום השתנה במקום אחר. יש לרענן.');
    group.dataset.version = String(data.version || '');
    setSafeSaveState(group, 'נשמר', 'saved');
  } catch (error) {
    setSafeSaveState(group, error.message || 'השמירה נכשלה', 'error');
    throw error;
  }
}

function goalValues(group) {
  return {
    goal: group.querySelector('[name="goal"]')?.value || '',
    agreed_actions: group.querySelector('[name="agreed_actions"]')?.value || '',
    success_measure: group.querySelector('[name="success_measure"]')?.value || '',
    owner: group.querySelector('[name="owner"]')?.value || '',
    target_date: group.querySelector('[name="target_date"]')?.value || null
  };
}

async function saveGoal(group) {
  if (!group?.querySelector('textarea:not([readonly])')) return;
  clearTimer(group);
  const reviewId = group.dataset.reviewId;
  const id = group.dataset.goalId;
  const version = Number(group.dataset.version || 0);
  const sortOrder = Number(group.dataset.sortOrder || 0);
  setSafeSaveState(group, 'שומר…', 'saving');
  const values = goalValues(group);
  const request = id
    ? supabase.from('review_goals').update(values).eq('id', id).eq('version', version).select().maybeSingle()
    : supabase.from('review_goals').insert({ review_id: reviewId, sort_order: sortOrder, ...values }).select().single();
  try {
    const { data, error } = await request;
    if (error) throw error;
    if (!data) throw new Error('היעד השתנה במקום אחר. יש לרענן.');
    group.dataset.goalId = data.id || '';
    group.dataset.version = String(data.version || '');
    setSafeSaveState(group, 'נשמר', 'saved');
  } catch (error) {
    setSafeSaveState(group, error.message || 'השמירה נכשלה', 'error');
    throw error;
  }
}

function bindGroup(group, saveNow) {
  if (group.dataset.safeBound === 'true') return;
  group.dataset.safeBound = 'true';
  group.querySelectorAll('textarea:not([readonly]),input:not([readonly]),select:not([disabled])').forEach((field) => {
    const schedule = () => {
      setSafeSaveState(group, 'ממתין לשמירה…', 'dirty');
      clearTimer(group);
      saveTimers.set(group, setTimeout(() => {
        saveNow(group).catch((error) => console.error('[annual-reviews-shared-stage-safe] save failed', error));
      }, 450));
    };
    field.addEventListener('input', schedule);
    field.addEventListener('change', schedule);
  });
  setSafeSaveState(group, '', 'saved');
}

function goalHtml(goal, editable, reviewId) {
  const owner = goal?.owner || '';
  return `<div class="ar-safe-goal" data-safe-shared-save-group data-review-id="${escapeHtml(reviewId)}" data-goal-id="${escapeHtml(goal?.id || '')}" data-sort-order="${escapeHtml(String(goal?.sort_order || ''))}" data-version="${escapeHtml(String(goal?.version || ''))}">
    <strong>יעד ${escapeHtml(String(goal?.sort_order || ''))}</strong>
    <label class="ar2-field"><span>היעד</span><textarea class="ar2-textarea" rows="2" name="goal" ${editable ? '' : 'readonly'}>${escapeHtml(goal?.goal || '')}</textarea></label>
    <label class="ar2-field"><span>פעולות מוסכמות</span><textarea class="ar2-textarea" rows="2" name="agreed_actions" ${editable ? '' : 'readonly'}>${escapeHtml(goal?.agreed_actions || '')}</textarea></label>
    <label class="ar2-field"><span>מדד הצלחה</span><textarea class="ar2-textarea" rows="2" name="success_measure" ${editable ? '' : 'readonly'}>${escapeHtml(goal?.success_measure || '')}</textarea></label>
    <div class="ar-safe-goal-row">
      <label class="ar2-field"><span>אחריות</span><select class="ar2-select" name="owner" ${editable ? '' : 'disabled'}>
        <option value="">בחירה</option>
        <option value="employee" ${owner === 'employee' ? 'selected' : ''}>עובד/ת</option>
        <option value="manager" ${owner === 'manager' ? 'selected' : ''}>מנהל/ת</option>
        <option value="shared" ${owner === 'shared' ? 'selected' : ''}>משותפת</option>
      </select></label>
      <label class="ar2-field"><span>תאריך יעד</span><input class="ar2-input" type="date" name="target_date" value="${escapeHtml(goal?.target_date || '')}" ${editable ? '' : 'readonly'}></label>
    </div>
    <div class="ar-safe-save" data-safe-save aria-live="polite"></div>
  </div>`;
}

async function flushAll(wrapper) {
  const groups = [...wrapper.querySelectorAll('[data-safe-shared-save-group]')];
  for (const group of groups) {
    clearTimer(group);
    if (group.matches('.ar-safe-goal')) await saveGoal(group);
    else await saveSummary(group);
  }
}

registerAnnualReviewExtension(async (root, context) => {
  const { review, isEmployee, isManager } = context;
  const section = root.querySelector('#ar2-conversation');
  if (!section || section.querySelector('[data-safe-shared-stage]')) return;
  const relevant = ['conversation_in_progress', 'manager_preparation', 'awaiting_employee_response', 'completed_locked'].includes(review.status);
  if (!relevant) return;

  const [{ data: summary, error: summaryError }, { data: goals, error: goalsError }] = await Promise.all([
    supabase.from('review_conversation_summary').select('*').eq('review_id', review.id).maybeSingle(),
    supabase.from('review_goals').select('*').eq('review_id', review.id).order('sort_order')
  ]);
  if (summaryError) throw summaryError;
  if (goalsError) throw goalsError;

  const editable = review.status === 'conversation_in_progress'
    && !review.employee_approved_at
    && !review.manager_approved_at
    && (isEmployee || isManager);
  const wrapper = document.createElement('div');
  wrapper.className = 'ar-safe-shared';
  wrapper.dataset.safeSharedStage = 'true';
  wrapper.innerHTML = `<div class="ar-safe-shared-grid" data-safe-shared-save-group data-review-id="${escapeHtml(review.id)}" data-version="${escapeHtml(String(summary?.version || ''))}">
      <label class="ar2-field"><span>סיכום מוסכם של השיחה</span><textarea class="ar2-textarea" rows="4" data-safe-field="agreed_summary" ${editable ? '' : 'readonly'}>${escapeHtml(summary?.agreed_summary || '')}</textarea></label>
      <label class="ar2-field"><span>פעולות המשך</span><textarea class="ar2-textarea" rows="3" data-safe-field="follow_up_actions" ${editable ? '' : 'readonly'}>${escapeHtml(summary?.follow_up_actions || '')}</textarea></label>
      <div class="ar-safe-save" data-safe-save aria-live="polite"></div>
    </div>
    <div class="ar2-question__title">יעדים מוסכמים</div>
    <div class="ar-safe-shared-grid">${(goals || []).map((goal) => goalHtml(goal, editable, review.id)).join('')}</div>
    <div class="ar-safe-actions ar2-no-print"></div>`;
  section.appendChild(wrapper);

  bindGroup(wrapper.querySelector('[data-safe-shared-save-group]'), saveSummary);
  wrapper.querySelectorAll('.ar-safe-goal[data-safe-shared-save-group]').forEach((group) => bindGroup(group, saveGoal));

  const actions = wrapper.querySelector('.ar-safe-actions');
  if (review.status === 'conversation_in_progress') {
    if (isEmployee && !review.employee_approved_at) {
      actions.insertAdjacentHTML('beforeend', '<button type="button" class="ar2-btn ar2-btn--primary" data-safe-shared-approve="employee">אישור העובד/ת לסיכום וליעדים</button>');
    }
    if (isManager && !review.manager_approved_at) {
      actions.insertAdjacentHTML('beforeend', '<button type="button" class="ar2-btn ar2-btn--primary" data-safe-shared-approve="manager">אישור המנהל/ת לסיכום וליעדים</button>');
    }
    const obsoleteFinish = root.querySelector('[data-ar2-operation="finish_review_conversation"]');
    if (obsoleteFinish) obsoleteFinish.hidden = true;
  }

  wrapper.querySelectorAll('[data-safe-shared-approve]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!window.confirm('לאשר את הסיכום והיעדים המשותפים? לאחר האישור לא ניתן יהיה לערוך אותם.')) return;
      button.dataset.busy = 'true';
      syncCoreSubmit(root);
      try {
        await flushAll(wrapper);
        const operation = button.dataset.safeSharedApprove === 'employee'
          ? 'approve_conversation_as_employee'
          : 'approve_conversation_as_manager';
        const { error } = await supabase.rpc(operation, {
          p_review_id: review.id,
          p_expected_version: review.version
        });
        if (error) throw error;
        window.location.reload();
      } catch (error) {
        button.dataset.busy = 'false';
        syncCoreSubmit(root);
        window.alert(error.message || 'אישור הסיכום והיעדים נכשל.');
      }
    });
  });

  const info = section.querySelector('.ar2-card__head .ar2-muted');
  if (info && review.status === 'conversation_in_progress') {
    info.textContent = editable
      ? 'מנסחים יחד סיכום, פעולות המשך ויעדים. המידע נשמר אוטומטית.'
      : 'הסיכום והיעדים הוגשו לאישור הצד השני.';
  }
  syncCoreSubmit(root);
});

installStyles();
