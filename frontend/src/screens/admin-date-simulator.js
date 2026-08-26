import { state } from '../state.js';
import { formatDateHeWithWeekday } from './shared/format-date.js';
import { escapeHtml } from './shared/html.js';
import {
  addCalendarDays,
  blockingSchoolCalendarEvent
} from './shared/school-calendar-logic.js';
import { loadSchoolCalendarRows } from './shared/school-calendar-data.js';

const MAX_MEETINGS = 60;
const MAX_SKIPPED_WEEKS = 52;

function isAdmin() {
  return String(state?.user?.role || state?.user?.display_role || '').trim() === 'admin';
}

/**
 * Pure simulator: weekly recurrence, using the same school-calendar blocking rules
 * used by activity scheduling. Blocked weekly dates remain visible in the timeline,
 * but are not counted as meetings. Nothing is persisted.
 */
export function simulateWeeklyDates(rows = [], startDate, meetingCount) {
  const total = Math.min(MAX_MEETINGS, Math.max(0, Math.floor(Number(meetingCount) || 0)));
  const cleanStart = String(startDate || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanStart) || !total) {
    return { dates: [], timeline: [], skipped: [], exhausted: false };
  }

  const dates = [];
  const timeline = [];
  const skipped = [];
  let candidate = cleanStart;

  for (let meetingIndex = 0; meetingIndex < total; meetingIndex += 1) {
    let skippedWeeks = 0;
    let blockingEvent = blockingSchoolCalendarEvent(rows, candidate);

    while (blockingEvent && skippedWeeks < MAX_SKIPPED_WEEKS) {
      const skippedItem = {
        type: 'skipped',
        date: candidate,
        reason: blockingEvent.title || 'חופשה או יום ללא לימודים',
        intendedMeeting: meetingIndex + 1
      };
      skipped.push(skippedItem);
      timeline.push(skippedItem);
      candidate = addCalendarDays(candidate, 7);
      skippedWeeks += 1;
      blockingEvent = blockingSchoolCalendarEvent(rows, candidate);
    }

    if (!candidate || blockingEvent) {
      return { dates, timeline, skipped, exhausted: true };
    }

    const meetingItem = {
      type: 'meeting',
      meeting: meetingIndex + 1,
      date: candidate
    };
    dates.push(meetingItem);
    timeline.push(meetingItem);
    candidate = addCalendarDays(candidate, 7);
  }

  return { dates, timeline, skipped, exhausted: false };
}

