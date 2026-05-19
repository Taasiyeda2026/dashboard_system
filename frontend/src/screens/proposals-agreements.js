import { escapeHtml } from './shared/html.js';
import { dsCard, dsEmptyState, dsPageHeader, dsScreenStack, dsTableWrap } from './shared/layout.js';

export const PROPOSALS_AGREEMENTS_ALLOWED_ROLES = new Set(['domain_manager', 'operation_manager', 'admin']);
const SEARCH_DEBOUNCE_MS = 280;

const DOCUMENT_TYPE_OPTIONS = ['הצעת מחיר', 'הסכם'];
const ACTIVITY_TYPE_GROUP_OPTIONS = ['הצעה משולבת', 'פעילויות קיץ', 'שנה הבאה'];

const FIELD_LABELS = {
  client_authority:  'לקוח / רשות',
  school_framework:  'בית ספר / מסגרת',
  document_type:     'סוג מסמך',
  activity_type_group: 'סוג פעילות',
  activity_names:    'שם הפעילויות',
  contact_name:      'שם איש קשר',
  contact_role:      'תפקיד איש קשר',
  phone:             'טלפון',
  email:             'דוא״ל',
  notes:             'הערות'
};

const REQUIRED_FIELDS = ['client_authority', 'school_framework', 'document_type', 'activity_type_group'];
const FORM_FIELDS = [
  'client_authority',
  'school_framework',
  'document_type',
  'activity_type_group',
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

function contactSummary(row) {
  const parts = [row.contact_name, row.contact_role, row.phone, row.email].map(text).filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

function detailRowsHtml(row) {
  return FORM_FIELDS.map((key) => `
    <div class="ds-pa-detail-row">
      <span class="ds-pa-detail-label">${escapeHtml(FIELD_LABELS[key] || key)}</span>
      <span class="ds-pa-detail-value">${escapeHtml(key === 'activity_names' ? ((Array.isArray(row[key]) ? row[key] : []).join(', ') || '—') : (row[key] || '—'))}</span>
    </div>`).join('');
}

export function proposalsAgreementsTableRowsHtml(rows) {
  if (!rows.length) {
    return `<tr class="ds-pa-empty-row"><td colspan="5">אין רשומות להצגה</td></tr>`;
  }
  return rows.map((row) => `
    <tr data-pa-row-id="${escapeHtml(row.id)}" tabindex="0">
      <td>${escapeHtml(row.client_authority || '—')}</td>
      <td>${escapeHtml(row.school_framework || '—')}</td>
      <td>${escapeHtml(row.document_type || '—')}</td>
      <td>${escapeHtml(row.activity_type_group || '—')}</td>
      <td class="ds-pa-notes" title="${escapeHtml(row.notes || '')}">${escapeHtml(row.notes || '—')}</td>
    </tr>`).join('');
}

function tableHtml(rows) {
  return dsTableWrap(`
    <table class="ds-table ds-pa-table" data-pa-table>
      <thead><tr><th>לקוח / רשות</th><th>בית ספר / מסגרת</th><th>סוג מסמך</th><th>סוג פעילות</th><th>הערות</th></tr></thead>
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
    const attrs = required ? ' required aria-required="true"' : '';
    const selectedValues = Array.isArray(value) ? value : text(value).split(',').map(text).filter(Boolean);
    const optionsHtml = activityNameOptions.map((v) => {
      const safe = escapeHtml(v);
      const sel = selectedValues.includes(v) ? ' selected' : '';
      return `<option value="${safe}"${sel}>${safe}</option>`;
    }).join('');
    return `<label class="ds-pa-form-field ds-pa-form-field--wide"><span>${escapeHtml(label)}${required ? ' *' : ''}</span><select class="ds-input ds-input--sm" name="${key}" multiple size="6"${attrs}>${optionsHtml}</select></label>`;
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
    <div class="ds-pa-form-grid">${FORM_FIELDS.map((key) => formFieldHtml(key, row[key] || '', activityNameOptions)).join('')}</div>
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
      <p class="ds-pa-contact-line"><span class="ds-muted">פרטי קשר:</span> ${escapeHtml(contactSummary(row))}</p>
      <div class="ds-pa-drawer-actions"><button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-pa-edit-row="${escapeHtml(row.id)}">עריכה</button></div>
      <div data-pa-inline-form></div>
    </div>
  </aside>`;
}

function displayRows(data, filters = {}) {
  return sortRows((Array.isArray(data?.rows) ? data.rows : []).map(normalizeProposalAgreementRow)).filter((row) => rowMatches(row, filters));
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
  data.rows = sortRows(rows.map(normalizeProposalAgreementRow));
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
      ${dsPageHeader('הצעות', 'ניהול הצעות, הסכמים ופרטי קשר לרשומה')}
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
    data.rows = sortRows((Array.isArray(data.rows) ? data.rows : []).map(normalizeProposalAgreementRow));
    const activityNameOptions = Array.from(new Set((Array.isArray(data?.activityNameOptions) ? data.activityNameOptions : []).map((v) => text(v)).filter(Boolean)));
    let debounceTimer = null;

    const refreshTable = () => updateProposalsAgreementsTableOnly(root, displayRows(data, currentFilters(root)));
    const debouncedRefresh = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refreshTable, SEARCH_DEBOUNCE_MS);
    };

    root.querySelector('[data-pa-search]')?.addEventListener('input', debouncedRefresh);
    root.querySelectorAll('[data-pa-filter]').forEach((el) => el.addEventListener('change', refreshTable));

    const formHost = root.querySelector('[data-pa-form-host]');
    const openForm = (mode, row = {}) => {
      if (!formHost) return;
      formHost.hidden = false;
      formHost.innerHTML = formHtml(mode, row, activityNameOptions);
      formHost.querySelector('input,textarea,select')?.focus?.();
    };
    const closeForm = () => {
      if (!formHost) return;
      formHost.hidden = true;
      formHost.innerHTML = '';
    };

    root.querySelector('[data-pa-add]')?.addEventListener('click', () => openForm('add'));
    root.addEventListener('click', async (event) => {
      const rowEl = event.target.closest?.('[data-pa-row-id]');
      if (rowEl) {
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
        return;
      }
      if (event.target.closest?.('[data-pa-cancel-form]')) {
        const inlineForm = event.target.closest('[data-pa-inline-form]');
        if (inlineForm) inlineForm.innerHTML = '';
        closeForm();
      }
    });

    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const rowEl = event.target.closest?.('[data-pa-row-id]');
      if (rowEl) rowEl.click();
    });

    root.addEventListener('submit', async (event) => {
      const form = event.target.closest?.('[data-pa-form]');
      if (!form) return;
      event.preventDefault();
      const errorEl = form.querySelector('[data-pa-form-error]');
      const payload = payloadFromForm(form);
      const validationError = validatePayload(payload);
      if (validationError) {
        if (errorEl) errorEl.textContent = validationError;
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
      }
    });
  }
};
