import { translateApiErrorForUser } from './ui-hebrew.js';
import { showToast } from './toast.js';
import { formatDateHe } from './format-date.js';

function setEditMode(form, editing) {
  form.querySelectorAll('[data-view-only]').forEach((el) => el.toggleAttribute('hidden', editing));
  form.querySelectorAll('[data-edit-only]').forEach((el) => el.toggleAttribute('hidden', !editing));
  form.querySelectorAll('[data-edit-actions]').forEach((el) => el.toggleAttribute('hidden', !editing));
  const editBtn = form.querySelector('[data-action-edit]');
  if (editBtn) editBtn.toggleAttribute('hidden', editing);
  form.dataset.editing = editing ? 'yes' : 'no';
}

function setStatus(statusEl, kind, text) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.remove('is-pending', 'is-error', 'is-success');
  if (kind) statusEl.classList.add(kind);
}

function detectActivityNoByName(form, activityName) {
  const sel = form.querySelector('[data-activity-name]');
  if (!sel) return '';
  const opt = Array.from(sel.options).find((o) => o.value === activityName);
  return opt ? String(opt.dataset.activityNo || '') : '';
}

function addDays(dateStr, days) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateDeltaDays(fromStr, toStr) {
  if (!fromStr || !toStr) return 0;
  const a = new Date(fromStr);
  const b = new Date(toStr);
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

function updateEndDateDisplay(form) {
  const pickers = Array.from(form.querySelectorAll('input[data-meeting-idx]'));
  let maxDate = '';
  pickers.forEach((p) => {
    if (p.value && (!maxDate || p.value > maxDate)) maxDate = p.value;
  });
  const display = form.querySelector('[data-computed-end-display]');
  if (display) display.textContent = maxDate ? (formatDateHe(maxDate) || maxDate) : '—';
  form.dataset.autoEndDate = maxDate;
}

function applyChainShift(form, changedIdx, oldDate, newDate) {
  const pickers = Array.from(form.querySelectorAll('input[data-meeting-idx]'));
  const delta = dateDeltaDays(oldDate, newDate);
  if (!delta) return;
  pickers.forEach((p) => {
    const idx = Number(p.dataset.meetingIdx);
    if (idx > changedIdx && p.value) {
      p.value = addDays(p.value, delta) || p.value;
    }
  });
}

function getChainMode(form) {
  const active = form.querySelector('[data-chain-toggle] [data-chain-mode].is-active');
  return active ? String(active.dataset.chainMode || 'single') : 'single';
}

function buildMeetingPickerCell(idx, dateValue) {
  const cell = document.createElement('div');
  cell.className = 'ds-date-pick-cell';
  cell.innerHTML = `<span class="ds-field__label">${idx + 1}</span>
    <input class="ds-input ds-input--date" type="date" name="meeting_date_${idx}" data-meeting-idx="${idx}" value="${dateValue}">`;
  return cell;
}

export function bindActivityEditForm(contentRoot, { api, clearScreenDataCache, rerender }) {
  if (!api || !contentRoot) return;

  contentRoot.addEventListener('click', (ev) => {
    const form = ev.target.closest('[data-activity-form]');
    if (!form) return;

    if (ev.target.closest('[data-action-edit]')) {
      setEditMode(form, true);
      return;
    }

    if (ev.target.closest('[data-action-cancel]')) {
      form.reset();
      setStatus(form.querySelector('.ds-activity-edit-status'), '', '');
      setEditMode(form, false);
      return;
    }

    const chainBtn = ev.target.closest('[data-chain-mode]');
    if (chainBtn) {
      const toggle = chainBtn.closest('[data-chain-toggle]');
      if (toggle) {
        toggle.querySelectorAll('[data-chain-mode]').forEach((b) => b.classList.remove('is-active'));
        chainBtn.classList.add('is-active');
      }
      return;
    }

    if (ev.target.closest('[data-add-meeting]')) {
      const grid = form.querySelector('[data-meeting-dates-edit]');
      if (!grid) return;
      const allPickers = Array.from(grid.querySelectorAll('input[data-meeting-idx]'));
      const currentCount = allPickers.length;
      const lastDate = allPickers.length ? allPickers[allPickers.length - 1].value : '';
      const nextDate = lastDate ? addDays(lastDate, 7) : '';
      const cell = buildMeetingPickerCell(currentCount, nextDate);
      grid.appendChild(cell);
      updateEndDateDisplay(form);
      return;
    }
  });

  contentRoot.querySelectorAll('[data-activity-form]').forEach((form) => {
    setEditMode(form, false);

    form.addEventListener('change', (ev) => {
      const nameEl = ev.target.closest('[data-activity-name]');
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
        updateEndDateDisplay(form);
      }
    });

    form.addEventListener('focusin', (ev) => {
      const datePicker = ev.target.closest('input[data-meeting-idx]');
      if (datePicker) datePicker.dataset.prevValue = datePicker.value;
    });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const statusEl = form.querySelector('.ds-activity-edit-status');
      const submitBtn = form.querySelector('button[type="submit"]');
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
    });
  });
}
