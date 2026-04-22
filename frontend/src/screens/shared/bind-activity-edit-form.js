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

  contentRoot.querySelectorAll('[data-add-date]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = btn.closest('[data-edit-activity]');
      if (!form) return;
      const next = form.querySelector('[data-date-extra][hidden]');
      if (!next) {
        btn.disabled = true;
        return;
      }
      next.removeAttribute('hidden');
      if (!form.querySelector('[data-date-extra][hidden]')) {
        btn.disabled = true;
      }
    });
  });

  contentRoot.querySelectorAll('[data-edit-activity]').forEach((form) => {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const statusEl = form.querySelector('.ds-activity-edit-status');
      const submitBtn = form.querySelector('button[type="submit"]');
      const sourceSheet = form.getAttribute('data-source-sheet') || '';
      const sourceRowId = form.getAttribute('data-row-id') || '';
      const changes = {};
      form.querySelectorAll('[name]').forEach((el) => {
        const name = el.getAttribute('name');
        if (!name) return;
        if (el.closest('[hidden]')) return;
        if (el.type === 'checkbox') {
          changes[name] = el.checked ? 'yes' : 'no';
          return;
        }
        changes[name] = String(el.value ?? '').trim();
      });
      try {
        if (statusEl) {
          statusEl.textContent = 'שומר...';
          statusEl.classList.remove('is-error', 'is-success');
          statusEl.classList.add('is-pending');
        }
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.classList.add('is-loading');
        }
        const saveRes = await api.saveActivity({ source_sheet: sourceSheet, source_row_id: sourceRowId, changes });
        if (statusEl) {
          statusEl.textContent = saveRes?.request_id ? '✅ נשלח לאישור תפעול' : '✅ נשמר';
          statusEl.classList.remove('is-pending', 'is-error');
          statusEl.classList.add('is-success');
        }
        ui?.closeAll();
        clearScreenDataCache?.();
        if (typeof rerender === 'function') await rerender();
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = `⚠️ ${translateApiErrorForUser(err?.message)}`;
          statusEl.classList.remove('is-pending', 'is-success');
          statusEl.classList.add('is-error');
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.classList.remove('is-loading');
        }
      }
    });
  });
}