function ensureStyles() {
  if (document.getElementById('admin-date-simulator-styles')) return;
  const style = document.createElement('style');
  style.id = 'admin-date-simulator-styles';
  style.textContent = `
    .admin-date-simulator {
      width: min(92vw, 580px);
      max-width: 580px;
      margin: auto;
      padding: 0;
      border: 1px solid var(--color-border, #dbe3ec);
      border-radius: 18px;
      background: var(--color-surface, #fff);
      color: var(--color-text, #172033);
      box-shadow: 0 22px 60px rgba(15, 23, 42, .22);
      overflow: hidden;
    }
    .admin-date-simulator::backdrop {
      background: rgba(15, 23, 42, .26);
      backdrop-filter: blur(2px);
    }
    .admin-date-simulator__shell {
      display: flex;
      flex-direction: column;
      max-height: min(80vh, 700px);
    }
    .admin-date-simulator__header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 20px 22px 14px;
      border-bottom: 1px solid var(--color-border, #e2e8f0);
    }
    .admin-date-simulator__title {
      margin: 0;
      font-size: 19px;
      line-height: 1.25;
      font-weight: 850;
    }
    .admin-date-simulator__subtitle {
      margin: 5px 0 0;
      color: var(--color-text-secondary, #64748b);
      font-size: 12.5px;
      line-height: 1.45;
    }
    .admin-date-simulator__close {
      appearance: none;
      width: 34px;
      height: 34px;
      flex: 0 0 34px;
      display: grid;
      place-items: center;
      border: 1px solid var(--color-border, #dbe3ec);
      border-radius: 10px;
      background: var(--color-surface-muted, #f8fafc);
      color: var(--color-text-secondary, #64748b);
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
    }
    .admin-date-simulator__body {
      padding: 18px 22px 20px;
      overflow: auto;
    }
    .admin-date-simulator__inputs {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 150px;
      gap: 12px;
      align-items: end;
    }
    .admin-date-simulator__field {
      display: flex;
      flex-direction: column;
      gap: 7px;
      min-width: 0;
    }
    .admin-date-simulator__field label {
      font-size: 12.5px;
      font-weight: 750;
    }
    .admin-date-simulator__field input {
      width: 100%;
      min-width: 0;
      height: 42px;
      box-sizing: border-box;
      padding: 8px 11px;
      border: 1px solid var(--color-border, #cbd5e1);
      border-radius: 10px;
      background: var(--color-surface, #fff);
      color: var(--color-text, #172033);
      font: inherit;
      outline: none;
    }
    .admin-date-simulator__field input:focus {
      border-color: var(--color-primary, #0ea5e9);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #0ea5e9) 14%, transparent);
    }
    .admin-date-simulator__status {
      min-height: 18px;
      margin: 12px 0 0;
      color: var(--color-text-secondary, #64748b);
      font-size: 12px;
      line-height: 1.4;
    }
    .admin-date-simulator__status.is-error {
      color: #b42318;
    }
    .admin-date-simulator__results {
      margin-top: 10px;
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 12px;
      overflow: hidden;
    }
    .admin-date-simulator__results[hidden] {
      display: none;
    }
    .admin-date-simulator__results-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      background: var(--color-surface-muted, #f8fafc);
      border-bottom: 1px solid var(--color-border, #e2e8f0);
      font-size: 12px;
      font-weight: 800;
    }
    .admin-date-simulator__list {
      max-height: 340px;
      overflow: auto;
    }
    .admin-date-simulator__row {
      display: grid;
      grid-template-columns: 78px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      min-height: 42px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--color-border, #edf2f7);
      font-size: 12.5px;
    }
    .admin-date-simulator__row:last-child {
      border-bottom: 0;
    }
    .admin-date-simulator__row.is-skipped {
      background: #fff8ed;
      color: #7a4a00;
      border-inline-start: 3px solid #f0a23a;
    }
    .admin-date-simulator__meeting {
      font-weight: 800;
    }
    .admin-date-simulator__row.is-skipped .admin-date-simulator__meeting {
      color: #9a6700;
    }
    .admin-date-simulator__date {
      min-width: 0;
      white-space: nowrap;
    }
    .admin-date-simulator__skip {
      display: inline-flex;
      align-items: center;
      max-width: 190px;
      color: #7a4a00;
      background: #ffedcc;
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 10.5px;
      line-height: 1.25;
      white-space: normal;
    }
    @media (max-width: 560px) {
      .admin-date-simulator__header,
      .admin-date-simulator__body { padding-inline: 16px; }
      .admin-date-simulator__inputs { grid-template-columns: 1fr; }
      .admin-date-simulator__row { grid-template-columns: 72px minmax(0, 1fr); }
      .admin-date-simulator__skip { grid-column: 2; justify-self: start; max-width: 100%; }
    }
  `;
  document.head.appendChild(style);
}

function resultRowsHtml(timeline) {
  return timeline.map((item) => {
    if (item.type === 'skipped') {
      return `
        <div class="admin-date-simulator__row is-skipped">
          <span class="admin-date-simulator__meeting">לא נספר</span>
          <span class="admin-date-simulator__date">${formatDateHeWithWeekday(item.date)}</span>
          <span class="admin-date-simulator__skip">דולג: ${escapeHtml(item.reason)}</span>
        </div>`;
    }

    return `
      <div class="admin-date-simulator__row">
        <span class="admin-date-simulator__meeting">מפגש ${item.meeting}</span>
        <span class="admin-date-simulator__date">${formatDateHeWithWeekday(item.date)}</span>
        <span></span>
      </div>`;
  }).join('');
}

