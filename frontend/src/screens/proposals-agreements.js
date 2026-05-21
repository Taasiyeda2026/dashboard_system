import { escapeHtml } from './shared/html.js';
import { dsCard, dsEmptyState, dsPageHeader, dsScreenStack, dsTableWrap } from './shared/layout.js';

export const PROPOSALS_AGREEMENTS_ALLOWED_ROLES = new Set(['domain_manager', 'operation_manager', 'admin']);
const SEARCH_DEBOUNCE_MS = 280;

const DOCUMENT_TYPE_OPTIONS = ['הצעת מחיר', 'הסכם'];
const ACTIVITY_TYPE_GROUP_OPTIONS = ['הצעה משולבת', 'פעילויות קיץ', 'שנה הבאה'];

export const STATUS_OPTIONS = ['draft', 'pending_approval', 'returned_for_changes', 'approved', 'cancelled'];
export const STATUS_LABELS = {
  draft:                'טיוטה',
  pending_approval:     'ממתין לאישור',
  returned_for_changes: 'הוחזר לתיקון',
  approved:             'מאושר',
  cancelled:            'בוטל'
};

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
  notes:               'הערות',
  status:              'סטטוס',
  approval_note:       'הערת אישור'
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
    row.email,
    row.status ? (STATUS_LABELS[row.status] || row.status) : ''
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
    phone:               text(row.phone),
    email:               text(row.email),
    notes:               text(row.notes),
    status:              STATUS_OPTIONS.includes(text(row.status)) ? text(row.status) : 'draft',
    approval_note:       text(row.approval_note),
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
  if (filters.status && text(row.status) !== filters.status) return false;
  return true;
}

function uniqueValues(rows, key) {
  return Array.from(new Set((Array.isArray(rows) ? rows : []).map((row) => text(row[key])).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'he'));
}

function optionHtml(value, selected = '', display = '') {
  const safe = escapeHtml(value);
  const label = escapeHtml(display || value);
  return `<option value="${safe}"${value === selected ? ' selected' : ''}>${label}</option>`;
}

function filterSelectHtml(key, label, values) {
  const options = ['<option value="">הכול</option>', ...values.map((value) => optionHtml(value))].join('');
  return `<label class="ds-pa-filter"><span>${escapeHtml(label)}</span><select class="ds-input ds-input--sm" data-pa-filter="${escapeHtml(key)}">${options}</select></label>`;
}

function statusFilterHtml() {
  const options = ['<option value="">הכול</option>',
    ...STATUS_OPTIONS.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(STATUS_LABELS[s] || s)}</option>`)
  ].join('');
  return `<label class="ds-pa-filter"><span>סטטוס</span><select class="ds-input ds-input--sm" data-pa-filter="status">${options}</select></label>`;
}

function statusBadgeHtml(status) {
  const label = STATUS_LABELS[status] || status || '—';
  const colorMap = {
    draft:                '#888',
    pending_approval:     '#d97706',
    returned_for_changes: '#dc2626',
    approved:             '#16a34a',
    cancelled:            '#6b7280'
  };
  const color = colorMap[status] || '#888';
  return `<span class="ds-pa-badge" style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:0.78rem;background:${color};color:#fff;white-space:nowrap">${escapeHtml(label)}</span>`;
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
  return `<section class="ds-pa-contact-section"><h4 class="ds-pa-contact-title">פרטי קשר</h4>${rows}</section>`;
}

export function proposalsAgreementsTableRowsHtml(rows) {
  if (!rows.length) {
    return `<tr class="ds-pa-empty-row"><td colspan="7">אין רשומות להצגה</td></tr>`;
  }
  return rows.map((row) => `
    <tr data-pa-row-id="${escapeHtml(row.id)}" tabindex="0">
      <td>${escapeHtml(row.client_authority || '—')}</td>
      <td>${escapeHtml(row.school_framework || '—')}</td>
      <td>${escapeHtml(row.document_type || '—')}</td>
      <td>${escapeHtml(row.activity_type_group || '—')}</td>
      <td>${escapeHtml(formatDateDisplay(row.proposal_date) || '')}</td>
      <td>${statusBadgeHtml(row.status)}</td>
      <td>${escapeHtml(row.notes || '')}</td>
    </tr>`).join('');
}

