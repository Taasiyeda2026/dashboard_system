import { translateApiErrorForUser } from './ui-hebrew.js';
import { showToast } from './toast.js';

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

/**
 * Binds redesigned activity drawer edit behavior (single + summary accordion).
 */
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

    if (ev.target.closest('[data-reset-end-date]')) {
      const input = form.querySelector('input[name="end_date"]');
      const autoEnd = String(form.dataset.autoEndDate || '').trim();
      if (input && autoEnd) input.value = autoEnd;
      return;
    }

    const toggle = ev.target.closest('[data-toggle-more]');
    if (toggle) {
      const more = form.querySelector('[data-more-dates]');
      if (!more) return;
      const open = !more.hasAttribute('hidden');
      more.toggleAttribute('hidden', open);
      toggle.textContent = open ? toggle.textContent.replace('▴', '▾') : toggle.textContent.replace('▾', '▴');
    }
  });

  contentRoot.querySelectorAll('[data-activity-form]').forEach((form) => {
    setEditMode(form, false);

    form.addEventListener('change', (ev) => {
      const sel = ev.target.closest('[data-activity-name]');
      if (!sel) return;
      const autoNo = detectActivityNoByName(form, String(sel.value || ''));
      const hidden = form.querySelector('[data-activity-no]');
      if (hidden && autoNo) hidden.value = autoNo;
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
