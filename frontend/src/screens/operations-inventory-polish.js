import { api } from '../api.js';
import { supabase } from '../supabase-client.js';
import { normalizeOneDayActivityType } from './shared/activity-options.js';

const PARTICIPANTS_FIELD = 'participants_count';
const PARTICIPANT_ACTIVITY_TYPES = new Set(['workshop', 'escape_room']);

function normalizeParticipantActivityType(value) {
  return normalizeOneDayActivityType(value) || String(value || '').trim();
}

function supportsParticipantsCount(value) {
  return PARTICIPANT_ACTIVITY_TYPES.has(normalizeParticipantActivityType(value));
}

function cleanParticipantsCount(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) throw new Error('participants_count_must_be_positive_integer');
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error('participants_count_must_be_positive_integer');
  return n;
}

function stripParticipantsCount(obj = {}) {
  const copy = { ...(obj || {}) };
  delete copy[PARTICIPANTS_FIELD];
  return copy;
}

async function saveParticipantsCountByRowId(rowId, participantsCount) {
  const safeRowId = String(rowId || '').trim();
  if (!safeRowId || !supabase) return;
  const { error } = await supabase
    .from('activities')
    .update({ participants_count: participantsCount })
    .eq('row_id', safeRowId);
  if (error) throw error;
}

function patchParticipantsCountApi() {
  if (!api || api.__participantsCountPatchApplied) return;
  api.__participantsCountPatchApplied = true;

  const originalSaveActivity = typeof api.saveActivity === 'function' ? api.saveActivity.bind(api) : null;
  if (originalSaveActivity) {
    api.saveActivity = async (payload = {}) => {
      const changes = payload?.changes && typeof payload.changes === 'object' ? payload.changes : {};
      if (!Object.prototype.hasOwnProperty.call(changes, PARTICIPANTS_FIELD)) return originalSaveActivity(payload);
      const participantsCount = cleanParticipantsCount(changes[PARTICIPANTS_FIELD]);
      const nextChanges = stripParticipantsCount(changes);
      let result = { ok: true };
      if (Object.keys(nextChanges).length) {
        result = await originalSaveActivity({ ...payload, changes: nextChanges });
      }
      await saveParticipantsCountByRowId(payload?.source_row_id || payload?.row_id || payload?.RowID, participantsCount);
      return result;
    };
  }

  const originalAddActivity = typeof api.addActivity === 'function' ? api.addActivity.bind(api) : null;
  if (originalAddActivity) {
    api.addActivity = async (payload = {}) => {
      const activity = payload?.activity && typeof payload.activity === 'object' ? payload.activity : payload;
      const activityType = normalizeParticipantActivityType(activity?.activity_type || activity?.item_type);
      const hasParticipantsCount = Object.prototype.hasOwnProperty.call(activity || {}, PARTICIPANTS_FIELD);
      const participantsCount = hasParticipantsCount && supportsParticipantsCount(activityType)
        ? cleanParticipantsCount(activity[PARTICIPANTS_FIELD])
        : null;
      const cleanActivity = stripParticipantsCount(activity);
      const result = await originalAddActivity(payload?.activity ? { ...payload, activity: cleanActivity } : cleanActivity);
      if (hasParticipantsCount && supportsParticipantsCount(activityType)) {
        const rowId = result?.row_id || result?.RowID || cleanActivity?.row_id || cleanActivity?.RowID;
        await saveParticipantsCountByRowId(rowId, participantsCount);
        if (result?.row) result.row.participants_count = participantsCount;
      }
      return result;
    };
  }
}

