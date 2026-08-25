import { state } from './state.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

const MESSAGE_TABLE = 'staff_messages';
const ACK_TABLE = 'staff_message_acknowledgements';
const JERUSALEM_TIME_ZONE = 'Asia/Jerusalem';
const POLL_INTERVAL_MS = 15_000;
const CHECK_THROTTLE_MS = 10_000;
const POPUP_STYLE_ID = 'staff-message-popup-styles';

const IMPORTANCE_RANK = {
  normal: 1,
  important: 2,
  critical: 3
};

let checkPromise = null;
let lastSuccessfulCheckAt = 0;
let activePopup = false;

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

function isEligibleStaffUser(user = state?.user) {
  const role = normalize(user?.role || user?.display_role).toLowerCase();
  return Boolean(user?.user_id) && role !== 'instructor';
}

function messageTargetsUser(message, authUserId) {
  const audience = normalize(message?.audience) || 'all_non_instructors';
  if (audience === 'all_non_instructors') return true;
  if (audience !== 'selected_users') return false;
  const recipients = Array.isArray(message?.recipient_user_ids) ? message.recipient_user_ids : [];
  return recipients.some((id) => normalize(id) === normalize(authUserId));
}

function jerusalemNowParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JERUSALEM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    dateKey: `${values.year}-${values.month}-${values.day}`,
    timeKey: `${values.hour}:${values.minute}:${values.second}`
  };
}

function normalizeTime(value) {
  const match = normalize(value).match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return '00:00:00';
  return `${match[1]}:${match[2]}:${match[3] || '00'}`;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(normalize(value));
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function messageOccurrenceDates(message, nowParts) {
  const scheduleType = normalize(message?.schedule_type);
  const scheduledTime = normalizeTime(message?.scheduled_time);

  if (scheduleType === 'once') {
    const dateKey = normalize(message?.scheduled_date);
    if (!isIsoDate(dateKey)) return [];
    if (`${dateKey}T${scheduledTime}` > `${nowParts.dateKey}T${nowParts.timeKey}`) return [];
    return [dateKey];
  }

  if (scheduleType !== 'monthly') return [];
  const monthlyDay = Number(message?.monthly_day);
  const activeFrom = normalize(message?.active_from || normalize(message?.created_at).slice(0, 10));
  if (!Number.isInteger(monthlyDay) || monthlyDay < 1 || monthlyDay > 31 || !isIsoDate(activeFrom)) return [];

  const [startYear, startMonth] = activeFrom.split('-').map(Number);
  const result = [];
  let cursor = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const lastMonth = new Date(Date.UTC(nowParts.year, nowParts.month - 1, 1));

  while (cursor <= lastMonth) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const day = Math.min(monthlyDay, daysInMonth(year, month));
    const occurrenceDate = isoDate(year, month, day);
    if (
      occurrenceDate >= activeFrom
      && `${occurrenceDate}T${scheduledTime}` <= `${nowParts.dateKey}T${nowParts.timeKey}`
    ) {
      result.push(occurrenceDate);
    }
    cursor = new Date(Date.UTC(year, month, 1));
  }

  return result;
}

function pendingItemsFromMessages(messages, acknowledgements, nowParts) {
  const acknowledged = new Set((acknowledgements || []).map((row) => (
    `${normalize(row.message_id)}|${normalize(row.occurrence_date)}`
  )));

  const pending = [];
  for (const message of messages || []) {
    const scheduledTime = normalizeTime(message?.scheduled_time);
    for (const occurrenceDate of messageOccurrenceDates(message, nowParts)) {
      const key = `${normalize(message?.id)}|${occurrenceDate}`;
      if (acknowledged.has(key)) continue;
      pending.push({
        message,
        occurrenceDate,
        dueAt: `${occurrenceDate}T${scheduledTime}`
      });
    }
  }

  return pending.sort((a, b) => {
    const importanceDiff = (IMPORTANCE_RANK[normalize(b.message?.importance)] || 0)
      - (IMPORTANCE_RANK[normalize(a.message?.importance)] || 0);
    if (importanceDiff !== 0) return importanceDiff;
    const dueCompare = a.dueAt.localeCompare(b.dueAt);
    if (dueCompare !== 0) return dueCompare;
    return normalize(a.message?.created_at).localeCompare(normalize(b.message?.created_at));
  });
}

