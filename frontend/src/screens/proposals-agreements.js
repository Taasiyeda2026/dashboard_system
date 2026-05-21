import { escapeHtml } from './shared/html.js';
import { dsCard, dsEmptyState, dsPageHeader, dsScreenStack, dsTableWrap } from './shared/layout.js';

export const PROPOSALS_AGREEMENTS_ALLOWED_ROLES = new Set(['domain_manager', 'operation_manager', 'admin']);
const SEARCH_DEBOUNCE_MS = 280;

const DOCUMENT_TYPE_OPTIONS = ['הצעת מחיר', 'הסכם'];
const ACTIVITY_TYPE_GROUP_OPTIONS = ['הצעה משולבת', 'פעילויות קיץ', 'שנה הבאה'];

const FIELD_LABELS = {
  client_authority:    'לקוח / רשות',
  school_framework:    'בית ספר / מסגרת',
  document_type:       'סוג מסמך',
  activity_type_group: 'סוג פעילות',
  proposal_date:       'תאריך הצעה',
  activity_names:      'שם הפעילויות',
  contact_name:        'איש קשר',
  contact_role:        'תפקיד',
  phone:               'טלפון',
  email:               'דוא״ל',
  notes:               'הערות'
};

const REQUIRED_FIELDS = ['client_authority', 'school_framework', 'document_type', 'activity_type_group'];
const FORM_FIELDS = [
  'client_authority',
  'school_framework',
  'document_type',
  'activity_type_group',
  'proposal_date',
  'activity_names',
  'contact_name',
  'contact_role',
  'phone',
  'email',
  'notes'
];

function userRole(state) {
  return String(state?.user?.display_role || state?.user?.role || '').trim();
}

export function canAccessProposalsAgreements(state) {
  return PROPOSALS_AGREEMENTS_ALLOWED_ROLES.has(userRole(state));
}

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalizeSearch(value) {
  return text(value).toLowerCase();
}

export function buildProposalsAgreementsSearchText(row = {}) {
  return [
    row.id,
    row.client_authority,
    row.school_framework,
    row.document_type,
    row.activity_type_group,
    Array.isArray(row.activity_names) ? row.activity_names.join(' ') : row.activity_names,
    row.notes,
    row.contact_name,
    row.contact_role,
    row.phone,
    row.email
  ].map(normalizeSearch).filter(Boolean).join(' ');
}

function normalizeActivityNames(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : text(value).split(',').map(text).filter(Boolean);
}

export function normalizeProposalAgreementRow(row = {}) {
  const normalized = {
    id:                  text(row.id),
    client_authority:    text(row.client_authority),
    school_framework:    text(row.school_framework),
    document_type:       text(row.document_type),
    activity_type_group: text(row.activity_type_group),
    proposal_date:       text(row.proposal_date),
    activity_names:      normalizeActivityNames(row.activity_names),
    contact_name:        text(row.contact_name),
    contact_role:        text(row.contact_role),
    phone:               text(row.phone || row.contact_phone),
    email:               text(row.email || row.contact_email),
    notes:               text(row.notes),
    created_at:          text(row.created_at),
    updated_at:          text(row.updated_at)
  };
  normalized._searchText = buildProposalsAgreementsSearchText(normalized);
  return normalized;
}

function formatDateDisplay(iso) {
  const s = String(iso || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }
  return s;
}

function sortRows(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => (
    text(a.client_authority).localeCompare(text(b.client_authority), 'he') ||
    text(a.school_framework).localeCompare(text(b.school_framework), 'he') ||
    text(a.document_type).localeCompare(text(b.document_type), 'he') ||
    text(a.activity_type_group).localeCompare(text(b.activity_type_group), 'he')
  ));
}

function rowMatches(row, filters) {
  const q = normalizeSearch(filters.q);
  if (q && !normalizeSearch(row._searchText).includes(q)) return false;
  if (filters.document_type && text(row.document_type) !== filters.document_type) return false;
  if (filters.activity_type_group && text(row.activity_type_group) !== filters.activity_type_group) return false;
  return true;
}

function uniqueValues(rows, key) {
  return Array.from(new Set((Array.isArray(rows) ? rows : []).map((row) => text(row[key])).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'he'));
}

function optionHtml(value, selected = '') {
  const safe = escapeHtml(value);
  return `<option value="${safe}"${value === selected ? ' selected' : ''}>${safe}</option>`;
}