function addInventoryPolishStyle() {
  if (document.getElementById('ops-inventory-polish-style')) return;
  const style = document.createElement('style');
  style.id = 'ops-inventory-polish-style';
  style.textContent = `
    .ds-ops-workshops-panel [data-ops-print-workshops] { display: none !important; }
    .ds-ops-workshops-panel .ds-ops-usage-cell {
      position: relative !important;
      cursor: pointer !important;
      text-align: center !important;
      padding-left: 24px !important;
      padding-right: 24px !important;
      transition: background-color .16s ease, box-shadow .16s ease;
    }
    .ds-ops-workshops-panel .ds-ops-usage-cell:hover {
      background: #f8fbfd !important;
      box-shadow: inset 0 0 0 1px #cfe1ec;
    }
    .ds-ops-workshops-panel .ds-ops-usage-display {
      display: block !important;
      width: 100% !important;
      text-align: center !important;
      font-weight: 700 !important;
    }
    .ds-ops-workshops-panel .ds-ops-usage-cell .ds-ops-stock-edit-btn {
      position: absolute !important;
      left: 6px !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      width: 16px !important;
      height: 16px !important;
      min-width: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      color: #94a3b8 !important;
      font-size: 11px !important;
      line-height: 16px !important;
      opacity: 0 !important;
      box-shadow: none !important;
      transition: opacity .16s ease, color .16s ease;
    }
    .ds-ops-workshops-panel .ds-ops-usage-cell:hover .ds-ops-stock-edit-btn,
    .ds-ops-workshops-panel .ds-ops-usage-cell:focus-within .ds-ops-stock-edit-btn { opacity: 1 !important; }
    .ds-ops-workshops-panel .ds-ops-usage-cell .ds-ops-stock-edit-btn:hover {
      color: var(--ds-accent, #0292b7) !important;
      background: transparent !important;
    }
    .ds-ops-workshops-panel .ds-ops-usage-cell.ops-inventory-edited { background: #f0fdf4 !important; }
    .ds-ops-workshops-panel .ds-ops-usage-cell.ops-inventory-edited::after {
      content: '';
      position: absolute;
      right: 7px;
      top: 50%;
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #22c55e;
      transform: translateY(-50%);
      box-shadow: 0 0 0 2px #dcfce7;
    }
    [data-participants-count-section][hidden] { display: none !important; }
    .ds-participants-count-field { display: flex; flex-direction: column; gap: 4px; }
    .ds-participants-count-field label { font-weight: 700; color: #334155; font-size: 12px; }
  `;
  document.head.appendChild(style);
}

