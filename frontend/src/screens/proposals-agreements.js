import { escapeHtml } from './shared/html.js';
import { dsCard, dsEmptyState, dsPageHeader, dsScreenStack, dsTableWrap } from './shared/layout.js';
import { getActivityCatalog } from './shared/activity-options.js';

export const PROPOSALS_AGREEMENTS_ALLOWED_ROLES = new Set(['domain_manager', 'operation_manager', 'admin']);
const SEARCH_DEBOUNCE_MS = 280;

const FIELD_LABELS = {
  client_authority: 'לקוח / רשות',
  school_framework: 'בית ספר / מסגרת',
  document_type: 'סוג מסמך',
  activity_type: 'סוג פעילות',
  notes: 'הערות',
  contact_name: 'שם איש קשר',
  contact_role: 'תפקיד איש קשר',
  contact_phone: 'טלפון',
  contact_email: 'דוא״ל'
};

const REQUIRED_FIELDS = ['client_authority', 'school_framework', 'document_type', 'activity_type'];
const FORM_FIELDS = [
  'client_authority',
  'school_framework',
  'document_type',
  'activity_type',
  'contact_name',
  'contact_role',
  'contact_phone',
  'contact_email',
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
    row.activity_type,
    row.notes,
    row.contact_name,
    row.contact_role,
    row.contact_phone,
    row.contact_email
  ].map(normalizeSearch).filter(Boolean).join(' ');
}

export function normalizeProposalAgreementRow(row = {}) {
  const normalized = {
    id: text(row.id),
    client_authority: text(row.client_authority),
    school_framework: text(row.school_framework),
    document_type: text(row.document_type),
    activity_type: text(row.activity_type),
    contact_name: text(row.contact_name),
    contact_role: text(row.contact_role),
    contact_phone: text(row.contact_phone),
    contact_email: text(row.contact_email),
    notes: text(row.notes),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at)
  };
  normalized._searchText = buildProposalsAgreementsSearchText(normalized);
  return normalized;
}

function sortRows(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => (
    text(a.client_authority).localeCompare(text(b.client_authority), 'he') ||
    text(a.school_framework).localeCompare(text(b.school_framework), 'he') ||
    text(a.document_type).localeCompare(text(b.document_type), 'he') ||
    text(a.activity_type).localeCompare(text(b.activity_type), 'he')
  ));
}

