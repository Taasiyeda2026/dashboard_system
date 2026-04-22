import { translateApiErrorForUser } from './ui-hebrew.js';
import { showToast } from './toast.js';
import { formatDateHe } from './format-date.js';
import { escapeHtml } from './html.js';

function setEditMode(form, editing) {
  form.dataset.editing = editing ? 'yes' : 'no';
  form.querySelectorAll('[data-mode="view"]').forEach((el) => el.toggleAttribute('hidden', editing));
  form.querySelectorAll('[data-mode="edit"]').forEach((el) => el.toggleAttribute('hidden', !editing));
  form.querySelectorAll('[data-view-only]').forEach((el) => el.toggleAttribute('hidden', editing));
  form.querySelectorAll('[data-edit-only]').forEach((el) => el.toggleAttribute('hidden', !editing));
  form.querySelectorAll('[data-edit-actions]').forEach((el) => el.toggleAttribute('hidden', !editing));
  const editBtn = form.querySelector('[data-action="start-edit"]');
  if (editBtn) editBtn.toggleAttribute('hidden', editing);
  updateMoreDatesToggle(form);
}

function setStatus(statusEl, kind, text) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.remove('is-pending', 'is-error', 'is-success');
  if (kind) statusEl.classList.add(kind);
}

function detectActivityNoByName(form, activityName) {
  const sel = form.querySelector('[data-role="activity-name-select"]');
  if (!sel) return '';
  const opt = Array.from(sel.options).find((o) => o.value === activityName);
  return opt ? String(opt.dataset.activityNo || '') : '';
}

function addDays(dateStr, days) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function updateEndDateDisplay(form) {
  const pickers = Array.from(form.querySelectorAll('input[data-meeting-idx]'));
  const last = pickers[pickers.length - 1];
  const maxDate = last ? String(last.value || '') : '';
  const display = form.querySelector('[data-computed-end-display]');
  if (display) display.textContent = maxDate ? (formatDateHe(maxDate) || maxDate) : '—';
  form.dataset.autoEndDate = maxDate;
}

function applyChainShift(form, changedIdx, _oldDate, newDate) {
  if (!newDate) return;
  const pickers = Array.from(form.querySelectorAll('input[data-meeting-idx]')).sort(
    (a, b) => Number(a.dataset.meetingIdx) - Number(b.dataset.meetingIdx)
  );
  if (!pickers.length) return;
  pickers.forEach((p) => {
    const idx = Number(p.dataset.meetingIdx);
    if (idx <= changedIdx) return;
    const daysAfterChanged = (idx - changedIdx) * 7;
    p.value = addDays(newDate, daysAfterChanged) || p.value;
  });
}

function getChainMode(form) {
  const active = form.querySelector('[data-chain-toggle] [data-date-mode].is-active');
  return active ? String(active.dataset.dateMode || 'single') : 'single';
}

function buildMeetingPickerCell(idx, dateValue) {
  const cell = document.createElement('div');
  cell.className = 'activity-drawer__date-card';
  cell.dataset.meetingIndex = String(idx);
  const dayLetter = (() => {
    if (!dateValue) return '';
    const d = new Date(`${dateValue}T12:00:00`);
    return Number.isNaN(d.getTime()) ? '' : ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'][d.getDay()] || '';
  })();
  cell.innerHTML = `
    <div class="activity-drawer__date-card-top">
      <span class="activity-drawer__meeting-index">מפגש ${idx + 1}</span>
      <span class="activity-drawer__weekday">${dayLetter}</span>
    </div>
    <input class="ds-input" type="date" name="meeting_date_${idx}" data-role="meeting-date" data-meeting-index="${idx}" data-meeting-idx="${idx}" value="${escapeHtml(String(dateValue || ''))}">
    <input type="hidden" name="meeting_performed_${idx}" value="no">`;
  return cell;
}

function updateMeetingWeekdays(form) {
  form.querySelectorAll('.activity-drawer__date-card').forEach((cell) => {
    const picker = cell.querySelector('input[data-meeting-idx]');
    const label = cell.querySelector('.activity-drawer__date-card-top .activity-drawer__weekday');
    if (!picker || !label) return;
    if (!picker.value) {
      label.textContent = '';
      return;
    }
    const d = new Date(`${picker.value}T12:00:00`);
    label.textContent = Number.isNaN(d.getTime()) ? '' : (['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'][d.getDay()] || '');
  });
}

function updateMoreDatesToggle(form) {
  const isEditing = form.dataset.editing === 'yes';
  const isOnce = form.dataset.isOnce === 'yes';
  const viewCards = Array.from(form.querySelectorAll('[data-date-card]'));
  const editCards = Array.from(form.querySelectorAll('[data-meeting-dates-edit] .activity-drawer__date-card'));
  const overflow = Math.max(0, viewCards.length - 6);

  const buttons = Array.from(form.querySelectorAll('[data-action="toggle-more"]'));
  buttons.forEach((button) => {
    button.hidden = isEditing || isOnce || overflow === 0;
    if (!button.hidden) {
      button.textContent = form.dataset.datesExpanded === 'yes' ? 'פחות ▲' : `+${overflow} עוד ▾`;
    }
  });

  viewCards.forEach((card, idx) => {
    card.hidden = form.dataset.datesExpanded === 'yes' ? false : idx >= 6;
  });

  editCards.forEach((card) => {
    card.hidden = false;
  });
}