function escapeAttr(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function parseDrawerRow(form) {
  try { return JSON.parse(form?.dataset?.exportRow || '{}') || {}; } catch (_) { return {}; }
}

function currentFormActivityType(form) {
  const el = form?.querySelector?.('[name="activity_type"], [name="item_type"]');
  const row = parseDrawerRow(form);
  return normalizeParticipantActivityType(el?.value || row.activity_type || row.item_type || '');
}

function currentParticipantsCount(form) {
  const row = parseDrawerRow(form);
  return row?.participants_count ?? '';
}

function participantsDisplay(value) {
  const raw = String(value ?? '').trim();
  return raw ? raw : 'לא עודכן';
}

function ensureDrawerParticipantsCount(form) {
  if (!form || form.querySelector('[data-participants-count-section]')) return;
  const value = currentParticipantsCount(form);
  const template = document.createElement('template');
  template.innerHTML = `
    <section class="activity-drawer__section activity-drawer__section--participants" data-participants-count-section>
      <h3 class="activity-drawer__section-title">קבוצה ומשתתפים</h3>
      <div class="activity-drawer__grid activity-drawer__grid--three activity-drawer__view-grid" data-mode="view">
        <div class="activity-drawer__field">
          <div class="activity-drawer__label">מספר משתתפים מעודכן</div>
          <div class="activity-drawer__value" data-participants-count-view>${escapeAttr(participantsDisplay(value))}</div>
        </div>
      </div>
      <div class="activity-drawer__details-edit-grid" data-mode="edit" hidden>
        <div class="activity-drawer__field">
          <label class="activity-drawer__label">מספר משתתפים מעודכן</label>
          <input class="ds-input" name="participants_count" type="number" min="1" step="1" inputmode="numeric" value="${escapeAttr(value)}" data-participants-count-input>
        </div>
      </div>
    </section>`;
  const section = template.content.firstElementChild;
  const anchor = form.querySelector('[data-dates-section]') || form.querySelector('.activity-drawer__section--supplemental') || form.querySelector('.activity-drawer__section--actions');
  if (anchor?.parentNode) anchor.parentNode.insertBefore(section, anchor.nextSibling);
  else form.appendChild(section);
}

function ensureGenericParticipantsCount(form) {
  if (!form || form.matches('[data-drawer-form]') || form.querySelector('[data-participants-count-section]')) return;
  if (!form.querySelector('[name="activity_type"], [name="item_type"]')) return;
  if (!form.querySelector('[name="activity_name"], [data-role="activity-name-select"]')) return;
  const field = document.createElement('div');
  field.className = 'ds-participants-count-field';
  field.setAttribute('data-participants-count-section', '');
  field.innerHTML = `<label>מספר משתתפים מעודכן</label><input class="ds-input" name="participants_count" type="number" min="1" step="1" inputmode="numeric" data-participants-count-input>`;
  const anchor = form.querySelector('[name="class_group"]')?.closest('.activity-drawer__field, .ds-field, label, div')
    || form.querySelector('[name="activity_name"], [data-role="activity-name-select"]')?.closest('.activity-drawer__field, .ds-field, label, div');
  if (anchor?.parentNode) anchor.parentNode.insertBefore(field, anchor.nextSibling);
  else form.appendChild(field);
}

function syncParticipantsCountForm(form) {
  if (!form) return;
  if (form.matches('[data-drawer-form]')) ensureDrawerParticipantsCount(form);
  else ensureGenericParticipantsCount(form);
  const section = form.querySelector('[data-participants-count-section]');
  if (!section) return;
  const input = section.querySelector('[data-participants-count-input]');
  const view = section.querySelector('[data-participants-count-view]');
  const supported = supportsParticipantsCount(currentFormActivityType(form));
  section.hidden = !supported;
  if (input) {
    input.disabled = !supported;
    if (!supported) input.value = '';
  }
  if (view) view.textContent = participantsDisplay(input?.value || currentParticipantsCount(form));
}

function syncParticipantsCountForms(root = document) {
  root.querySelectorAll?.('form').forEach((form) => {
    if (form.matches('[data-drawer-form]') || form.querySelector('[name="activity_type"], [name="item_type"]')) {
      syncParticipantsCountForm(form);
    }
  });
}

function bindParticipantsCountUi() {
  document.addEventListener('change', (event) => {
    const form = event.target?.closest?.('form');
    if (!form) return;
    if (event.target.matches('[name="activity_type"], [name="item_type"], [data-participants-count-input]')) {
      syncParticipantsCountForm(form);
    }
  }, true);
  document.addEventListener('input', (event) => {
    const input = event.target?.closest?.('[data-participants-count-input]');
    if (!input) return;
    const form = input.closest('form');
    const view = form?.querySelector('[data-participants-count-view]');
    if (view) view.textContent = participantsDisplay(input.value);
  }, true);
  syncParticipantsCountForms(document);
}

function renameInventoryTab() {
  document.querySelectorAll('.ds-ops-mgmt-tab').forEach((button) => {
    if (String(button.textContent || '').trim() === 'כמויות סדנאות') button.textContent = 'ציוד ומלאי';
  });
}

function polishUsageCells() {
  document.querySelectorAll('.ds-ops-workshops-panel .ds-ops-usage-cell').forEach((cell) => {
    const editButton = cell.querySelector('.ds-ops-stock-edit-btn');
    if (!editButton) return;
    editButton.title = 'עריכת שימוש מלאי';
    editButton.setAttribute('aria-label', 'עריכת שימוש מלאי');
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    if (cell.dataset.inventoryPolished) return;
    cell.dataset.inventoryPolished = '1';
    cell.addEventListener('click', (event) => {
      if (event.target.closest('.ds-ops-stock-edit-btn')) return;
      editButton.click();
    });
    cell.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      editButton.click();
    });
    editButton.addEventListener('click', () => {
      setTimeout(() => cell.classList.add('ops-inventory-edited'), 850);
    });
  });
}

function runInventoryPolish() {
  addInventoryPolishStyle();
  patchParticipantsCountApi();
  bindParticipantsCountUi();
  renameInventoryTab();
  polishUsageCells();
}

function scheduleInventoryPolish() {
  setTimeout(() => {
    runInventoryPolish();
    syncParticipantsCountForms(document);
  }, 90);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleInventoryPolish, { once: true });
  else scheduleInventoryPolish();
  new MutationObserver(scheduleInventoryPolish).observe(document.documentElement, { childList: true, subtree: true });
}
