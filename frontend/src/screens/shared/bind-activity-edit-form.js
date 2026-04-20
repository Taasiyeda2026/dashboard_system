import { translateApiErrorForUser } from './ui-hebrew.js';

/**
 * Binds the activity edit form(s) inside contentRoot.
 * Works for both single-form (activities, week) and multi-form (month) drawers.
 *
 * @param {Element} contentRoot - drawer/modal content node
 * @param {{ api, ui, clearScreenDataCache, rerender }} opts
 */
export function bindActivityEditForm(contentRoot, { api, ui, clearScreenDataCache, rerender }) {
  if (!api) return;
  contentRoot.querySelectorAll('[data-edit-activity]').forEach((form) => {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const statusEl = form.querySelector('.ds-activity-edit-status');
      const sourceSheet = form.getAttribute('data-source-sheet') || '';
      const sourceRowId = form.getAttribute('data-row-id') || '';
      const fd = new FormData(form);
      const changes = {};
      const addField = (fieldName) => {
        if (!form.querySelector(`[name="${fieldName}"]`)) return;
        changes[fieldName] = String(fd.get(fieldName) ?? '').trim();
      };
      addField('status');
      addField('notes');
      addField('finance_status');
      addField('finance_notes');
      addField('start_date');
      addField('end_date');
      try {
        await api.saveActivity({ source_sheet: sourceSheet, source_row_id: sourceRowId, changes });
        if (statusEl) statusEl.textContent = 'נשמר';
        ui?.closeAll();
        clearScreenDataCache?.();
        if (typeof rerender === 'function') await rerender();
      } catch (err) {
        if (statusEl) statusEl.textContent = translateApiErrorForUser(err?.message);
      }
    });
  });
}