export function bindActivityEditForm(contentRoot, { api, clearScreenDataCache, rerender }) {
  if (!api || !contentRoot) return;

  async function saveActivityForm(form) {
    const statusEl = form.querySelector('.ds-activity-edit-status');
    const submitBtn = form.querySelector('[data-action="save-edit"]');
    const sourceSheet = form.getAttribute('data-source-sheet') || '';
    const sourceRowId = form.getAttribute('data-row-id') || '';
    const changes = {};

    form.querySelectorAll('[name]').forEach((el) => {
      const name = el.getAttribute('name');
      if (!name || name.startsWith('_')) return;
      if (el.closest('[hidden]')) return;
      changes[name] = String(el.value ?? '').trim();
    });

    try {
      setStatus(statusEl, 'is-pending', 'שומר...');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('is-loading');
      }

      await api.saveActivity({ source_sheet: sourceSheet, source_row_id: sourceRowId, changes });
      setStatus(statusEl, 'is-success', '✅ נשמר בהצלחה');
      showToast('✅ נשמר בהצלחה', 'success', 2500);
      setEditMode(form, false);
      clearScreenDataCache?.();
      if (typeof rerender === 'function') await rerender();
    } catch (err) {
      setStatus(statusEl, 'is-error', `⚠️ ${translateApiErrorForUser(err?.message)}`);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('is-loading');
      }
    }
  }

  contentRoot.addEventListener('click', (ev) => {
    const form = ev.target.closest('[data-drawer-form]');
    if (!form) return;

    if (ev.target.closest('[data-action="start-edit"]')) {
      setEditMode(form, true);
      return;
    }

    if (ev.target.closest('[data-action="cancel-edit"]')) {
      form.reset();
      form.dataset.datesExpanded = 'no';
      setStatus(form.querySelector('.ds-activity-edit-status'), '', '');
      updateMeetingWeekdays(form);
      updateMoreDatesToggle(form);
      updateEndDateDisplay(form);
      setEditMode(form, false);
      return;
    }

    if (ev.target.closest('[data-action="save-edit"]')) {
      ev.preventDefault();
      void saveActivityForm(form);
      return;
    }

    const chainBtn = ev.target.closest('[data-date-mode]');
    if (chainBtn) {
      const toggle = chainBtn.closest('[data-chain-toggle]');
      if (toggle) {
        toggle.querySelectorAll('[data-date-mode]').forEach((b) => b.classList.remove('is-active'));
        chainBtn.classList.add('is-active');
      }
      return;
    }

    if (ev.target.closest('[data-action="add-meeting"]')) {
      const grid = form.querySelector('[data-meeting-dates-edit]');
      if (!grid) return;
      if (form.dataset.isOnce === 'yes') return;
      const allPickers = Array.from(grid.querySelectorAll('input[data-meeting-idx]'));
      const currentCount = allPickers.length;
      const lastDate = allPickers.length ? allPickers[allPickers.length - 1].value : '';
      const nextDate = lastDate ? addDays(lastDate, 7) : '';
      const cell = buildMeetingPickerCell(currentCount, nextDate);
      grid.appendChild(cell);
      updateMeetingWeekdays(form);
      updateMoreDatesToggle(form);
      updateEndDateDisplay(form);
      return;
    }

    if (ev.target.closest('[data-action="toggle-more"]')) {
      form.dataset.datesExpanded = form.dataset.datesExpanded === 'yes' ? 'no' : 'yes';
      updateMoreDatesToggle(form);
    }
  });

  contentRoot.querySelectorAll('[data-drawer-form]').forEach((form) => {
    setEditMode(form, false);
    form.dataset.datesExpanded = 'no';
    updateMeetingWeekdays(form);
    updateMoreDatesToggle(form);
    updateEndDateDisplay(form);

    form.addEventListener('change', (ev) => {
      const nameEl = ev.target.closest('[data-role="activity-name-select"]');
      if (nameEl) {
        const autoNo = detectActivityNoByName(form, String(nameEl.value || ''));
        const hidden = form.querySelector('[data-activity-no]');
        if (hidden && autoNo) hidden.value = autoNo;
      }

      const datePicker = ev.target.closest('input[data-meeting-idx]');
      if (datePicker) {
        const idx = Number(datePicker.dataset.meetingIdx);
        if (getChainMode(form) === 'chain') {
          const oldDate = datePicker.dataset.prevValue || '';
          applyChainShift(form, idx, oldDate, datePicker.value);
        }
        datePicker.dataset.prevValue = datePicker.value;
        updateMeetingWeekdays(form);
        updateEndDateDisplay(form);
      }
    });

    form.addEventListener('focusin', (ev) => {
      const datePicker = ev.target.closest('input[data-meeting-idx]');
      if (datePicker) datePicker.dataset.prevValue = datePicker.value;
    });
  });
}