export function openAdminDateSimulator() {
  if (!isAdmin() || typeof document === 'undefined') return;

  const existing = document.querySelector('[data-admin-date-simulator-dialog]');
  if (existing) {
    existing.showModal?.();
    existing.querySelector('input[type="date"]')?.focus();
    return;
  }

  ensureStyles();

  const dialog = document.createElement('dialog');
  dialog.className = 'admin-date-simulator';
  dialog.dir = 'rtl';
  dialog.dataset.adminDateSimulatorDialog = 'true';
  dialog.innerHTML = `
    <div class="admin-date-simulator__shell">
      <header class="admin-date-simulator__header">
        <div>
          <h2 class="admin-date-simulator__title">סימולטור תאריכים</h2>
          <p class="admin-date-simulator__subtitle">רצף שבועי שמציג גם תאריכים שנדחו, אך לא סופר אותם כמפגש.</p>
        </div>
        <button type="button" class="admin-date-simulator__close" data-date-simulator-close aria-label="סגירה">×</button>
      </header>
      <div class="admin-date-simulator__body">
        <div class="admin-date-simulator__inputs">
          <div class="admin-date-simulator__field">
            <label for="admin-date-simulator-start">תאריך מפגש ראשון</label>
            <input id="admin-date-simulator-start" type="date" autocomplete="off" data-date-simulator-start>
          </div>
          <div class="admin-date-simulator__field">
            <label for="admin-date-simulator-count">מספר מפגשים</label>
            <input id="admin-date-simulator-count" type="number" min="1" max="${MAX_MEETINGS}" step="1" inputmode="numeric" autocomplete="off" data-date-simulator-count>
          </div>
        </div>
        <p class="admin-date-simulator__status" data-date-simulator-status aria-live="polite"></p>
        <section class="admin-date-simulator__results" data-date-simulator-results hidden>
          <div class="admin-date-simulator__results-head">
            <span>רצף התאריכים</span>
            <span data-date-simulator-summary></span>
          </div>
          <div class="admin-date-simulator__list" data-date-simulator-list></div>
        </section>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  const startInput = dialog.querySelector('[data-date-simulator-start]');
  const countInput = dialog.querySelector('[data-date-simulator-count]');
  const status = dialog.querySelector('[data-date-simulator-status]');
  const results = dialog.querySelector('[data-date-simulator-results]');
  const summary = dialog.querySelector('[data-date-simulator-summary]');
  const list = dialog.querySelector('[data-date-simulator-list]');
  let requestVersion = 0;

  const resetOutput = () => {
    status.textContent = '';
    status.classList.remove('is-error');
    results.hidden = true;
    summary.textContent = '';
    list.innerHTML = '';
  };

  const renderSimulation = async () => {
    const startDate = String(startInput.value || '').trim();
    const meetingCount = Math.floor(Number(countInput.value) || 0);
    const requestId = ++requestVersion;

    if (!startDate || meetingCount < 1) {
      resetOutput();
      return;
    }

    if (meetingCount > MAX_MEETINGS) {
      resetOutput();
      status.textContent = `ניתן לדמות עד ${MAX_MEETINGS} מפגשים.`;
      status.classList.add('is-error');
      return;
    }

    status.classList.remove('is-error');
    status.textContent = 'בודק את לוח החופשות…';
    results.hidden = true;

    const rows = await loadSchoolCalendarRows();
    if (requestId !== requestVersion || !dialog.isConnected) return;

    const simulation = simulateWeeklyDates(rows, startDate, meetingCount);
    if (!simulation.dates.length && !simulation.timeline.length) {
      resetOutput();
      status.textContent = 'לא ניתן ליצור רצף מהנתונים שנבחרו.';
      status.classList.add('is-error');
      return;
    }

    list.innerHTML = resultRowsHtml(simulation.timeline);
    summary.textContent = simulation.skipped.length
      ? `${simulation.dates.length} מפגשים · ${simulation.skipped.length} דולגו`
      : `${simulation.dates.length} מפגשים`;
    results.hidden = false;
    status.textContent = simulation.exhausted
      ? 'הרצף נעצר לאחר שלא נמצא תאריך לימודים תקין בהמשך.'
      : '';
    status.classList.toggle('is-error', simulation.exhausted);
  };

  const closeDialog = () => {
    requestVersion += 1;
    dialog.close?.();
  };

  dialog.querySelector('[data-date-simulator-close]')?.addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDialog();
  });
  dialog.addEventListener('close', () => {
    // The simulator result is intentionally ephemeral: no local/session storage and no server writes.
    dialog.remove();
  }, { once: true });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog();
  });
  startInput.addEventListener('change', () => void renderSimulation());
  countInput.addEventListener('input', () => void renderSimulation());

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  startInput.focus();
}
