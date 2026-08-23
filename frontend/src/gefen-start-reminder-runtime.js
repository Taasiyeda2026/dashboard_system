import { state } from './state.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

const REMINDER_TABLE = 'gefen_start_reminder_acknowledgements';
const REMINDER_YEAR = 2027;
const REMINDER_LEAD_DAYS = 10;
const CHECK_THROTTLE_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 30 * 1000;
const JERUSALEM_TIME_ZONE = 'Asia/Jerusalem';

let checkPromise = null;
let lastSuccessfulCheck = { authUserId: '', dateKey: '', at: 0 };

function normalizeFunding(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isEligibleReminderUser(user = state?.user) {
  const role = String(user?.role || '').trim().toLowerCase();
  return Boolean(user?.user_id) && role !== 'instructor';
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function dateOrdinal(isoDate) {
  if (!isIsoDate(isoDate)) return Number.NaN;
  const [year, month, day] = isoDate.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function todayInJerusalem() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: JERUSALEM_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (values.year && values.month && values.day) {
      return `${values.year}-${values.month}-${values.day}`;
    }
  } catch {
    // Fall through to the browser-local date only if Intl timezone resolution fails.
  }
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function firstActivityDate(activity) {
  const dates = [activity?.start_date, activity?.date_1]
    .map((value) => String(value || '').trim())
    .filter(isIsoDate)
    .sort();
  return dates[0] || '';
}

function isReminderDue(startDate, today) {
  if (!isIsoDate(startDate) || !isIsoDate(today)) return false;
  if (!startDate.startsWith(`${REMINDER_YEAR}-`)) return false;
  const daysUntilStart = dateOrdinal(startDate) - dateOrdinal(today);
  return daysUntilStart >= 0 && daysUntilStart <= REMINDER_LEAD_DAYS;
}

function formatHebrewDate(isoDate) {
  if (!isIsoDate(isoDate)) return isoDate || '—';
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: JERUSALEM_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function ensureReminderStyles() {
  if (document.getElementById('gefen-start-reminder-styles')) return;
  const style = document.createElement('style');
  style.id = 'gefen-start-reminder-styles';
  style.textContent = `
    html.gefen-start-reminder-open,
    html.gefen-start-reminder-open body { overflow: hidden !important; }
    .gefen-start-reminder-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(15, 23, 42, 0.64);
      backdrop-filter: blur(2px);
    }
    .gefen-start-reminder-dialog {
      width: min(560px, 100%);
      overflow: hidden;
      border: 1px solid #d9e1ea;
      border-top: 6px solid #c62828;
      border-radius: 14px;
      background: #ffffff;
      color: #172033;
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.30);
      direction: rtl;
      text-align: right;
      font-family: inherit;
    }
    .gefen-start-reminder-head {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 22px 24px 14px;
      border-bottom: 1px solid #e6ebf1;
    }
    .gefen-start-reminder-icon {
      flex: 0 0 36px;
      width: 36px;
      height: 36px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: #fff1f1;
      color: #b42318;
      font-size: 20px;
      font-weight: 900;
      line-height: 1;
    }
    .gefen-start-reminder-title {
      margin: 0;
      font-size: 21px;
      line-height: 1.35;
      font-weight: 800;
      color: #172033;
    }
    .gefen-start-reminder-subtitle {
      margin: 5px 0 0;
      color: #5a6679;
      font-size: 14px;
      line-height: 1.5;
    }
    .gefen-start-reminder-body { padding: 20px 24px 24px; }
    .gefen-start-reminder-details {
      margin: 0 0 20px;
      border: 1px solid #e1e7ee;
      border-radius: 10px;
      overflow: hidden;
      background: #fbfcfe;
    }
    .gefen-start-reminder-row {
      display: grid;
      grid-template-columns: 118px minmax(0, 1fr);
      gap: 12px;
      padding: 10px 14px;
      border-bottom: 1px solid #e7ecf2;
      font-size: 14px;
      line-height: 1.5;
    }
    .gefen-start-reminder-row:last-child { border-bottom: 0; }
    .gefen-start-reminder-row dt { color: #687386; font-weight: 700; }
    .gefen-start-reminder-row dd { margin: 0; color: #172033; font-weight: 700; overflow-wrap: anywhere; }
    .gefen-start-reminder-question {
      margin: 0 0 18px;
      padding: 14px 0;
      border-top: 1px solid #edf0f4;
      border-bottom: 1px solid #edf0f4;
      color: #172033;
      font-size: 17px;
      line-height: 1.65;
      font-weight: 800;
    }
    .gefen-start-reminder-action {
      width: 100%;
      min-height: 46px;
      border: 0;
      border-radius: 9px;
      background: #1e4f8f;
      color: #ffffff;
      font: inherit;
      font-size: 15px;
      font-weight: 800;
      cursor: pointer;
      transition: background .15s ease, transform .15s ease;
    }
    .gefen-start-reminder-action:hover:not(:disabled) { background: #173f74; }
    .gefen-start-reminder-action:active:not(:disabled) { transform: translateY(1px); }
    .gefen-start-reminder-action:focus-visible { outline: 3px solid rgba(30, 79, 143, .28); outline-offset: 2px; }
    .gefen-start-reminder-action:disabled { cursor: wait; opacity: .70; }
    .gefen-start-reminder-error {
      min-height: 20px;
      margin: 10px 0 0;
      color: #b42318;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.5;
    }
    @media (max-width: 620px) {
      .gefen-start-reminder-overlay { padding: 14px; align-items: flex-start; overflow-y: auto; }
      .gefen-start-reminder-dialog { margin-top: 7vh; }
      .gefen-start-reminder-head { padding: 18px 18px 12px; }
      .gefen-start-reminder-body { padding: 16px 18px 20px; }
      .gefen-start-reminder-row { grid-template-columns: 96px minmax(0, 1fr); }
    }
  `;
  document.head.appendChild(style);
}

async function loadDueReminders(authUserId, today) {
  const { data: activities, error: activitiesError } = await supabase
    .from('activities')
    .select('id,row_id,school,authority,activity_name,funding,start_date,date_1')
    .ilike('funding', '%גפן%')
    .or('start_date.not.is.null,date_1.not.is.null');

  if (activitiesError) throw activitiesError;

  const due = (activities || [])
    .filter((activity) => normalizeFunding(activity?.funding) === 'גפן')
    .map((activity) => ({ ...activity, reminder_start_date: firstActivityDate(activity) }))
    .filter((activity) => isReminderDue(activity.reminder_start_date, today))
    .sort((a, b) => {
      const dateCompare = String(a.reminder_start_date).localeCompare(String(b.reminder_start_date));
      if (dateCompare !== 0) return dateCompare;
      return String(a.school || '').localeCompare(String(b.school || ''), 'he');
    });

  if (!due.length) return [];

  const dueIds = due.map((activity) => activity.id);
  const { data: acknowledgements, error: acknowledgementError } = await supabase
    .from(REMINDER_TABLE)
    .select('activity_id')
    .eq('user_id', authUserId)
    .in('activity_id', dueIds);

  if (acknowledgementError) throw acknowledgementError;
  const acknowledgedIds = new Set((acknowledgements || []).map((row) => Number(row.activity_id)));
  return due.filter((activity) => !acknowledgedIds.has(Number(activity.id)));
}

function reminderDialogHtml(activity, today) {
  const daysUntilStart = dateOrdinal(activity.reminder_start_date) - dateOrdinal(today);
  const timing = daysUntilStart === 0
    ? 'הפעילות מתחילה היום'
    : daysUntilStart === 1
      ? 'הפעילות מתחילה מחר'
      : `הפעילות מתחילה בעוד ${daysUntilStart} ימים`;

  return `
    <section class="gefen-start-reminder-dialog" role="dialog" aria-modal="true" aria-labelledby="gefenReminderTitle" aria-describedby="gefenReminderQuestion">
      <header class="gefen-start-reminder-head">
        <span class="gefen-start-reminder-icon" aria-hidden="true">!</span>
        <div>
          <h2 class="gefen-start-reminder-title" id="gefenReminderTitle">תזכורת חשובה — פעילות גפ״ן</h2>
          <p class="gefen-start-reminder-subtitle">${escapeHtml(timing)}. נדרש אישור לפני המשך העבודה.</p>
        </div>
      </header>
      <div class="gefen-start-reminder-body">
        <dl class="gefen-start-reminder-details">
          <div class="gefen-start-reminder-row"><dt>בית ספר</dt><dd>${escapeHtml(activity.school || '—')}</dd></div>
          <div class="gefen-start-reminder-row"><dt>רשות</dt><dd>${escapeHtml(activity.authority || '—')}</dd></div>
          <div class="gefen-start-reminder-row"><dt>פעילות</dt><dd>${escapeHtml(activity.activity_name || '—')}</dd></div>
          <div class="gefen-start-reminder-row"><dt>תאריך התחלה</dt><dd>${escapeHtml(formatHebrewDate(activity.reminder_start_date))}</dd></div>
        </dl>
        <p class="gefen-start-reminder-question" id="gefenReminderQuestion">האם עדכנתם תאריכים ואישרתם פעילות במערכת הגפן?</p>
        <button class="gefen-start-reminder-action" type="button">אישור והמשך עבודה</button>
        <p class="gefen-start-reminder-error" role="alert" aria-live="assertive"></p>
      </div>
    </section>
  `;
}

function showAndAcknowledgeReminder(activity, authUserId, today) {
  return new Promise((resolve) => {
    ensureReminderStyles();

    document.querySelector('.gefen-start-reminder-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'gefen-start-reminder-overlay';
    overlay.setAttribute('data-gefen-reminder-activity-id', String(activity.id));
    overlay.innerHTML = reminderDialogHtml(activity, today);
    document.documentElement.classList.add('gefen-start-reminder-open');
    document.body.appendChild(overlay);

    const button = overlay.querySelector('.gefen-start-reminder-action');
    const errorBox = overlay.querySelector('.gefen-start-reminder-error');

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
      document.documentElement.classList.remove('gefen-start-reminder-open');
      resolve();
    };

    button?.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'שומר אישור…';
      errorBox.textContent = '';

      try {
        const { error } = await supabase
          .from(REMINDER_TABLE)
          .insert({ activity_id: activity.id, user_id: authUserId });

        if (error && String(error.code || '') !== '23505') throw error;
        close();
      } catch (error) {
        console.warn('[gefen-start-reminder] acknowledgement failed', error);
        errorBox.textContent = 'לא ניתן היה לשמור את האישור. יש לנסות שוב כדי להמשיך.';
        button.disabled = false;
        button.textContent = 'אישור והמשך עבודה';
        button.focus({ preventScroll: true });
      }
    });

    requestAnimationFrame(() => button?.focus({ preventScroll: true }));
  });
}

function authenticatedShellIsReady() {
  return Boolean(
    isEligibleReminderUser(state?.user)
    && state?.route !== 'login'
    && document.querySelector('.app-shell')
  );
}

function shouldThrottle(authUserId, dateKey) {
  return lastSuccessfulCheck.authUserId === authUserId
    && lastSuccessfulCheck.dateKey === dateKey
    && (Date.now() - lastSuccessfulCheck.at) < CHECK_THROTTLE_MS;
}

async function checkGefenStartReminders() {
  if (checkPromise || !supabase || !authenticatedShellIsReady()) return checkPromise;

  checkPromise = (async () => {
    const session = await waitForSupabaseAuthSession({ timeoutMs: 8000 });
    const authUserId = String(session?.user?.id || '').trim();
    if (!authUserId || !authenticatedShellIsReady()) return;

    const today = todayInJerusalem();
    if (shouldThrottle(authUserId, today)) return;

    const dueReminders = await loadDueReminders(authUserId, today);
    lastSuccessfulCheck = { authUserId, dateKey: today, at: Date.now() };

    for (const activity of dueReminders) {
      if (!authenticatedShellIsReady()) break;
      await showAndAcknowledgeReminder(activity, authUserId, today);
    }
  })()
    .catch((error) => {
      console.warn('[gefen-start-reminder] check failed', error);
    })
    .finally(() => {
      checkPromise = null;
    });

  return checkPromise;
}

function scheduleReminderCheck() {
  checkGefenStartReminders().catch(() => {});
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleReminderCheck, { once: true });
  } else {
    scheduleReminderCheck();
  }

  window.setInterval(scheduleReminderCheck, POLL_INTERVAL_MS);
  window.addEventListener('focus', scheduleReminderCheck);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleReminderCheck();
  });
}

export {
  REMINDER_LEAD_DAYS,
  REMINDER_YEAR,
  firstActivityDate,
  isEligibleReminderUser,
  isReminderDue,
  normalizeFunding,
  todayInJerusalem
};
