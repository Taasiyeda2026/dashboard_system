import { normalizeOneDayActivityType } from './shared/activity-options.js';

const PARTICIPANTS_FIELD = 'participants_count';
const PARTICIPANT_ACTIVITY_TYPES = new Set(['workshop', 'escape_room']);

function normalizeParticipantActivityType(value) {
  return normalizeOneDayActivityType(value) || String(value || '').trim();
}

function supportsParticipantsCount(value) {
  return PARTICIPANT_ACTIVITY_TYPES.has(normalizeParticipantActivityType(value));
}

function addInventoryPolishStyle() {
  if (document.getElementById('ops-inventory-polish-style')) return;
  const style = document.createElement('style');
  style.id = 'ops-inventory-polish-style';
  style.textContent = `
    .ds-ops-workshops-panel [data-ops-print-workshops] { display: none !important; }
    .ds-ops-workshops-panel .ds-ops-usage-cell {
      text-align: center !important;
    }
    .ds-ops-workshops-panel .ds-ops-usage-display {
      display: block !important;
      width: 100% !important;
      text-align: center !important;
      font-weight: 700 !important;
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
  return raw ? raw : '0';
}

function ensureDrawerParticipantsCount(form) {
  if (!form || form.querySelector('[data-participants-count-section]')) return;
  const value = currentParticipantsCount(form);
  const template = document.createElement('template');
  template.innerHTML = `
    <section class="activity-drawer__section activity-drawer__section--participants" data-participants-count-section>
      <div class="activity-drawer__grid activity-drawer__grid--three activity-drawer__view-grid" data-mode="view">
        <div class="activity-drawer__field">
          <div class="activity-drawer__label">מספר משתתפים</div>
          <div class="activity-drawer__value" data-participants-count-view>${escapeAttr(participantsDisplay(value))}</div>
        </div>
      </div>
      <div class="activity-drawer__details-edit-grid" data-mode="edit" hidden>
        <div class="activity-drawer__field">
          <label class="activity-drawer__label">מספר משתתפים</label>
          <input class="ds-input" name="participants_count" type="number" min="1" step="1" inputmode="numeric" value="${escapeAttr(value)}" data-participants-count-input>
        </div>
      </div>
    </section>`;
  const section = template.content.firstElementChild;
  const onceDatesRow = form.querySelector('[data-once-dates-row]');
  if (onceDatesRow) {
    onceDatesRow.appendChild(section);
  } else {
    const anchor = form.querySelector('[data-dates-section]') || form.querySelector('[data-central-info-section]');
    if (anchor?.parentNode) anchor.parentNode.insertBefore(section, anchor.nextSibling);
    else form.appendChild(section);
  }
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

function runInventoryPolish() {
  addInventoryPolishStyle();
  bindParticipantsCountUi();
  renameInventoryTab();
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