function tableHtml(rows) {
  return dsTableWrap(`
    <table class="ds-table ds-pa-table" data-pa-table>
      <thead><tr><th>לקוח / רשות</th><th>בית ספר / מסגרת</th><th>סוג מסמך</th><th>סוג פעילות</th><th>תאריך הצעה</th><th>סטטוס</th><th>הערות</th></tr></thead>
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

function activityPickerHtml(value, activityNameOptions) {
  const selectedValues = Array.isArray(value) ? value.map(text).filter(Boolean) : text(value).split(',').map(text).filter(Boolean);
  const allOptions = Array.from(new Set([...activityNameOptions, ...selectedValues])).filter(Boolean).sort((a, b) => a.localeCompare(b, 'he'));
  const label = FIELD_LABELS.activity_names;
  if (!allOptions.length) {
    return `<div class="ds-pa-form-field ds-pa-form-field--wide"><span class="ds-pa-field-label">${escapeHtml(label)}</span><p class="ds-muted" style="font-size:0.8rem;margin:2px 0">אין פעילויות זמינות ברשימה</p></div>`;
  }
  const optionsHtml = allOptions.map((v) => {
    const safe = escapeHtml(v);
    const checked = selectedValues.includes(v) ? ' checked' : '';
    return `<label class="ds-pa-activity-option"><input type="checkbox" value="${safe}"${checked}><span>${safe}</span></label>`;
  }).join('');
  return `<div class="ds-pa-form-field ds-pa-form-field--wide">
    <span class="ds-pa-field-label">${escapeHtml(label)}</span>
    <div class="ds-pa-activity-picker" data-pa-activity-picker data-required="no">
      <button type="button" class="ds-input ds-input--sm ds-pa-activity-trigger" data-pa-activity-toggle aria-expanded="false">בחרו פעילויות</button>
      <div class="ds-pa-activity-chips" data-pa-activity-chips></div>
      <div class="ds-pa-activity-dropdown" data-pa-activity-dropdown hidden>
        <input class="ds-input ds-input--sm ds-pa-activity-search" data-pa-activity-search placeholder="חיפוש פעילות..." autocomplete="off">
        <div class="ds-pa-activity-options" data-pa-activity-options>${optionsHtml}</div>
      </div>
      <div data-pa-activity-hidden-inputs></div>
    </div>
  </div>`;
}

function clientSelectHtml(contactOptions, row) {
  const seen = new Set();
  const pairs = [];
  for (const c of (Array.isArray(contactOptions) ? contactOptions : [])) {
    const key = `${text(c.authority)}||${text(c.school)}`;
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push({ authority: text(c.authority), school: text(c.school) });
    }
  }
  pairs.sort((a, b) => a.authority.localeCompare(b.authority, 'he') || a.school.localeCompare(b.school, 'he'));

  const rowAuth = text(row.client_authority);
  const rowSchool = text(row.school_framework);
  const selectedVal = rowAuth ? `${rowAuth}||${rowSchool}` : '';

  const optionsHtml = ['<option value="">— בחרו לקוח קיים —</option>',
    ...pairs.map((p) => {
      const val = `${p.authority}||${p.school}`;
      const label = p.school ? `${p.authority} — ${p.school}` : p.authority;
      return `<option value="${escapeHtml(val)}"${val === selectedVal ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    })
  ].join('');
  return `<select class="ds-input ds-input--sm" data-pa-client-select style="flex:1;min-width:0">${optionsHtml}</select>`;
}

