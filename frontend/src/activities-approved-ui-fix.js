import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import { state } from './state.js';
import { getValidInstructorUsers, humanDisplayText } from './screens/shared/activity-options.js';

function installStyles() {
  if (document.getElementById('activities-approved-ui-fix-styles')) return;
  const style = document.createElement('style');
  style.id = 'activities-approved-ui-fix-styles';
  style.textContent = `
    #app .ds-activities-main-toolbar {
      gap: 6px !important;
      align-items: center !important;
    }
    #app .ds-activities-main-toolbar .ds-activities-search-sm {
      flex: 1 1 118px !important;
      width: 128px !important;
      min-width: 96px !important;
      max-width: 145px !important;
    }
    #app .ds-activities-main-toolbar .ds-filter-select-inline {
      flex: 1 1 88px !important;
      width: 98px !important;
      min-width: 72px !important;
      max-width: 112px !important;
      padding-inline: 7px !important;
    }
    #app .ds-activities-main-toolbar .ds-filter-select-inline[data-filter-field="activity_domain"] {
      flex: 0 0 66px !important;
      width: 66px !important;
      min-width: 66px !important;
      max-width: 66px !important;
    }
    #app .ds-activities-main-toolbar__actions {
      flex: 0 0 auto !important;
    }
    #app .ds-table--activities-list th.ds-activities-col--instructor,
    #app .ds-table--activities-list td.ds-activities-col--instructor {
      min-width: 190px !important;
      width: 190px !important;
      overflow: hidden !important;
    }
    #app .ds-table--activities-list .ds-activities-instructor-wrap,
    #app .ds-table--activities-list .ds-activities-instructor-name {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      line-height: 1.35 !important;
    }
    #app .ds-table--activities-list .ds-chip--instructor-empty {
      display: inline-flex !important;
      width: auto !important;
      min-width: 0 !important;
      color: #475569 !important;
      font-weight: 700 !important;
      white-space: nowrap !important;
    }
    #app .ds-table--activities-list .ds-activities-instructor-draft {
      display: inline-flex !important;
      align-items: center !important;
      gap: 6px !important;
      width: 100% !important;
      min-width: 0 !important;
      max-width: 100% !important;
      white-space: nowrap !important;
    }
    #app .ds-table--activities-list .ds-activities-instructor-draft__name {
      min-width: 0 !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      color: #334155 !important;
      font-weight: 700 !important;
      line-height: 1.35 !important;
    }
    #app .ds-table--activities-list .ds-activities-instructor-draft__badge {
      display: inline-flex !important;
      flex: 0 0 auto !important;
      align-items: center !important;
      padding: 2px 6px !important;
      border: 1px solid #cbd5e1 !important;
      border-radius: 999px !important;
      background: #f8fafc !important;
      color: #64748b !important;
      font-size: 11px !important;
      font-weight: 800 !important;
      line-height: 1.2 !important;
    }
    #app .ds-table--activities-list .ds-contact-popover-btn {
      display: block !important;
      width: 100% !important;
      min-width: 0 !important;
      max-width: 100% !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      text-align: right !important;
      line-height: 1.25 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      cursor: pointer !important;
    }
    #app .ds-table--activities-list .ds-contact-popover-btn > span:first-child {
      display: block !important;
      min-width: 0 !important;
      color: #334155 !important;
      font-weight: 700 !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }
    #app .ds-table--activities-list .ds-activities-contact-phone {
      display: none !important;
    }
    html.israa-main-activities-active .activity-drawer__form [data-israa-instructor-picker] {
      width: 100% !important;
      min-width: 0 !important;
    }
    .ds-modal.ds-modal--scheduling {
      width: min(430px, calc(100vw - 32px)) !important;
      max-width: 430px !important;
      min-height: 0 !important;
    }
    .ds-modal--scheduling .scheduling-workspace__activity {
      display: none !important;
    }
    .ds-modal--scheduling .scheduling-workspace,
    .ds-modal--scheduling .scheduling-workspace__requirements {
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
    }
    .ds-modal--scheduling .scheduling-workspace__fields {
      display: grid !important;
      grid-template-columns: 1fr !important;
      gap: 10px !important;
    }
    .ds-modal--scheduling .scheduling-workspace__fields label {
      display: grid !important;
      gap: 4px !important;
      margin: 0 !important;
    }
    .ds-modal--scheduling .scheduling-workspace__status:empty {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}

export function draftInstructorDisplayValue(row = {}) {
  const assignedId = String(row?.emp_id || '').trim();
  const assignedName = String(row?.instructor_name || '').trim();
  if (assignedId || assignedName) return '';
  return String(row?.draft_instructor_name || row?.draft_emp_id || '').trim();
}

function renderDraftInstructor(chip, name) {
  if (!chip || !name) return;
  const doc = chip.ownerDocument || document;
  const wrapper = doc.createElement('span');
  wrapper.className = 'ds-activities-instructor-draft';
  wrapper.title = `${name} · ממתין לאישור שיבוץ`;

  const nameEl = doc.createElement('span');
  nameEl.className = 'ds-activities-instructor-draft__name';
  nameEl.textContent = name;

  const badge = doc.createElement('span');
  badge.className = 'ds-activities-instructor-draft__badge';
  badge.textContent = 'ממתין לאישור';

  wrapper.append(nameEl, badge);
  chip.replaceWith(wrapper);
}

let draftLookupInFlight = null;
let draftLookupWarned = false;

async function patchDraftInstructorCells(root = document) {
  if (!supabase || !root?.querySelectorAll) return;
  const rows = Array.from(root.querySelectorAll('.ds-table--activities-list .ds-activities-row[data-row-id]'))
    .filter((row) => {
      const chip = row.querySelector('.ds-chip--instructor-empty');
      return chip && !chip.hasAttribute('data-assignment-state');
    });
  if (!rows.length) return;

  const rowIds = [...new Set(rows.map((row) => String(row.dataset.rowId || '').trim()).filter(Boolean))];
  if (!rowIds.length) return;

  try {
    if (!draftLookupInFlight) {
      draftLookupInFlight = (async () => {
        await waitForSupabaseAuthSession({ timeoutMs: 2500 });
        const { data, error } = await supabase
          .from('activities')
          .select('row_id,emp_id,instructor_name,draft_emp_id,draft_instructor_name')
          .in('row_id', rowIds);
        if (error) throw error;
        return Array.isArray(data) ? data : [];
      })().finally(() => {
        draftLookupInFlight = null;
      });
    }

    const activityRows = await draftLookupInFlight;
    const draftByRowId = new Map(
      activityRows
        .map((row) => [String(row?.row_id || '').trim(), draftInstructorDisplayValue(row)])
        .filter(([rowId, name]) => rowId && name)
    );

    rows.forEach((row) => {
      const rowId = String(row.dataset.rowId || '').trim();
      const name = draftByRowId.get(rowId);
      if (!name) return;
      const chip = row.querySelector('.ds-chip--instructor-empty');
      if (chip) renderDraftInstructor(chip, name);
    });
  } catch (error) {
    if (!draftLookupWarned) {
      draftLookupWarned = true;
      console.warn('[activities] draft instructor display lookup failed', error);
    }
  }
}

function isIsraaActivitiesContext() {
  return Boolean(document.documentElement?.classList?.contains('israa-main-activities-active'));
}

export function israaInstructorPickerOptions(settings = state?.clientSettings || {}) {
  const roster = getValidInstructorUsers(settings || {});
  const seen = new Set();
  return roster
    .map((user) => ({
      emp_id: String(user?.emp_id || '').trim(),
      name: humanDisplayText(user?.name || user?.full_name)
    }))
    .filter((user) => user.emp_id && user.name)
    .filter((user) => {
      if (seen.has(user.emp_id)) return false;
      seen.add(user.emp_id);
      return true;
    });
}

function patchIsraaInstructorPicker(root = document) {
  if (!isIsraaActivitiesContext() || !root?.querySelectorAll) return;
  const roster = israaInstructorPickerOptions();
  if (!roster.length) return;

  root.querySelectorAll('.activity-drawer__form[data-row-id]').forEach((form) => {
    if (form.querySelector('[data-israa-instructor-picker]')) return;
    if (form.querySelector('select[name="emp_id"]')) return;

    const teamSection = Array.from(form.querySelectorAll('.activity-drawer__section--edit-group')).find((section) => {
      const title = humanDisplayText(section.querySelector('.activity-drawer__section-title')?.textContent);
      return title === 'צוות וזמנים';
    });
    if (!teamSection) return;

    const instructorField = Array.from(teamSection.querySelectorAll('.activity-drawer__field')).find((field) => {
      const label = humanDisplayText(field.querySelector('.activity-drawer__label')?.textContent);
      return label.startsWith('מדריך/ה');
    });
    const currentView = instructorField?.querySelector('.activity-drawer__view');
    if (!instructorField || !currentView) return;

    const currentName = humanDisplayText(currentView.textContent);
    const selected = roster.find((user) => user.name === currentName) || null;
    const select = form.ownerDocument.createElement('select');
    select.className = 'ds-input';
    select.name = 'emp_id';
    select.dataset.israaInstructorPicker = 'yes';
    select.setAttribute('aria-label', 'בחירת מדריך/ה');

    const blank = form.ownerDocument.createElement('option');
    blank.value = '';
    blank.textContent = '— ללא מדריך —';
    select.appendChild(blank);

    roster.forEach((user) => {
      const option = form.ownerDocument.createElement('option');
      option.value = user.emp_id;
      option.textContent = user.name;
      if (selected?.emp_id === user.emp_id) option.selected = true;
      select.appendChild(option);
    });

    currentView.replaceWith(select);
    instructorField.dataset.israaInstructorPickerField = 'yes';
  });
}

function normalizeInstructorCells(root = document) {
  root.querySelectorAll?.('.ds-chip--instructor-empty').forEach((chip) => {
    if (chip.textContent !== 'ללא מדריך') chip.textContent = 'ללא מדריך';
    if (chip.hasAttribute('title')) chip.removeAttribute('title');
  });
  void patchDraftInstructorCells(root);
  patchIsraaInstructorPicker(document);
}

function run() {
  installStyles();
  normalizeInstructorCells(document.getElementById('app') || document);
  patchIsraaInstructorPicker(document);
}

if (typeof document !== 'undefined') {
  run();
  const app = document.getElementById('app');
  if (app && typeof MutationObserver === 'function') {
    new MutationObserver((mutations) => {
      const hasRelevantChange = mutations.some((mutation) => {
        if (mutation.type !== 'childList') return false;
        return Array.from(mutation.addedNodes).some((node) => {
          if (node.nodeType !== 1) return false;
          return node.matches?.('.ds-chip--instructor-empty')
            || Boolean(node.querySelector?.('.ds-chip--instructor-empty'));
        });
      });
      if (hasRelevantChange) normalizeInstructorCells(app);
    }).observe(app, { childList: true, subtree: true });
  }
  if (typeof MutationObserver === 'function') {
    new MutationObserver((mutations) => {
      if (!isIsraaActivitiesContext()) return;
      const hasDrawerChange = mutations.some((mutation) => {
        if (mutation.type !== 'childList') return false;
        return Array.from(mutation.addedNodes).some((node) => {
          if (node.nodeType !== 1) return false;
          return node.matches?.('.activity-drawer__form')
            || Boolean(node.querySelector?.('.activity-drawer__form'));
        });
      });
      if (hasDrawerChange) patchIsraaInstructorPicker(document);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
}