function filterSelectHtml(key, label, values) {
  const options = ['<option value="">הכול</option>', ...values.map((value) => optionHtml(value))].join('');
  return `<label class="ds-pa-filter"><span>${escapeHtml(label)}</span><select class="ds-input ds-input--sm" data-pa-filter="${escapeHtml(key)}">${options}</select></label>`;
}

function detailRowsHtml(row) {
  return FORM_FIELDS.map((key) => {
    if (['contact_name', 'contact_role', 'phone', 'email'].includes(key)) return '';
    let displayValue;
    if (key === 'activity_names') {
      const items = (Array.isArray(row[key]) ? row[key] : []).map(text).filter(Boolean);
      if (!items.length) return '';
      displayValue = `<ul class="ds-pa-activity-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    } else if (key === 'proposal_date') {
      displayValue = formatDateDisplay(row[key]);
    } else {
      displayValue = row[key] || '';
    }
    if (!displayValue) return '';
    return `
    <div class="ds-pa-detail-row">
      <span class="ds-pa-detail-label">${escapeHtml(FIELD_LABELS[key] || key)}</span>
      <span class="ds-pa-detail-value">${key === 'activity_names' ? displayValue : escapeHtml(displayValue)}</span>
    </div>`;
  }).join('');
}

function contactDetailRowsHtml(row = {}) {
  const contactFields = ['contact_name', 'contact_role', 'phone', 'email'];
  const rows = contactFields.map((key) => {
    const value = text(row[key]);
    if (!value) return '';
    return `
    <div class="ds-pa-detail-row">
      <span class="ds-pa-detail-label">${escapeHtml(FIELD_LABELS[key] || key)}</span>
      <span class="ds-pa-detail-value">${escapeHtml(value)}</span>
    </div>`;
  }).join('');
  if (!rows) return '';
  return `<section class="ds-pa-contact-section"><h4 class="ds-pa-contact-title">אנשי קשר</h4>${rows}</section>`;
}

export function proposalsAgreementsTableRowsHtml(rows) {
  if (!rows.length) {
    return `<tr class="ds-pa-empty-row"><td colspan="6">אין רשומות להצגה</td></tr>`;
  }
  return rows.map((row) => `
    <tr data-pa-row-id="${escapeHtml(row.id)}" tabindex="0">
      <td>${escapeHtml(row.client_authority || '—')}</td>
      <td>${escapeHtml(row.school_framework || '—')}</td>
      <td>${escapeHtml(row.document_type || '—')}</td>
      <td>${escapeHtml(row.activity_type_group || '—')}</td>
      <td>${escapeHtml(formatDateDisplay(row.proposal_date) || '')}</td>
      <td>${escapeHtml(row.notes || '')}</td>
    </tr>`).join('');
}

function tableHtml(rows) {
  return dsTableWrap(`
    <table class="ds-table ds-pa-table" data-pa-table>
      <thead><tr><th>לקוח / רשות</th><th>בית ספר / מסגרת</th><th>סוג מסמך</th><th>סוג פעילות</th><th>תאריך הצעה</th><th>הערות</th></tr></thead>
      <tbody data-pa-table-body>${proposalsAgreementsTableRowsHtml(rows)}</tbody>
    </table>
  `);
}

function selectField(key, label, options, selectedValue, required) {
  const attrs = required ? ' required aria-required="true"' : '';
  const optionsHtml = ['<option value="">— בחרו —</option>',
    ...options.map((v) => optionHtml(v, selectedValue))
  ].join('');
  return `<label class="ds-pa-form-field"><span>${escapeHtml(label)}${required ? ' *' : ''}</span><select class="ds-input ds-input--sm" name="${key}"${attrs}>${optionsHtml}</select></label>`;
}

function textField(key, label, value, required) {
  const attrs = required ? ' required aria-required="true"' : '';
  return `<label class="ds-pa-form-field"><span>${escapeHtml(label)}${required ? ' *' : ''}</span><input class="ds-input ds-input--sm" name="${key}" value="${escapeHtml(value || '')}"${attrs}></label>`;
}

function formFieldHtml(key, value = '', activityNameOptions = []) {
  const label = FIELD_LABELS[key] || key;
  const required = REQUIRED_FIELDS.includes(key);

  if (key === 'document_type') {
    return selectField(key, label, DOCUMENT_TYPE_OPTIONS, value, required);
  }
  if (key === 'activity_type_group') {
    return selectField(key, label, ACTIVITY_TYPE_GROUP_OPTIONS, value, required);
  }
  if (key === 'activity_names') {
    const selectedValues = Array.isArray(value) ? value.map(text).filter(Boolean) : text(value).split(',').map(text).filter(Boolean);
    const allOptions = Array.from(new Set([...activityNameOptions, ...selectedValues])).filter(Boolean).sort((a, b) => a.localeCompare(b, 'he'));
    if (!allOptions.length) {
      return `<label class="ds-pa-form-field ds-pa-form-field--wide"><span>${escapeHtml(label)}</span><p class="ds-muted" style="font-size:0.8rem;margin:2px 0">אין פעילויות זמינות ברשימה</p></label>`;
    }
    const optionsHtml = allOptions.map((v) => {
      const safe = escapeHtml(v);
      const checked = selectedValues.includes(v) ? ' checked' : '';
      return `<label class="ds-pa-activity-option"><input type="checkbox" value="${safe}"${checked}><span>${safe}</span></label>`;
    }).join('');
    return `<label class="ds-pa-form-field ds-pa-form-field--wide"><span>${escapeHtml(label)}${required ? ' *' : ''}</span>
      <div class="ds-pa-activity-picker" data-pa-activity-picker data-required="${required ? 'yes' : 'no'}">
        <button type="button" class="ds-input ds-input--sm ds-pa-activity-trigger" data-pa-activity-toggle aria-expanded="false">בחרו שמות פעילויות</button>
        <div class="ds-pa-activity-chips" data-pa-activity-chips></div>
        <div class="ds-pa-activity-dropdown" data-pa-activity-dropdown hidden>
          <input class="ds-input ds-input--sm ds-pa-activity-search" data-pa-activity-search placeholder="חיפוש פעילות..." autocomplete="off">
          <div class="ds-pa-activity-options" data-pa-activity-options>${optionsHtml}</div>
        </div>
        <div data-pa-activity-hidden-inputs></div>
      </div>
    </label>`;
  }
  if (key === 'proposal_date') {
    return `<label class="ds-pa-form-field"><span>${escapeHtml(label)}</span><input class="ds-input ds-input--sm" type="date" name="${key}" value="${escapeHtml(value || '')}"></label>`;
  }
  if (key === 'notes') {
    return `<label class="ds-pa-form-field ds-pa-form-field--wide"><span>${escapeHtml(label)}</span><textarea class="ds-input ds-input--sm" name="${key}" rows="2">${escapeHtml(value || '')}</textarea></label>`;
  }
  return textField(key, label, value, required);
}

function formHtml(mode, row = {}, activityNameOptions = []) {
  const title = mode === 'edit' ? 'עריכת רשומה' : 'הוספת הצעה / הסכם';
  return `<form class="ds-pa-form ds-pa-form--compact" data-pa-form data-pa-mode="${escapeHtml(mode)}" data-pa-id="${escapeHtml(row.id || '')}" dir="rtl">
    <h3 class="ds-pa-form-title">${escapeHtml(title)}</h3>
    <div class="ds-pa-form-grid">${FORM_FIELDS.map((key) => formFieldHtml(key, key === 'activity_names' ? (Array.isArray(row[key]) ? row[key] : []) : (row[key] || ''), activityNameOptions)).join('')}</div>
    <p class="ds-pa-form-error" data-pa-form-error role="alert"></p>
    <div class="ds-pa-form-actions">
      <button type="submit" class="ds-btn ds-btn--primary ds-btn--sm">שמירה</button>
      <button type="button" class="ds-btn ds-btn--sm" data-pa-cancel-form>ביטול</button>
    </div>
  </form>`;
}

function drawerHtml(row, activityNameOptions = []) {
  if (!row) return `<aside class="ds-pa-drawer" data-pa-drawer hidden></aside>`;
  return `<aside class="ds-pa-drawer" data-pa-drawer data-pa-drawer-id="${escapeHtml(row.id)}" aria-live="polite" dir="rtl">
    <div class="ds-pa-drawer-panel">
      <header class="ds-pa-drawer-head">
        <div><p class="ds-muted">פרטי רשומה</p><h3>${escapeHtml(row.client_authority || '—')}</h3></div>
        <button type="button" class="ds-btn ds-btn--sm" data-pa-close-drawer aria-label="סגירת פרטי רשומה">✕</button>
      </header>
      <div class="ds-pa-detail-grid">${detailRowsHtml(row)}</div>
      ${contactDetailRowsHtml(row)}
      <div class="ds-pa-drawer-actions">
        <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-pa-edit-row="${escapeHtml(row.id)}">עריכה</button>
        <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-pa-delete-row="${escapeHtml(row.id)}">מחיקה</button>
      </div>
      <div data-pa-inline-form></div>
    </div>
  </aside>`;
}

function dedupeById(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = text(row.id);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function displayRows(data, filters = {}) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  return dedupeById(sortRows(rows)).filter((row) => rowMatches(row, filters));
}

function currentFilters(root) {
  return {
    q:                   root.querySelector('[data-pa-search]')?.value || '',
    document_type:       root.querySelector('[data-pa-filter="document_type"]')?.value || '',
    activity_type_group: root.querySelector('[data-pa-filter="activity_type_group"]')?.value || ''
  };
}

export function updateProposalsAgreementsTableOnly(root, rows) {
  const body = root?.querySelector('[data-pa-table-body]');
  const counter = root?.querySelector('[data-pa-results-count]');
  if (body) body.innerHTML = proposalsAgreementsTableRowsHtml(rows);
  if (counter) counter.textContent = String(rows.length);
}

function payloadFromForm(form) {
  const formData = new FormData(form);
  const payload = {};
  FORM_FIELDS.forEach((key) => {
    if (key === 'activity_names') {
      const values = formData.getAll(key).map(text).filter(Boolean);
      payload[key] = Array.from(new Set(values));
      return;
    }
    payload[key] = text(formData.get(key));
  });
  return payload;
}

function validatePayload(payload) {
  const missing = REQUIRED_FIELDS.filter((key) => !text(payload[key]));
  return missing.length ? `חובה למלא: ${missing.map((key) => FIELD_LABELS[key]).join(', ')}` : '';
}

function replaceLocalRow(data, savedRow) {
  const normalized = normalizeProposalAgreementRow(savedRow);
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const idx = rows.findIndex((row) => text(row.id) === normalized.id);
  if (idx >= 0) rows[idx] = normalized;
  else rows.unshift(normalized);
  data.rows = dedupeById(sortRows(rows.map(normalizeProposalAgreementRow)));
}

export const proposalsAgreementsScreen = {
  load: ({ api, state }) => {
    if (!canAccessProposalsAgreements(state)) return { rows: [], unauthorized: true };
    return api.proposalsAgreements();
  },
  render(data = {}, { state } = {}) {
    if (data?.unauthorized || !canAccessProposalsAgreements(state)) {
      return dsScreenStack(`${dsPageHeader('הצעות', 'גישה מוגבלת למורשים בלבד')}${dsEmptyState('אין לך הרשאה לצפות במסך זה')}`);
    }
    const rows = displayRows(data, {});
    const rawRows = Array.isArray(data?.rows) ? data.rows.map(normalizeProposalAgreementRow) : [];
    return dsScreenStack(`
      ${dsPageHeader('הצעות')}
      <section class="ds-pa-screen" data-pa-screen dir="rtl">
        <div class="ds-pa-toolbar">
          <label class="ds-pa-search"><span>חיפוש</span><input class="ds-input ds-input--sm" data-pa-search placeholder="חיפוש מקומי" autocomplete="off"></label>
          ${filterSelectHtml('document_type', 'סוג מסמך', uniqueValues(rawRows, 'document_type'))}
          ${filterSelectHtml('activity_type_group', 'סוג פעילות', uniqueValues(rawRows, 'activity_type_group'))}
          <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-pa-add>הוספה</button>
        </div>
        <div class="ds-pa-local-status" aria-live="polite">מציג <strong data-pa-results-count>${rows.length}</strong> רשומות</div>
        <div data-pa-form-host hidden></div>
        ${dsCard({ title: 'רשומות', padded: false, body: `<div class="ds-pa-records-shell" data-pa-table-region>${tableHtml(rows)}</div>` })}
        ${drawerHtml(null)}
      </section>
    `);
  },
  bind({ root, data, state, api }) {
    if (!root || data?.unauthorized || !canAccessProposalsAgreements(state)) return;
    if (root._paAbort) root._paAbort.abort();
    const abortController = new AbortController();
    root._paAbort = abortController;
    const { signal } = abortController;
    const seenIds = new Set();
    data.rows = sortRows((Array.isArray(data.rows) ? data.rows : [])
      .map(normalizeProposalAgreementRow)
      .filter((r) => { const k = text(r.id); if (!k || seenIds.has(k)) return false; seenIds.add(k); return true; }));
    const activityNameOptions = Array.from(new Set((Array.isArray(data?.activityNameOptions) ? data.activityNameOptions : []).map((v) => text(v)).filter(Boolean)));
    let debounceTimer = null;

    const refreshTable = () => updateProposalsAgreementsTableOnly(root, displayRows(data, currentFilters(root)));
    const debouncedRefresh = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refreshTable, SEARCH_DEBOUNCE_MS);
    };

    root.querySelector('[data-pa-search]')?.addEventListener('input', debouncedRefresh, { signal });
    root.querySelectorAll('[data-pa-filter]').forEach((el) => el.addEventListener('change', refreshTable, { signal }));

    const formHost = root.querySelector('[data-pa-form-host]');
    const closeAllActivityDropdowns = () => {
      root.querySelectorAll('[data-pa-activity-picker]').forEach((picker) => {
        const dropdown = picker.querySelector('[data-pa-activity-dropdown]');
        const trigger = picker.querySelector('[data-pa-activity-toggle]');
        if (dropdown) dropdown.hidden = true;
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      });
    };
    const setupActivityPickers = (container) => {
      container?.querySelectorAll?.('[data-pa-activity-picker]')?.forEach((picker) => {
        const trigger = picker.querySelector('[data-pa-activity-toggle]');
        const chipsHost = picker.querySelector('[data-pa-activity-chips]');
        const dropdown = picker.querySelector('[data-pa-activity-dropdown]');
        const search = picker.querySelector('[data-pa-activity-search]');
        const optionsHost = picker.querySelector('[data-pa-activity-options]');
        const hiddenInputsHost = picker.querySelector('[data-pa-activity-hidden-inputs]');
        const checkboxes = Array.from(picker.querySelectorAll('.ds-pa-activity-option input[type="checkbox"]'));
        const sync = () => {
          const selected = checkboxes.filter((cb) => cb.checked).map((cb) => text(cb.value)).filter(Boolean);
          chipsHost.innerHTML = selected.length
            ? selected.map((item) => `<button type="button" class="ds-pa-chip" data-pa-chip-remove="${escapeHtml(item)}">${escapeHtml(item)} <span aria-hidden="true">×</span></button>`).join('')
            : '<span class="ds-muted">לא נבחרו פעילויות</span>';
          trigger.textContent = selected.length ? `נבחרו ${selected.length} פעילויות` : 'בחרו שמות פעילויות';
          hiddenInputsHost.innerHTML = selected.map((item) => `<input type="hidden" name="activity_names" value="${escapeHtml(item)}">`).join('');
        };
        sync();
        checkboxes.forEach((cb) => cb.addEventListener('change', sync, { signal }));
        search?.addEventListener('input', () => {
          const q = normalizeSearch(search.value);
          optionsHost.querySelectorAll('.ds-pa-activity-option').forEach((option) => {
            const label = normalizeSearch(option.textContent);
            option.hidden = q ? !label.includes(q) : false;
          });
        }, { signal });
      });
    };
    const openForm = (mode, row = {}) => {
      if (!formHost) return;
      formHost.hidden = false;
      formHost.innerHTML = formHtml(mode, row, activityNameOptions);
      setupActivityPickers(formHost);
      formHost.querySelector('input,textarea,select')?.focus?.();
    };
    const closeForm = () => {
      if (!formHost) return;
      formHost.hidden = true;
      formHost.innerHTML = '';
    };

    root.querySelector('[data-pa-add]')?.addEventListener('click', () => openForm('add'), { signal });
    root.addEventListener('click', async (event) => {
      const rowEl = event.target.closest?.('[data-pa-row-id]');
      if (rowEl) {
        closeAllActivityDropdowns();
        const row = data.rows.find((item) => text(item.id) === text(rowEl.dataset.paRowId));
        const drawer = root.querySelector('[data-pa-drawer]');
        if (drawer && row) drawer.outerHTML = drawerHtml(row, activityNameOptions);
        return;
      }
      if (event.target.closest?.('[data-pa-close-drawer]')) {
        const drawer = root.querySelector('[data-pa-drawer]');
        if (drawer) drawer.outerHTML = drawerHtml(null, activityNameOptions);
        return;
      }
      const editBtn = event.target.closest?.('[data-pa-edit-row]');
      if (editBtn) {
        const row = data.rows.find((item) => text(item.id) === text(editBtn.dataset.paEditRow));
        const host = root.querySelector('[data-pa-inline-form]');
        if (host && row) host.innerHTML = formHtml('edit', row, activityNameOptions);
        setupActivityPickers(host);
        return;
      }
      const toggleBtn = event.target.closest?.('[data-pa-activity-toggle]');
      if (toggleBtn) {
        const picker = toggleBtn.closest('[data-pa-activity-picker]');
        const dropdown = picker?.querySelector('[data-pa-activity-dropdown]');
        const isOpen = dropdown && !dropdown.hidden;
        closeAllActivityDropdowns();
        if (dropdown && !isOpen) {
          dropdown.hidden = false;
          toggleBtn.setAttribute('aria-expanded', 'true');
          picker.querySelector('[data-pa-activity-search]')?.focus();
        }
        return;
      }
      const chipRemoveBtn = event.target.closest?.('[data-pa-chip-remove]');
      if (chipRemoveBtn) {
        const picker = chipRemoveBtn.closest('[data-pa-activity-picker]');
        const targetValue = text(chipRemoveBtn.dataset.paChipRemove);
        const checkbox = Array.from(picker?.querySelectorAll('.ds-pa-activity-option input[type="checkbox"]') || [])
          .find((cb) => text(cb.value) === targetValue);
        if (checkbox) {
          checkbox.checked = false;
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return;
      }
      if (!event.target.closest?.('[data-pa-activity-picker]')) {
        closeAllActivityDropdowns();
      }
      const deleteBtn = event.target.closest?.('[data-pa-delete-row]');
      if (deleteBtn) {
        const id = text(deleteBtn.dataset.paDeleteRow);
        const row = data.rows.find((item) => text(item.id) === id);
        if (!row) return;
        if (!window.confirm('למחוק את ההצעה/ההסכם?')) return;
        deleteBtn.disabled = true;
        try {
          await api.deleteProposalAgreement(id);
          data.rows = dedupeById((Array.isArray(data.rows) ? data.rows : []).filter((item) => text(item.id) !== id).map(normalizeProposalAgreementRow));
          refreshTable();
          const drawer = root.querySelector('[data-pa-drawer]');
          if (drawer) drawer.outerHTML = drawerHtml(null, activityNameOptions);
        } catch (err) {
          deleteBtn.disabled = false;
          window.alert(`שגיאה במחיקה: ${err?.message || err}`);
        }
        return;
      }
      if (event.target.closest?.('[data-pa-cancel-form]')) {
        const inlineForm = event.target.closest('[data-pa-inline-form]');
        if (inlineForm) inlineForm.innerHTML = '';
        closeForm();
      }
    }, { signal });

    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const rowEl = event.target.closest?.('[data-pa-row-id]');
      if (rowEl) rowEl.click();
    }, { signal });

    root.addEventListener('submit', async (event) => {
      const form = event.target.closest?.('[data-pa-form]');
      if (!form) return;
      event.preventDefault();
      const errorEl = form.querySelector('[data-pa-form-error]');
      const submitBtn = form.querySelector('button[type="submit"]');
      if (form.dataset.saving === 'yes') return;
      form.dataset.saving = 'yes';
      if (submitBtn) submitBtn.disabled = true;
      const payload = payloadFromForm(form);
      const validationError = validatePayload(payload);
      if (validationError) {
        if (errorEl) errorEl.textContent = validationError;
        form.dataset.saving = '';
        if (submitBtn) submitBtn.disabled = false;
        return;
      }
      const mode = form.dataset.paMode;
      const id = text(form.dataset.paId);
      try {
        const result = mode === 'edit'
          ? await api.updateProposalAgreement(id, payload)
          : await api.addProposalAgreement(payload);
        replaceLocalRow(data, result?.row || { ...payload, id });
        refreshTable();
        closeForm();
        const drawer = root.querySelector('[data-pa-drawer]');
        if (drawer && mode === 'edit') {
          const updated = data.rows.find((item) => text(item.id) === id);
          drawer.outerHTML = drawerHtml(updated, activityNameOptions);
        }
      } catch (err) {
        if (errorEl) errorEl.textContent = `שגיאה בשמירה: ${err?.message || err}`;
        form.dataset.saving = '';
        if (submitBtn) submitBtn.disabled = false;
      }
    }, { signal });
  }
};