function authenticatedShellIsReady() {
  return Boolean(
    supabase
    && isEligibleStaffUser(state?.user)
    && state?.route !== 'login'
    && document.querySelector('.app-shell')
  );
}

function hasOtherBlockingPopup() {
  return Boolean(
    document.querySelector('.gefen-start-reminder-overlay')
    || document.querySelector('[data-birthday-popup-root]')
  );
}

function waitForOtherPopups() {
  if (!hasOtherBlockingPopup()) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setInterval(() => {
      if (!hasOtherBlockingPopup()) {
        window.clearInterval(timer);
        resolve();
      }
    }, 250);
  });
}

function ensurePopupStyles() {
  if (document.getElementById(POPUP_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = POPUP_STYLE_ID;
  style.textContent = `
    html.staff-message-popup-open,
    html.staff-message-popup-open body { overflow: hidden !important; }
    .staff-message-popup-overlay {
      position: fixed; inset: 0; z-index: 2147482800; display: flex;
      align-items: center; justify-content: center; padding: 24px;
      background: rgba(15, 23, 42, .62); backdrop-filter: blur(2px);
    }
    .staff-message-popup-card {
      width: min(560px, 100%); max-height: calc(100vh - 48px); overflow: auto;
      border: 1px solid #dbe3ec; border-top: 5px solid #64748b; border-radius: 14px;
      background: #fff; color: #172033; box-shadow: 0 24px 70px rgba(15,23,42,.30);
      direction: rtl; text-align: right; font-family: inherit;
    }
    .staff-message-popup-card[data-importance="important"] { border-top-color: #d97706; }
    .staff-message-popup-card[data-importance="critical"] { border-top-color: #c62828; }
    .staff-message-popup-head { padding: 22px 24px 14px; border-bottom: 1px solid #e7ecf2; }
    .staff-message-popup-title { margin: 0; font-size: 21px; line-height: 1.35; font-weight: 850; color: #172033; }
    .staff-message-popup-body { padding: 20px 24px 24px; }
    .staff-message-popup-text { margin: 0 0 22px; color: #334155; font-size: 16px; line-height: 1.75; font-weight: 550; white-space: pre-wrap; overflow-wrap: anywhere; }
    .staff-message-popup-confirm { width: auto; min-width: 96px; min-height: 38px; padding: 0 24px; display: block; margin: 0 auto; border: 0; border-radius: 9px; background: #1e4f8f; color: #fff; font: inherit; font-size: 15px; font-weight: 800; cursor: pointer; }
    .staff-message-popup-confirm:hover:not(:disabled) { background: #173f74; }
    .staff-message-popup-confirm:disabled { cursor: wait; opacity: .72; }
    .staff-message-popup-error { min-height: 18px; margin: 10px 0 0; color: #b42318; font-size: 13px; font-weight: 700; }
    @media (max-width: 620px) {
      .staff-message-popup-overlay { padding: 14px; align-items: flex-start; overflow-y: auto; }
      .staff-message-popup-card { margin-top: 8vh; }
      .staff-message-popup-head { padding: 18px 18px 12px; }
      .staff-message-popup-body { padding: 16px 18px 20px; }
    }
  `;
  document.head.appendChild(style);
}

async function saveAcknowledgement(item, authUserId) {
  const payload = {
    message_id: item.message.id,
    user_id: authUserId,
    occurrence_date: item.occurrenceDate,
    acknowledged_at: new Date().toISOString()
  };
  const { error } = await supabase
    .from(ACK_TABLE)
    .upsert(payload, {
      onConflict: 'message_id,user_id,occurrence_date',
      ignoreDuplicates: true
    });
  if (error && String(error.code || '') !== '23505') throw error;
}

function showMessagePopup(item, authUserId) {
  return new Promise((resolve) => {
    ensurePopupStyles();
    activePopup = true;
    document.documentElement.classList.add('staff-message-popup-open');

    const overlay = document.createElement('div');
    overlay.className = 'staff-message-popup-overlay';
    overlay.dataset.staffMessagePopup = 'true';
    overlay.dataset.staffMessageId = normalize(item.message?.id);
    overlay.innerHTML = `
      <section class="staff-message-popup-card" data-importance="${escapeHtml(normalize(item.message?.importance) || 'normal')}" role="dialog" aria-modal="true" aria-labelledby="staffMessagePopupTitle">
        <header class="staff-message-popup-head">
          <h2 class="staff-message-popup-title" id="staffMessagePopupTitle">${escapeHtml(item.message?.title)}</h2>
        </header>
        <div class="staff-message-popup-body">
          <p class="staff-message-popup-text">${escapeHtml(item.message?.body)}</p>
          <button class="staff-message-popup-confirm" type="button">אישור</button>
          <p class="staff-message-popup-error" role="alert" aria-live="assertive"></p>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);

    const button = overlay.querySelector('.staff-message-popup-confirm');
    const errorBox = overlay.querySelector('.staff-message-popup-error');

    const keepFocusInside = (event) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        button?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', keepFocusInside, true);

    const close = () => {
      document.removeEventListener('keydown', keepFocusInside, true);
      overlay.remove();
      document.documentElement.classList.remove('staff-message-popup-open');
      activePopup = false;
      resolve();
    };

    button?.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = 'שומר…';
      errorBox.textContent = '';
      try {
        await saveAcknowledgement(item, authUserId);
        close();
      } catch (error) {
        console.warn('[staff-messages] acknowledgement failed', error);
        errorBox.textContent = 'לא ניתן היה לשמור את האישור. יש לנסות שוב.';
        button.disabled = false;
        button.textContent = 'אישור';
        button.focus({ preventScroll: true });
      }
    });

    requestAnimationFrame(() => button?.focus({ preventScroll: true }));
  });
}

async function loadPendingMessages(authUserId) {
  const { data: rows, error: messagesError } = await supabase
    .from(MESSAGE_TABLE)
    .select('id,title,body,schedule_type,scheduled_date,monthly_day,scheduled_time,importance,audience,recipient_user_ids,active_from,is_active,created_at')
    .eq('is_active', true);
  if (messagesError) throw messagesError;

  const messages = (rows || []).filter((message) => messageTargetsUser(message, authUserId));
  if (!messages.length) return [];

  const messageIds = messages.map((message) => message.id).filter(Boolean);
  const { data: acknowledgements, error: ackError } = await supabase
    .from(ACK_TABLE)
    .select('message_id,occurrence_date')
    .eq('user_id', authUserId)
    .in('message_id', messageIds);
  if (ackError) throw ackError;

  return pendingItemsFromMessages(messages, acknowledgements || [], jerusalemNowParts());
}

async function checkStaffMessages() {
  if (checkPromise || activePopup || !authenticatedShellIsReady()) return checkPromise;
  if ((Date.now() - lastSuccessfulCheckAt) < CHECK_THROTTLE_MS) return null;

  checkPromise = (async () => {
    const session = await waitForSupabaseAuthSession({ timeoutMs: 8000 });
    const authUserId = normalize(session?.user?.id);
    if (!authUserId || !authenticatedShellIsReady()) return;

    const pending = await loadPendingMessages(authUserId);
    lastSuccessfulCheckAt = Date.now();

    for (const item of pending) {
      if (!authenticatedShellIsReady()) break;
      await waitForOtherPopups();
      if (!authenticatedShellIsReady()) break;
      await showMessagePopup(item, authUserId);
    }
  })()
    .catch((error) => {
      console.warn('[staff-messages] check failed', error);
    })
    .finally(() => {
      checkPromise = null;
    });

  return checkPromise;
}

function scheduleCheck() {
  window.setTimeout(() => checkStaffMessages().catch(() => {}), 500);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleCheck, { once: true });
  } else {
    scheduleCheck();
  }
  window.setInterval(() => checkStaffMessages().catch(() => {}), POLL_INTERVAL_MS);
  window.addEventListener('focus', scheduleCheck);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleCheck();
  });
  document.addEventListener('app:navigate', scheduleCheck);
}

export {
  IMPORTANCE_RANK,
  isEligibleStaffUser,
  jerusalemNowParts,
  messageOccurrenceDates,
  messageTargetsUser,
  pendingItemsFromMessages
};