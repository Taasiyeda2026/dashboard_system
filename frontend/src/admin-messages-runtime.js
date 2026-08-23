import { state } from './state.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

const MESSAGE_TABLE = 'staff_messages';
const PROFILE_TABLE = 'profiles';
const ROOT_ID = 'admin-staff-messages-root';
const STYLE_ID = 'admin-staff-messages-styles';
const JERUSALEM_TIME_ZONE = 'Asia/Jerusalem';

let messages = [];
let recipientOptions = [];
let activeEditId = '';
let loading = false;

function normalize(value) {
  return String(value ?? '').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isAdmin() {
  return normalize(state?.user?.role || state?.user?.display_role).toLowerCase() === 'admin';
}

function todayInJerusalem() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JERUSALEM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    html.admin-staff-messages-open,
    html.admin-staff-messages-open body { overflow: hidden !important; }
    .admin-staff-messages-root {
      position: fixed; inset: 0; z-index: 2147482500; overflow: auto;
      background: #f5f7fa; color: #172033; direction: rtl; font-family: inherit;
    }
    .admin-staff-messages-shell { width: min(1120px, calc(100% - 40px)); margin: 0 auto; padding: 28px 0 44px; }
    .admin-staff-messages-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    .admin-staff-messages-head h1 { margin: 0; font-size: 26px; line-height: 1.25; font-weight: 850; }
    .admin-staff-messages-head p { margin: 6px 0 0; color: #64748b; font-size: 14px; }
    .admin-staff-messages-actions { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
    .admin-staff-messages-btn {
      appearance: none; min-height: 40px; padding: 0 15px; border: 1px solid #cfd8e3;
      border-radius: 9px; background: #fff; color: #25344b; font: inherit;
      font-size: 14px; font-weight: 750; cursor: pointer;
    }
    .admin-staff-messages-btn:hover { border-color: #94a3b8; background: #f8fafc; }
    .admin-staff-messages-btn--primary { border-color: #1e4f8f; background: #1e4f8f; color: #fff; }
    .admin-staff-messages-btn--primary:hover { background: #173f74; border-color: #173f74; }
    .admin-staff-messages-btn:disabled { cursor: wait; opacity: .6; }
    .admin-staff-messages-panel { overflow: hidden; border: 1px solid #dbe3ec; border-radius: 14px; background: #fff; box-shadow: 0 2px 10px rgba(15,23,42,.05); }
    .admin-staff-messages-table-wrap { overflow-x: auto; }
    .admin-staff-messages-table { width: 100%; min-width: 900px; border-collapse: collapse; font-size: 13.5px; }
    .admin-staff-messages-table th,
    .admin-staff-messages-table td { padding: 12px 14px; border-bottom: 1px solid #e8edf2; text-align: right; vertical-align: middle; }
    .admin-staff-messages-table th { background: #f8fafc; color: #64748b; font-size: 12px; font-weight: 800; white-space: nowrap; }
    .admin-staff-messages-table tbody tr:last-child td { border-bottom: 0; }
    .admin-staff-messages-table__title { max-width: 320px; font-weight: 800; overflow-wrap: anywhere; }
    .admin-staff-messages-table__schedule { color: #475569; white-space: nowrap; }
    .admin-staff-messages-table__actions { white-space: nowrap; }
    .admin-staff-messages-link-btn { appearance: none; border: 0; background: transparent; color: #1e4f8f; font: inherit; font-size: 13px; font-weight: 750; cursor: pointer; padding: 4px 6px; }
    .admin-staff-messages-link-btn.is-danger { color: #b42318; }
    .admin-staff-messages-badge { display: inline-flex; align-items: center; min-height: 25px; padding: 0 9px; border-radius: 999px; background: #eef2f7; color: #475569; font-size: 12px; font-weight: 800; white-space: nowrap; }
    .admin-staff-messages-badge--important { background: #fff4df; color: #9a5800; }
    .admin-staff-messages-badge--critical { background: #fff0ef; color: #b42318; }
    .admin-staff-messages-badge--inactive { background: #f1f5f9; color: #94a3b8; }
    .admin-staff-messages-empty { padding: 54px 24px; text-align: center; color: #64748b; }
    .admin-staff-messages-loading { padding: 36px 24px; text-align: center; color: #64748b; }
    .admin-staff-messages-form-overlay { position: fixed; inset: 0; z-index: 2147482600; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(15,23,42,.55); }
    .admin-staff-messages-form { width: min(650px, 100%); max-height: calc(100vh - 40px); overflow: auto; border-radius: 14px; background: #fff; box-shadow: 0 24px 70px rgba(15,23,42,.30); border: 1px solid #dbe3ec; }
    .admin-staff-messages-form__head { padding: 20px 22px 14px; border-bottom: 1px solid #e7ecf2; }
    .admin-staff-messages-form__head h2 { margin: 0; font-size: 20px; font-weight: 850; }
    .admin-staff-messages-form__body { padding: 18px 22px 22px; }
    .admin-staff-messages-field { display: grid; gap: 7px; margin-bottom: 14px; }
    .admin-staff-messages-field label { color: #334155; font-size: 13px; font-weight: 800; }
    .admin-staff-messages-input,
    .admin-staff-messages-select,
    .admin-staff-messages-textarea { width: 100%; box-sizing: border-box; border: 1px solid #cfd8e3; border-radius: 9px; background: #fff; color: #172033; font: inherit; font-size: 14px; padding: 10px 11px; outline: none; }
    .admin-staff-messages-input:focus,
    .admin-staff-messages-select:focus,
    .admin-staff-messages-textarea:focus { border-color: #1e4f8f; box-shadow: 0 0 0 3px rgba(30,79,143,.10); }
    .admin-staff-messages-textarea { min-height: 120px; resize: vertical; line-height: 1.55; }
    .admin-staff-messages-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .admin-staff-messages-recipient-list { max-height: 210px; overflow: auto; border: 1px solid #dbe3ec; border-radius: 9px; background: #f8fafc; padding: 7px; }
    .admin-staff-messages-recipient { display: flex; align-items: center; gap: 9px; min-height: 38px; padding: 5px 7px; border-radius: 7px; cursor: pointer; }
    .admin-staff-messages-recipient:hover { background: #eef3f8; }
    .admin-staff-messages-recipient input { width: 16px; height: 16px; margin: 0; flex: 0 0 auto; }
    .admin-staff-messages-recipient strong { font-size: 13px; font-weight: 800; }
    .admin-staff-messages-recipient small { display: block; margin-top: 2px; color: #64748b; font-size: 11.5px; }
    .admin-staff-messages-recipient-summary { margin: -5px 0 12px; color: #64748b; font-size: 12px; }
    .admin-staff-messages-form__actions { display: flex; gap: 9px; justify-content: flex-start; }
    .admin-staff-messages-error { min-height: 19px; margin: 10px 0 0; color: #b42318; font-size: 13px; font-weight: 700; }
    @media (max-width: 680px) {
      .admin-staff-messages-shell { width: min(100% - 24px, 1120px); padding-top: 18px; }
      .admin-staff-messages-head { align-items: flex-start; flex-direction: column; }
      .admin-staff-messages-grid2 { grid-template-columns: 1fr; gap: 0; }
      .admin-staff-messages-form-overlay { padding: 10px; align-items: flex-start; }
      .admin-staff-messages-form { margin-top: 3vh; max-height: 94vh; }
    }
  `;
  document.head.appendChild(style);
}

function importanceLabel(value) {
  if (value === 'critical') return 'קריטית';
  if (value === 'important') return 'חשובה';
  return 'רגילה';
}

function importanceBadge(value) {
  const normalized = normalize(value) || 'normal';
  const modifier = normalized === 'critical'
    ? ' admin-staff-messages-badge--critical'
    : normalized === 'important'
      ? ' admin-staff-messages-badge--important'
      : '';
  return `<span class="admin-staff-messages-badge${modifier}">${importanceLabel(normalized)}</span>`;
}

function scheduleLabel(message) {
  const time = normalize(message?.scheduled_time).slice(0, 5) || '00:00';
  if (message?.schedule_type === 'monthly') return `בכל חודש, ביום ${Number(message.monthly_day)} בשעה ${time}`;
  return `${normalize(message?.scheduled_date) || '—'} בשעה ${time}`;
}

function audienceLabel(message) {
  if (message?.audience !== 'selected_users') return 'כל העובדים ללא מדריכים';
  const count = Array.isArray(message?.recipient_user_ids) ? message.recipient_user_ids.length : 0;
  return count === 1 ? 'עובד אחד' : `${count} עובדים`;
}

function statusBadge(message) {
  if (!message?.is_active) return '<span class="admin-staff-messages-badge admin-staff-messages-badge--inactive">מבוטלת</span>';
  if (message?.schedule_type === 'monthly') return '<span class="admin-staff-messages-badge">פעילה · חודשית</span>';
  const dateTime = `${normalize(message?.scheduled_date)}T${normalize(message?.scheduled_time).slice(0, 8) || '00:00:00'}`;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JERUSALEM_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const current = `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
  return dateTime > current
    ? '<span class="admin-staff-messages-badge">עתידית</span>'
    : '<span class="admin-staff-messages-badge">פעילה</span>';
}

function rowsHtml() {
  if (loading) return '<div class="admin-staff-messages-loading">טוען הודעות…</div>';
  if (!messages.length) return '<div class="admin-staff-messages-empty">עדיין לא נוצרו הודעות. לחצו על „הודעה חדשה” כדי להתחיל.</div>';

  const rows = messages.map((message) => `
    <tr>
      <td class="admin-staff-messages-table__title">${escapeHtml(message.title)}</td>
      <td class="admin-staff-messages-table__schedule">${escapeHtml(scheduleLabel(message))}</td>
      <td>${escapeHtml(audienceLabel(message))}</td>
      <td>${importanceBadge(message.importance)}</td>
      <td>${statusBadge(message)}</td>
      <td class="admin-staff-messages-table__actions">
        <button type="button" class="admin-staff-messages-link-btn" data-message-edit="${escapeHtml(message.id)}">עריכה</button>
        <button type="button" class="admin-staff-messages-link-btn" data-message-toggle="${escapeHtml(message.id)}">${message.is_active ? 'ביטול' : 'הפעלה'}</button>
        <button type="button" class="admin-staff-messages-link-btn is-danger" data-message-delete="${escapeHtml(message.id)}">מחיקה</button>
      </td>
    </tr>
  `).join('');

  return `
    <div class="admin-staff-messages-table-wrap">
      <table class="admin-staff-messages-table">
        <thead><tr><th>הודעה</th><th>מועד</th><th>קהל</th><th>חשיבות</th><th>סטטוס</th><th>פעולות</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderManager() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  root.innerHTML = `
    <div class="admin-staff-messages-shell">
      <header class="admin-staff-messages-head">
        <div>
          <h1>הודעות</h1>
          <p>יצירה ותזמון של הודעות לעובדים. העובד רואה את ההודעה ולוחץ אישור בלבד.</p>
        </div>
        <div class="admin-staff-messages-actions">
          <button type="button" class="admin-staff-messages-btn admin-staff-messages-btn--primary" data-message-new>הודעה חדשה</button>
          <button type="button" class="admin-staff-messages-btn" data-message-close>חזרה לניהול</button>
        </div>
      </header>
      <section class="admin-staff-messages-panel" aria-label="רשימת הודעות">${rowsHtml()}</section>
    </div>
  `;
  bindManagerActions(root);
}

function recipientListHtml(selectedIds = []) {
  const selected = new Set((selectedIds || []).map(normalize).filter(Boolean));
  if (!recipientOptions.length) return '<div class="admin-staff-messages-empty">לא נמצאו עובדים פעילים לבחירה.</div>';
  return recipientOptions.map((profile) => {
    const id = normalize(profile.id);
    const name = normalize(profile.full_name) || normalize(profile.email) || 'עובד';
    const email = normalize(profile.email);
    return `
      <label class="admin-staff-messages-recipient">
        <input type="checkbox" name="recipient_user_ids" value="${escapeHtml(id)}" ${selected.has(id) ? 'checked' : ''} />
        <span><strong>${escapeHtml(name)}</strong>${email ? `<small>${escapeHtml(email)}</small>` : ''}</span>
      </label>
    `;
  }).join('');
}

function formHtml(message = null) {
  const editing = Boolean(message?.id);
  const type = normalize(message?.schedule_type) || 'once';
  const importance = normalize(message?.importance) || 'normal';
  const audience = normalize(message?.audience) || 'all_non_instructors';
  const date = normalize(message?.scheduled_date) || todayInJerusalem();
  const monthlyDay = Number(message?.monthly_day || 25);
  const time = normalize(message?.scheduled_time).slice(0, 5) || '09:00';
  const selectedIds = Array.isArray(message?.recipient_user_ids) ? message.recipient_user_ids : [];

  return `
    <div class="admin-staff-messages-form-overlay" data-message-form-overlay>
      <form class="admin-staff-messages-form" data-message-form>
        <header class="admin-staff-messages-form__head"><h2>${editing ? 'עריכת הודעה' : 'הודעה חדשה'}</h2></header>
        <div class="admin-staff-messages-form__body">
          <div class="admin-staff-messages-field">
            <label for="staffMessageTitle">כותרת</label>
            <input id="staffMessageTitle" class="admin-staff-messages-input" name="title" maxlength="120" required value="${escapeHtml(message?.title || '')}" />
          </div>
          <div class="admin-staff-messages-field">
            <label for="staffMessageBody">תוכן ההודעה</label>
            <textarea id="staffMessageBody" class="admin-staff-messages-textarea" name="body" maxlength="3000" required>${escapeHtml(message?.body || '')}</textarea>
          </div>
          <div class="admin-staff-messages-grid2">
            <div class="admin-staff-messages-field">
              <label for="staffMessageScheduleType">מתי להציג</label>
              <select id="staffMessageScheduleType" class="admin-staff-messages-select" name="schedule_type">
                <option value="once" ${type === 'once' ? 'selected' : ''}>חד־פעמית</option>
                <option value="monthly" ${type === 'monthly' ? 'selected' : ''}>כל חודש</option>
              </select>
            </div>
            <div class="admin-staff-messages-field">
              <label for="staffMessageTime">שעה</label>
              <input id="staffMessageTime" class="admin-staff-messages-input" type="time" name="scheduled_time" required value="${escapeHtml(time)}" />
            </div>
          </div>
          <div data-once-fields ${type === 'once' ? '' : 'hidden'}>
            <div class="admin-staff-messages-field">
              <label for="staffMessageDate">תאריך</label>
              <input id="staffMessageDate" class="admin-staff-messages-input" type="date" name="scheduled_date" value="${escapeHtml(date)}" />
            </div>
          </div>
          <div data-monthly-fields ${type === 'monthly' ? '' : 'hidden'}>
            <div class="admin-staff-messages-field">
              <label for="staffMessageMonthlyDay">יום בחודש</label>
              <input id="staffMessageMonthlyDay" class="admin-staff-messages-input" type="number" min="1" max="31" name="monthly_day" value="${monthlyDay}" />
            </div>
          </div>
          <div class="admin-staff-messages-grid2">
            <div class="admin-staff-messages-field">
              <label for="staffMessageImportance">חשיבות</label>
              <select id="staffMessageImportance" class="admin-staff-messages-select" name="importance">
                <option value="normal" ${importance === 'normal' ? 'selected' : ''}>רגילה</option>
                <option value="important" ${importance === 'important' ? 'selected' : ''}>חשובה</option>
                <option value="critical" ${importance === 'critical' ? 'selected' : ''}>קריטית</option>
              </select>
            </div>
            <div class="admin-staff-messages-field">
              <label for="staffMessageAudience">קהל יעד</label>
              <select id="staffMessageAudience" class="admin-staff-messages-select" name="audience">
                <option value="all_non_instructors" ${audience === 'all_non_instructors' ? 'selected' : ''}>כל העובדים ללא מדריכים</option>
                <option value="selected_users" ${audience === 'selected_users' ? 'selected' : ''}>בחירת עובדים</option>
              </select>
            </div>
          </div>
          <div data-recipient-fields ${audience === 'selected_users' ? '' : 'hidden'}>
            <div class="admin-staff-messages-field">
              <label>בחירת עובדים</label>
              <div class="admin-staff-messages-recipient-list">${recipientListHtml(selectedIds)}</div>
            </div>
            <div class="admin-staff-messages-recipient-summary" data-recipient-summary></div>
          </div>
          <div class="admin-staff-messages-form__actions">
            <button type="submit" class="admin-staff-messages-btn admin-staff-messages-btn--primary">שמור</button>
            <button type="button" class="admin-staff-messages-btn" data-message-form-cancel>ביטול</button>
          </div>
          <p class="admin-staff-messages-error" data-message-form-error role="alert"></p>
        </div>
      </form>
    </div>
  `;
}

function closeForm() {
  document.querySelector('[data-message-form-overlay]')?.remove();
  activeEditId = '';
}

function openForm(message = null) {
  activeEditId = normalize(message?.id);
  document.body.insertAdjacentHTML('beforeend', formHtml(message));
  const overlay = document.querySelector('[data-message-form-overlay]');
  const form = overlay?.querySelector('[data-message-form]');
  const typeSelect = form?.elements?.schedule_type;
  const audienceSelect = form?.elements?.audience;
  const onceFields = form?.querySelector('[data-once-fields]');
  const monthlyFields = form?.querySelector('[data-monthly-fields]');
  const recipientFields = form?.querySelector('[data-recipient-fields]');
  const recipientSummary = form?.querySelector('[data-recipient-summary]');

  const syncScheduleFields = () => {
    const monthly = typeSelect?.value === 'monthly';
    if (onceFields) onceFields.hidden = monthly;
    if (monthlyFields) monthlyFields.hidden = !monthly;
  };
  const syncAudienceFields = () => {
    const selectedUsers = audienceSelect?.value === 'selected_users';
    if (recipientFields) recipientFields.hidden = !selectedUsers;
  };
  const syncRecipientSummary = () => {
    if (!recipientSummary) return;
    const count = form?.querySelectorAll('input[name="recipient_user_ids"]:checked').length || 0;
    recipientSummary.textContent = count ? `נבחרו ${count} עובדים` : 'לא נבחרו עובדים';
  };

  typeSelect?.addEventListener('change', syncScheduleFields);
  audienceSelect?.addEventListener('change', syncAudienceFields);
  form?.querySelectorAll('input[name="recipient_user_ids"]').forEach((input) => input.addEventListener('change', syncRecipientSummary));
  syncScheduleFields();
  syncAudienceFields();
  syncRecipientSummary();

  overlay?.querySelector('[data-message-form-cancel]')?.addEventListener('click', closeForm);
  form?.addEventListener('submit', saveForm);
  requestAnimationFrame(() => form?.elements?.title?.focus());
}

async function saveForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const errorBox = form.querySelector('[data-message-form-error]');
  const values = new FormData(form);
  const scheduleType = normalize(values.get('schedule_type'));
  const scheduledDate = normalize(values.get('scheduled_date'));
  const monthlyDay = Number(values.get('monthly_day'));
  const scheduledTime = normalize(values.get('scheduled_time'));
  const title = normalize(values.get('title'));
  const body = normalize(values.get('body'));
  const importance = normalize(values.get('importance'));
  const audience = normalize(values.get('audience')) || 'all_non_instructors';
  const recipientUserIds = [...new Set(values.getAll('recipient_user_ids').map(normalize).filter(Boolean))];

  if (!title || !body || !scheduledTime) {
    errorBox.textContent = 'יש להשלים כותרת, תוכן ושעה.';
    return;
  }
  if (scheduleType === 'once' && !scheduledDate) {
    errorBox.textContent = 'יש לבחור תאריך להודעה החד־פעמית.';
    return;
  }
  if (scheduleType === 'monthly' && (!Number.isInteger(monthlyDay) || monthlyDay < 1 || monthlyDay > 31)) {
    errorBox.textContent = 'יש לבחור יום בחודש בין 1 ל־31.';
    return;
  }
  if (audience === 'selected_users' && !recipientUserIds.length) {
    errorBox.textContent = 'יש לבחור לפחות עובד אחד.';
    return;
  }

  submit.disabled = true;
  submit.textContent = 'שומר…';
  errorBox.textContent = '';

  const existing = messages.find((item) => normalize(item.id) === activeEditId);
  const payload = {
    title,
    body,
    schedule_type: scheduleType,
    scheduled_date: scheduleType === 'once' ? scheduledDate : null,
    monthly_day: scheduleType === 'monthly' ? monthlyDay : null,
    scheduled_time: scheduledTime,
    importance,
    audience,
    recipient_user_ids: audience === 'selected_users' ? recipientUserIds : [],
    active_from: existing?.active_from || todayInJerusalem(),
    updated_at: new Date().toISOString()
  };

  try {
    if (activeEditId) {
      const { error } = await supabase.from(MESSAGE_TABLE).update(payload).eq('id', activeEditId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from(MESSAGE_TABLE).insert(payload);
      if (error) throw error;
    }
    closeForm();
    await loadMessages();
  } catch (error) {
    console.warn('[admin-staff-messages] save failed', error);
    errorBox.textContent = 'שמירת ההודעה נכשלה. נסו שוב.';
    submit.disabled = false;
    submit.textContent = 'שמור';
  }
}

async function toggleMessage(id) {
  const message = messages.find((item) => normalize(item.id) === normalize(id));
  if (!message) return;
  const { error } = await supabase
    .from(MESSAGE_TABLE)
    .update({ is_active: !message.is_active, updated_at: new Date().toISOString() })
    .eq('id', message.id);
  if (error) throw error;
  await loadMessages();
}

async function deleteMessage(id) {
  const message = messages.find((item) => normalize(item.id) === normalize(id));
  if (!message) return false;
  if (!window.confirm(`למחוק את ההודעה „${message.title}”?`)) return false;
  const { error } = await supabase.from(MESSAGE_TABLE).delete().eq('id', message.id);
  if (error) throw error;
  await loadMessages();
  return true;
}

function bindManagerActions(root) {
  root.querySelector('[data-message-close]')?.addEventListener('click', closeAdminMessagesManager);
  root.querySelector('[data-message-new]')?.addEventListener('click', () => openForm());
  root.querySelectorAll('[data-message-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const message = messages.find((item) => normalize(item.id) === normalize(button.dataset.messageEdit));
      if (message) openForm(message);
    });
  });
  root.querySelectorAll('[data-message-toggle]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await toggleMessage(button.dataset.messageToggle); }
      catch (error) {
        console.warn('[admin-staff-messages] toggle failed', error);
        window.alert('לא ניתן היה לעדכן את ההודעה.');
        button.disabled = false;
      }
    });
  });
  root.querySelectorAll('[data-message-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const deleted = await deleteMessage(button.dataset.messageDelete);
        if (!deleted) button.disabled = false;
      } catch (error) {
        console.warn('[admin-staff-messages] delete failed', error);
        window.alert('לא ניתן היה למחוק את ההודעה.');
        button.disabled = false;
      }
    });
  });
}

async function loadRecipientOptions() {
  const { data, error } = await supabase
    .from(PROFILE_TABLE)
    .select('id,full_name,email,role,is_active')
    .eq('is_active', true)
    .neq('role', 'instructor')
    .order('full_name', { ascending: true });
  if (error) throw error;
  recipientOptions = (data || []).filter((profile) => normalize(profile.id));
}

async function loadMessages() {
  loading = true;
  renderManager();
  const { data, error } = await supabase
    .from(MESSAGE_TABLE)
    .select('id,title,body,schedule_type,scheduled_date,monthly_day,scheduled_time,importance,audience,recipient_user_ids,active_from,is_active,created_by,created_at,updated_at')
    .order('created_at', { ascending: false });
  if (error) {
    loading = false;
    renderManager();
    throw error;
  }
  messages = data || [];
  loading = false;
  renderManager();
}

function closeAdminMessagesManager() {
  closeForm();
  document.getElementById(ROOT_ID)?.remove();
  document.documentElement.classList.remove('admin-staff-messages-open');
}

async function openAdminMessagesManager() {
  if (!isAdmin()) return;
  await waitForSupabaseAuthSession({ timeoutMs: 8000 });
  if (!isAdmin() || !supabase) return;

  ensureStyles();
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'admin-staff-messages-root';
    root.setAttribute('dir', 'rtl');
    document.body.appendChild(root);
  }
  document.documentElement.classList.add('admin-staff-messages-open');
  messages = [];
  recipientOptions = [];
  loading = true;
  renderManager();
  try {
    await Promise.all([loadRecipientOptions(), loadMessages()]);
  } catch (error) {
    console.warn('[admin-staff-messages] load failed', error);
    const panel = root.querySelector('.admin-staff-messages-panel');
    if (panel) panel.innerHTML = '<div class="admin-staff-messages-empty">לא ניתן היה לטעון את ההודעות. נסו שוב.</div>';
  }
}

export { closeAdminMessagesManager, openAdminMessagesManager };