function rowMatches(row, filters) {
  const q = normalizeSearch(filters.q);
  if (q && !normalizeSearch(row._searchText).includes(q)) return false;
  if (filters.document_type && text(row.document_type) !== filters.document_type) return false;
  if (filters.activity_type && text(row.activity_type) !== filters.activity_type) return false;
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
  const parts = [row.contact_name, row.contact_role, row.contact_phone, row.contact_email].map(text).filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

function detailRowsHtml(row) {
  return FORM_FIELDS.map((key) => `
    <div class="ds-pa-detail-row">
      <span class="ds-pa-detail-label">${escapeHtml(FIELD_LABELS[key])}</span>
      <span class="ds-pa-detail-value">${escapeHtml(key.startsWith('contact_') ? (row[key] || '—') : (row[key] || '—'))}</span>
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
      <td>${escapeHtml(row.activity_type || '—')}</td>
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

function formFieldHtml(key, value = '', activityOptions = []) {
  const label = FIELD_LABELS[key] || key;
  const required = REQUIRED_FIELDS.includes(key);
  const attrs = required ? ' required aria-required="true"' : '';
  const val = escapeHtml(value || '');
  if (key === 'notes') {
    return `<label class="ds-pa-form-field ds-pa-form-field--wide"><span>${escapeHtml(label)}${required ? ' *' : ''}</span><textarea class="ds-input" name="${key}" rows="3"${attrs}>${val}</textarea></label>`;
  }
  const listAttr = key === 'activity_type' ? ' list="proposalsAgreementsActivityOptions"' : '';
  const datalist = key === 'activity_type'
    ? `<datalist id="proposalsAgreementsActivityOptions">${activityOptions.map((item) => `<option value="${escapeHtml(item)}"></option>`).join('')}</datalist>`
    : '';
  return `<label class="ds-pa-form-field"><span>${escapeHtml(label)}${required ? ' *' : ''}</span><input class="ds-input ds-input--sm" name="${key}" value="${val}"${listAttr}${attrs}></label>${datalist}`;
}

function formHtml(mode, row = {}, activityOptions = []) {
  const title = mode === 'edit' ? 'עריכת רשומה' : 'הוספת הצעה / הסכם';
  return `<form class="ds-pa-form" data-pa-form data-pa-mode="${escapeHtml(mode)}" data-pa-id="${escapeHtml(row.id || '')}" dir="rtl">
    <h3>${escapeHtml(title)}</h3>
    <div class="ds-pa-form-grid">${FORM_FIELDS.map((key) => formFieldHtml(key, row[key] || '', activityOptions)).join('')}</div>
    <p class="ds-pa-form-error" data-pa-form-error role="alert"></p>
    <div class="ds-pa-form-actions">
      <button type="submit" class="ds-btn ds-btn--primary ds-btn--sm">שמירה</button>
      <button type="button" class="ds-btn ds-btn--sm" data-pa-cancel-form>ביטול</button>
    </div>
  </form>`;
}

function drawerHtml(row, activityOptions) {
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

function activityOptionsFromState(state) {
  const catalog = typeof getActivityCatalog === 'function' ? getActivityCatalog(state?.clientSettings || {}) : [];
  return Array.from(new Set(catalog.map((item) => text(item.label || item.activity_type)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'he'));
}

function displayRows(data, filters = {}) {
  return sortRows((Array.isArray(data?.rows) ? data.rows : []).map(normalizeProposalAgreementRow)).filter((row) => rowMatches(row, filters));
}

function currentFilters(root) {
  return {
    q: root.querySelector('[data-pa-search]')?.value || '',
    document_type: root.querySelector('[data-pa-filter="document_type"]')?.value || '',
    activity_type: root.querySelector('[data-pa-filter="activity_type"]')?.value || ''
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
  FORM_FIELDS.forEach((key) => { payload[key] = text(formData.get(key)); });
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
      return dsScreenStack(`${dsPageHeader('הצעות והסכמים', 'גישה מוגבלת למורשים בלבד')}${dsEmptyState('אין לך הרשאה לצפות במסך זה')}`);
    }
    const rows = displayRows(data, {});
    const rawRows = Array.isArray(data?.rows) ? data.rows.map(normalizeProposalAgreementRow) : [];
    const activityOptions = activityOptionsFromState(state);
    return dsScreenStack(`
      ${dsPageHeader('הצעות והסכמים', 'ניהול הצעות, הסכמים ופרטי קשר לרשומה')}
      <section class="ds-pa-screen" data-pa-screen dir="rtl">
        <div class="ds-pa-toolbar">
          <label class="ds-pa-search"><span>חיפוש</span><input class="ds-input ds-input--sm" data-pa-search placeholder="חיפוש מקומי" autocomplete="off"></label>
          ${filterSelectHtml('document_type', 'סוג מסמך', uniqueValues(rawRows, 'document_type'))}
          ${filterSelectHtml('activity_type', 'סוג פעילות', uniqueValues(rawRows, 'activity_type'))}
          <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-pa-add>הוספה</button>
        </div>
        <div class="ds-pa-local-status" aria-live="polite">מציג <strong data-pa-results-count>${rows.length}</strong> רשומות</div>
        <div data-pa-form-host hidden></div>
        ${dsCard({ title: 'רשומות', padded: false, body: `<div data-pa-table-region>${tableHtml(rows)}</div>` })}
        ${drawerHtml(null, activityOptions)}
      </section>
    `);
  },
  bind({ root, data, state, api }) {
    if (!root || data?.unauthorized || !canAccessProposalsAgreements(state)) return;
    data.rows = sortRows((Array.isArray(data.rows) ? data.rows : []).map(normalizeProposalAgreementRow));
    const activityOptions = activityOptionsFromState(state);
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
      formHost.innerHTML = formHtml(mode, row, activityOptions);
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
        if (drawer && row) drawer.outerHTML = drawerHtml(row, activityOptions);
        return;
      }
      if (event.target.closest?.('[data-pa-close-drawer]')) {
        const drawer = root.querySelector('[data-pa-drawer]');
        if (drawer) drawer.outerHTML = drawerHtml(null, activityOptions);
        return;
      }
      const editBtn = event.target.closest?.('[data-pa-edit-row]');
      if (editBtn) {
        const row = data.rows.find((item) => text(item.id) === text(editBtn.dataset.paEditRow));
        const host = root.querySelector('[data-pa-inline-form]');
        if (host && row) host.innerHTML = formHtml('edit', row, activityOptions);
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
          drawer.outerHTML = drawerHtml(updated, activityOptions);
        }
      } catch (err) {
        if (errorEl) errorEl.textContent = `שגיאה בשמירה: ${err?.message || err}`;
      }
    });
  }
};