function contactPickerHtml(contactOptions, authority, school, selectedContactName) {
  const contacts = (Array.isArray(contactOptions) ? contactOptions : []).filter(
    (c) => text(c.authority) === authority && text(c.school) === school
  );
  if (contacts.length <= 1) return '';
  const optionsHtml = ['<option value="">— בחרו איש קשר —</option>',
    ...contacts.map((c) => {
      const val = text(c.contact_name);
      const label = c.contact_role ? `${val} (${text(c.contact_role)})` : val;
      return `<option value="${escapeHtml(val)}"${val === selectedContactName ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    })
  ].join('');
  return `<label class="ds-pa-form-field"><span>בחרו איש קשר</span>
    <select class="ds-input ds-input--sm" data-pa-contact-select>${optionsHtml}</select>
  </label>`;
}

function formHtml(mode, row = {}, activityNameOptions = [], contactOptions = []) {
  const title = mode === 'edit' ? 'עריכת הצעה / הסכם' : 'יצירת הצעת מחיר / הסכם';
  const rowActivity = Array.isArray(row.activity_names) ? row.activity_names : [];
  const currentStatus = STATUS_OPTIONS.includes(text(row.status)) ? text(row.status) : 'draft';
  const initAuth = text(row.client_authority);
  const initSchool = text(row.school_framework);
  const initContact = text(row.contact_name);
  const initPickerHtml = initAuth ? contactPickerHtml(contactOptions, initAuth, initSchool, initContact) : '';

  return `<form class="ds-pa-form ds-pa-form--compact" data-pa-form data-pa-mode="${escapeHtml(mode)}" data-pa-id="${escapeHtml(row.id || '')}" dir="rtl">
    <h3 class="ds-pa-form-title">${escapeHtml(title)}</h3>

    <div class="ds-pa-form-section" style="margin-bottom:8px">
      <div class="ds-pa-client-row" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
        ${clientSelectHtml(contactOptions, row)}
        <button type="button" class="ds-btn ds-btn--sm" data-pa-new-client-toggle>+ לקוח חדש</button>
      </div>
      <div data-pa-new-client-hint hidden style="margin-bottom:4px">
        <span class="ds-muted" style="font-size:0.8rem">מלאו את שדות הלקוח / הקשר ישירות למטה</span>
      </div>
      <div data-pa-contact-picker-host>${initPickerHtml}</div>
    </div>

    <div class="ds-pa-form-grid">
      ${textField('client_authority', FIELD_LABELS.client_authority, row.client_authority, true)}
      ${textField('school_framework', FIELD_LABELS.school_framework, row.school_framework, true)}
      ${selectField('document_type', FIELD_LABELS.document_type, DOCUMENT_TYPE_OPTIONS, text(row.document_type), true)}
      ${selectField('activity_type_group', FIELD_LABELS.activity_type_group, ACTIVITY_TYPE_GROUP_OPTIONS, text(row.activity_type_group), true)}
      <label class="ds-pa-form-field"><span>${escapeHtml(FIELD_LABELS.proposal_date)}</span><input class="ds-input ds-input--sm" type="date" name="proposal_date" value="${escapeHtml(text(row.proposal_date))}"></label>
      ${textField('contact_name', FIELD_LABELS.contact_name, row.contact_name, false)}
      ${textField('contact_role', FIELD_LABELS.contact_role, row.contact_role, false)}
      ${textField('phone', FIELD_LABELS.phone, row.phone, false)}
      ${textField('email', FIELD_LABELS.email, row.email, false)}
    </div>

    ${activityPickerHtml(rowActivity, activityNameOptions)}

    <label class="ds-pa-form-field ds-pa-form-field--wide"><span>${escapeHtml(FIELD_LABELS.notes)}</span><textarea class="ds-input ds-input--sm" name="notes" rows="2">${escapeHtml(text(row.notes))}</textarea></label>

    <input type="hidden" name="status" data-pa-status-input value="${escapeHtml(currentStatus)}">
    <p class="ds-pa-form-error" data-pa-form-error role="alert"></p>
    <div class="ds-pa-form-actions">
      <button type="button" class="ds-btn ds-btn--sm" data-pa-save-draft>שמירת טיוטה</button>
      <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-pa-save-pending>שליחה לאישור</button>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-pa-cancel-form>ביטול</button>
    </div>
  </form>`;
}

function drawerActionButtons(row, state) {
  const status = text(row?.status) || 'draft';
  const role = state ? String(state?.user?.display_role || state?.user?.role || '').trim() : '';
  const isAdminRole = role === 'admin';
  const buttons = [];

  if (['draft', 'returned_for_changes'].includes(status) || isAdminRole) {
    buttons.push(`<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-pa-edit-row="${escapeHtml(row.id)}">עריכה</button>`);
  }
  if (['draft', 'returned_for_changes'].includes(status) && !isAdminRole) {
    buttons.push(`<button type="button" class="ds-btn ds-btn--sm" data-pa-status-action="pending_approval" data-pa-action-id="${escapeHtml(row.id)}">שליחה לאישור</button>`);
  }
  if (isAdminRole) {
    if (status === 'pending_approval') {
      buttons.push(`<button type="button" class="ds-btn ds-btn--sm" data-pa-status-action="approved" data-pa-action-id="${escapeHtml(row.id)}">אישור</button>`);
      buttons.push(`<button type="button" class="ds-btn ds-btn--sm" data-pa-status-action="returned_for_changes" data-pa-action-id="${escapeHtml(row.id)}">החזרה לתיקון</button>`);
    }
    if (!['cancelled', 'approved'].includes(status)) {
      buttons.push(`<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-pa-status-action="cancelled" data-pa-action-id="${escapeHtml(row.id)}">ביטול</button>`);
    }
    buttons.push(`<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-pa-delete-row="${escapeHtml(row.id)}">מחיקה</button>`);
  }
  return buttons.join('');
}

function drawerHtml(row, activityNameOptions = [], state = null) {
  if (!row) return `<aside class="ds-pa-drawer" data-pa-drawer hidden></aside>`;
  const approvalNoteHtml = text(row.approval_note) ? `
    <div class="ds-pa-detail-row">
      <span class="ds-pa-detail-label">${escapeHtml(FIELD_LABELS.approval_note)}</span>
      <span class="ds-pa-detail-value">${escapeHtml(text(row.approval_note))}</span>
    </div>` : '';

  return `<aside class="ds-pa-drawer" data-pa-drawer data-pa-drawer-id="${escapeHtml(row.id)}" aria-live="polite" dir="rtl">
    <div class="ds-pa-drawer-panel">
      <header class="ds-pa-drawer-head">
        <div><p class="ds-muted">פרטי רשומה</p><h3>${escapeHtml(row.client_authority || '—')}</h3></div>
        <button type="button" class="ds-btn ds-btn--sm" data-pa-close-drawer aria-label="סגירת פרטי רשומה">✕</button>
      </header>
      <div class="ds-pa-drawer-status" style="margin-bottom:8px">${statusBadgeHtml(row.status)}</div>
      <div class="ds-pa-detail-grid">${detailRowsHtml(row)}</div>
      ${approvalNoteHtml}
      ${contactDetailRowsHtml(row)}
      <div class="ds-pa-drawer-actions">${drawerActionButtons(row, state)}</div>
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
    activity_type_group: root.querySelector('[data-pa-filter="activity_type_group"]')?.value || '',
    status:              root.querySelector('[data-pa-filter="status"]')?.value || ''
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
  payload.status = text(formData.get('status')) || 'draft';
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
          ${statusFilterHtml()}
          <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-pa-add>הוספה</button>
        </div>
        <div class="ds-pa-local-status" aria-live="polite">מציג <strong data-pa-results-count>${rows.length}</strong> רשומות</div>
        <div data-pa-form-host hidden></div>
        ${dsCard({ title: 'רשומות', padded: false, body: `<div class="ds-pa-records-shell" data-pa-table-region>${tableHtml(rows)}</div>` })}
        ${drawerHtml(null, [], state)}
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
    const contactOptions = Array.isArray(data?.contactOptions) ? data.contactOptions : [];
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
          trigger.textContent = selected.length ? `נבחרו ${selected.length} פעילויות` : 'בחרו פעילויות';
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

    const fillContactFields = (form, contact) => {
      if (!form || !contact) return;
      const map = {
        contact_name: text(contact.contact_name),
        contact_role: text(contact.contact_role),
        phone:        text(contact.phone || contact.mobile || ''),
        email:        text(contact.email || '')
      };
      for (const [name, value] of Object.entries(map)) {
        const input = form.querySelector(`input[name="${name}"]`);
        if (input) input.value = value;
      }
    };

    const setupContactPicker = (container, form) => {
      const contactSelect = container?.querySelector?.('[data-pa-contact-select]');
      if (!contactSelect) return;
      contactSelect.addEventListener('change', () => {
        const name = contactSelect.value;
        if (!name) return;
        const contact = contactOptions.find((c) => text(c.contact_name) === name);
        if (contact) fillContactFields(form, contact);
      }, { signal });
    };

    const setupClientSelector = (container) => {
      const clientSelect = container?.querySelector?.('[data-pa-client-select]');
      if (!clientSelect) return;
      const form = clientSelect.closest('[data-pa-form]');
      if (!form) return;
      clientSelect.addEventListener('change', () => {
        const val = clientSelect.value;
        if (!val) return;
        const [authority, school] = val.split('||');
        const matches = contactOptions.filter(
          (c) => text(c.authority) === authority && text(c.school) === school
        );
        const authInput = form.querySelector('input[name="client_authority"]');
        const schoolInput = form.querySelector('input[name="school_framework"]');
        if (authInput) authInput.value = authority;
        if (schoolInput) schoolInput.value = school;
        const pickerHost = form.querySelector('[data-pa-contact-picker-host]');
        if (matches.length > 1) {
          if (pickerHost) {
            pickerHost.innerHTML = contactPickerHtml(contactOptions, authority, school, '');
            setupContactPicker(pickerHost, form);
          }
        } else {
          if (pickerHost) pickerHost.innerHTML = '';
          if (matches.length === 1) fillContactFields(form, matches[0]);
        }
      }, { signal });
    };

    const openForm = (mode, row = {}) => {
      if (!formHost) return;
      formHost.hidden = false;
      formHost.innerHTML = formHtml(mode, row, activityNameOptions, contactOptions);
      setupActivityPickers(formHost);
      setupClientSelector(formHost);
      const pickerHost = formHost.querySelector('[data-pa-contact-picker-host]');
      if (pickerHost && pickerHost.children.length) {
        setupContactPicker(pickerHost, formHost.querySelector('[data-pa-form]'));
      }
      formHost.querySelector('select,input,textarea')?.focus?.();
    };
    const closeForm = () => {
      if (!formHost) return;
      formHost.hidden = true;
      formHost.innerHTML = '';
    };

    const saveForm = async (form, statusOverride) => {
      const errorEl = form.querySelector('[data-pa-form-error]');
      if (form.dataset.saving === 'yes') return;
      form.dataset.saving = 'yes';
      const allBtns = form.querySelectorAll('button');
      allBtns.forEach((b) => { b.disabled = true; });
      const payload = payloadFromForm(form);
      if (statusOverride) payload.status = statusOverride;
      const validationError = validatePayload(payload);
      if (validationError) {
        if (errorEl) errorEl.textContent = validationError;
        form.dataset.saving = '';
        allBtns.forEach((b) => { b.disabled = false; });
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
          drawer.outerHTML = drawerHtml(updated, activityNameOptions, state);
        }
      } catch (err) {
        if (errorEl) errorEl.textContent = `שגיאה בשמירה: ${err?.message || err}`;
        form.dataset.saving = '';
        allBtns.forEach((b) => { b.disabled = false; });
      }
    };

    root.querySelector('[data-pa-add]')?.addEventListener('click', () => openForm('add'), { signal });

    root.addEventListener('click', async (event) => {
      const rowEl = event.target.closest?.('[data-pa-row-id]');
      if (rowEl) {
        closeAllActivityDropdowns();
        const row = data.rows.find((item) => text(item.id) === text(rowEl.dataset.paRowId));
        const drawer = root.querySelector('[data-pa-drawer]');
        if (drawer && row) drawer.outerHTML = drawerHtml(row, activityNameOptions, state);
        return;
      }

      if (event.target.closest?.('[data-pa-close-drawer]')) {
        const drawer = root.querySelector('[data-pa-drawer]');
        if (drawer) drawer.outerHTML = drawerHtml(null, activityNameOptions, state);
        return;
      }

      const editBtn = event.target.closest?.('[data-pa-edit-row]');
      if (editBtn) {
        const row = data.rows.find((item) => text(item.id) === text(editBtn.dataset.paEditRow));
        const host = root.querySelector('[data-pa-inline-form]');
        if (host && row) {
          host.innerHTML = formHtml('edit', row, activityNameOptions, contactOptions);
          setupActivityPickers(host);
          setupClientSelector(host);
          const pickerHost = host.querySelector('[data-pa-contact-picker-host]');
          if (pickerHost && pickerHost.children.length) {
            setupContactPicker(pickerHost, host.querySelector('[data-pa-form]'));
          }
        }
        return;
      }

      const statusActionBtn = event.target.closest?.('[data-pa-status-action]');
      if (statusActionBtn) {
        const newStatus = text(statusActionBtn.dataset.paStatusAction);
        const id = text(statusActionBtn.dataset.paActionId);
        if (!newStatus || !id) return;
        let approvalNote = '';
        if (newStatus === 'returned_for_changes') {
          approvalNote = (window.prompt('הערה לתיקון (אופציונלי):') || '').trim();
        }
        statusActionBtn.disabled = true;
        try {
          const result = await api.updateProposalAgreementStatus(id, newStatus, approvalNote);
          replaceLocalRow(data, result?.row || { id, status: newStatus, approval_note: approvalNote });
          refreshTable();
          const updated = data.rows.find((item) => text(item.id) === id);
          const drawer = root.querySelector('[data-pa-drawer]');
          if (drawer && updated) drawer.outerHTML = drawerHtml(updated, activityNameOptions, state);
        } catch (err) {
          statusActionBtn.disabled = false;
          window.alert(`שגיאה בעדכון סטטוס: ${err?.message || err}`);
        }
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

      const saveDraftBtn = event.target.closest?.('[data-pa-save-draft]');
      if (saveDraftBtn) {
        const form = saveDraftBtn.closest('[data-pa-form]');
        if (form) await saveForm(form, 'draft');
        return;
      }

      const savePendingBtn = event.target.closest?.('[data-pa-save-pending]');
      if (savePendingBtn) {
        const form = savePendingBtn.closest('[data-pa-form]');
        if (form) await saveForm(form, 'pending_approval');
        return;
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
          if (drawer) drawer.outerHTML = drawerHtml(null, activityNameOptions, state);
        } catch (err) {
          deleteBtn.disabled = false;
          window.alert(`שגיאה במחיקה: ${err?.message || err}`);
        }
        return;
      }

      if (event.target.closest?.('[data-pa-new-client-toggle]')) {
        const form = event.target.closest('[data-pa-form]');
        const hint = form?.querySelector('[data-pa-new-client-hint]');
        const clientSelect = form?.querySelector('[data-pa-client-select]');
        if (clientSelect) clientSelect.value = '';
        if (hint) hint.hidden = !hint.hidden;
        form?.querySelector('input[name="client_authority"]')?.focus();
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
      await saveForm(form, null);
    }, { signal });
  }
};
