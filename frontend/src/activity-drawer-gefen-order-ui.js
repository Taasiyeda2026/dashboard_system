import { supabase } from './supabase-client.js';

const ENHANCED_ATTR = 'data-gefen-order-ui';
const CONTROL_ATTR = 'data-gefen-order-control';
const STYLE_ID = 'activity-drawer-gefen-order-ui-styles';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeFundingName(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[״"']/g, '')
    .replace(/\s+/g, ' ');
}

function isGefenName(value) {
  const normalized = normalizeFundingName(value);
  return normalized === 'גפן' || normalized === 'gefen';
}

function exportRow(form) {
  try {
    return JSON.parse(form?.dataset?.exportRow || '{}') || {};
  } catch {
    return {};
  }
}

function activityRowId(row = {}) {
  return clean(row.row_id || row.RowID || row.rowId);
}

async function loadGefenOrderConfirmation(rowId) {
  const normalizedRowId = clean(rowId);
  if (!supabase || !normalizedRowId) return null;

  try {
    const { data, error } = await supabase
      .from('activities')
      .select('exists_in_gefen')
      .eq('row_id', normalizedRowId)
      .maybeSingle();
    if (error) throw error;
    if (!data || typeof data.exists_in_gefen !== 'boolean') return null;
    return data.exists_in_gefen;
  } catch (error) {
    console.warn('[activity-gefen-order] failed to hydrate order confirmation', error);
    return null;
  }
}

function fundingField(form) {
  return [...form.querySelectorAll('.activity-drawer-inline__field')].find((field) => (
    clean(field.querySelector('.activity-drawer-inline__label')?.textContent) === 'גורם מימון'
  )) || null;
}

function selectedFundingNames(form) {
  const nativeSelect = form.querySelector('select[name="funding_sources"][multiple]');
  if (nativeSelect) {
    return [...nativeSelect.selectedOptions].map((option) => clean(option.textContent)).filter(Boolean);
  }

  const row = exportRow(form);
  const sources = Array.isArray(row.funding_sources) ? row.funding_sources : [];
  const names = sources.map((source) => clean(source?.name)).filter(Boolean);
  if (names.length) return names;

  const field = fundingField(form);
  const viewText = clean(field?.querySelector('.activity-drawer-inline__value')?.textContent);
  return viewText.split(/[+,/]/).map(clean).filter(Boolean);
}

function hasGefenFunding(form) {
  return selectedFundingNames(form).some(isGefenName);
}

function ensureStyles(doc) {
  if (!doc?.head || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [${CONTROL_ATTR}] {
      display: none;
      grid-template-columns: minmax(0, 1fr) 112px;
      align-items: center;
      gap: 10px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid rgba(148, 163, 184, 0.28);
    }
    [data-drawer-form][data-editing="yes"] [${CONTROL_ATTR}][data-gefen-funded="yes"] {
      display: grid;
    }
    [${CONTROL_ATTR}] .activity-drawer-gefen-order__question {
      font-size: 13px;
      font-weight: 700;
      line-height: 1.35;
      color: #475569;
    }
    [${CONTROL_ATTR}] .activity-drawer-gefen-order__select {
      min-width: 0;
      width: 100%;
    }
    [${CONTROL_ATTR}] [data-gefen-exists-checkbox] {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      margin: -1px !important;
      padding: 0 !important;
      overflow: hidden !important;
      clip: rect(0 0 0 0) !important;
      white-space: nowrap !important;
      border: 0 !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    [data-drawer-form]:not([data-editing="yes"]) .activity-drawer-inline__field[data-gefen-order-confirmed="yes"] {
      background: #eefaf2;
      border-color: #8fcda2;
      box-shadow: inset 0 0 0 1px rgba(34, 139, 79, 0.12);
    }
    [data-drawer-form]:not([data-editing="yes"]) .activity-drawer-inline__field[data-gefen-order-confirmed="yes"] .activity-drawer-inline__label,
    [data-drawer-form]:not([data-editing="yes"]) .activity-drawer-inline__field[data-gefen-order-confirmed="yes"] .activity-drawer-inline__value {
      color: #166534;
    }
    @media (max-width: 720px) {
      [${CONTROL_ATTR}] {
        grid-template-columns: 1fr;
      }
    }
  `;
  doc.head.append(style);
}

function createChoiceControl(form, checkbox, field) {
  const doc = form.ownerDocument;
  // Editors keep the control inside the funding cell. Read-only drawers do not
  // have an edit host, so keep the native value in the form but never expose a
  // second visible field in view mode.
  const editHost = field.querySelector('.activity-drawer-inline__edit') || form;

  const previousHost = checkbox.closest('.activity-drawer__gefen-exists') || checkbox.parentElement;
  const control = doc.createElement('div');
  control.className = 'activity-drawer-gefen-order';
  control.setAttribute(CONTROL_ATTR, 'true');

  const question = doc.createElement('span');
  question.className = 'activity-drawer-gefen-order__question';
  question.textContent = 'האם קיימת הזמנה במערכת גפ״ן?';

  const select = doc.createElement('select');
  select.className = 'ds-input activity-drawer-gefen-order__select';
  select.setAttribute('data-gefen-order-choice', 'true');
  select.setAttribute('aria-label', 'האם קיימת הזמנה במערכת גפ״ן');
  select.innerHTML = '<option value="false">לא</option><option value="true">כן</option>';

  control.append(question, select, checkbox);
  if (previousHost && previousHost !== editHost && previousHost !== form) previousHost.remove();
  editHost.append(control);
  return { control, select };
}

function isFundingInteractionTarget(target) {
  if (!target?.matches) return false;
  return target.matches(
    'select[name="funding_sources"], [data-funding-compact-select], [data-funding-compact-remove], [data-funding-compact-add]'
  );
}

export function enhanceGefenOrderUi(form, { loadConfirmation = loadGefenOrderConfirmation } = {}) {
  if (!form || form.hasAttribute(ENHANCED_ATTR)) return false;
  const checkbox = form.querySelector('[data-gefen-exists-checkbox]');
  const field = fundingField(form);
  if (!checkbox || !field) return false;

  const row = exportRow(form);
  const rowHasConfirmation = typeof row.exists_in_gefen === 'boolean';
  if (rowHasConfirmation) checkbox.checked = row.exists_in_gefen;

  const created = createChoiceControl(form, checkbox, field);
  if (!created) return false;
  const { control, select } = created;
  ensureStyles(form.ownerDocument);

  let lastGefenFunding = hasGefenFunding(form);
  let confirmationTouched = false;

  const sync = ({ fundingChanged = false } = {}) => {
    const gefenFunding = hasGefenFunding(form);
    const editing = String(form.dataset.editing || '') === 'yes';

    if (fundingChanged && editing && gefenFunding !== lastGefenFunding) {
      // A funding transition starts a fresh order-confirmation decision. In
      // particular, removing Gefen clears a previous "yes", and adding Gefen
      // never inherits a stale confirmation from an unrelated state.
      checkbox.checked = false;
      confirmationTouched = true;
    }

    lastGefenFunding = gefenFunding;
    control.dataset.gefenFunded = gefenFunding ? 'yes' : 'no';
    select.value = checkbox.checked ? 'true' : 'false';
    field.dataset.gefenOrderConfirmed = gefenFunding && checkbox.checked ? 'yes' : 'no';
  };

  select.addEventListener('change', () => {
    confirmationTouched = true;
    checkbox.checked = select.value === 'true';
    sync();
  });

  form.addEventListener('change', (event) => {
    if (event.target === select || !isFundingInteractionTarget(event.target)) return;
    queueMicrotask(() => sync({ fundingChanged: true }));
  });

  form.addEventListener('click', (event) => {
    if (!event.target?.closest?.('[data-funding-compact-remove], [data-funding-compact-add]')) return;
    queueMicrotask(() => sync({ fundingChanged: true }));
  });

  form.addEventListener('reset', () => {
    queueMicrotask(() => {
      confirmationTouched = false;
      lastGefenFunding = hasGefenFunding(form);
      sync();
    });
  });

  form.setAttribute(ENHANCED_ATTR, 'yes');
  sync();

  // Most activity-list projections deliberately omit operational detail fields.
  // When that happens the legacy checkbox is rendered unchecked even if the
  // database says an order exists. Hydrate only the one boolean needed by this
  // drawer, and never overwrite a choice the user has already made in edit mode.
  const rowId = activityRowId(row);
  if (!rowHasConfirmation && lastGefenFunding && rowId && typeof loadConfirmation === 'function') {
    Promise.resolve(loadConfirmation(rowId)).then((confirmed) => {
      if (typeof confirmed !== 'boolean' || confirmationTouched || !hasGefenFunding(form)) return;
      checkbox.checked = confirmed;
      sync();
    }).catch((error) => {
      console.warn('[activity-gefen-order] failed to hydrate order confirmation', error);
    });
  }

  return true;
}

export { hasGefenFunding, isGefenName, loadGefenOrderConfirmation };
