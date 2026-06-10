import { escapeHtml } from './shared/html.js';
import { dsCard, dsEmptyState, dsPageHeader, dsScreenStack, dsTableWrap } from './shared/layout.js';

export const PROPOSALS_AGREEMENTS_ALLOWED_ROLES = new Set(['domain_manager', 'operation_manager', 'admin', 'business_development_manager']);
export const PROPOSALS_AGREEMENTS_MANAGE_ROLES = new Set(['domain_manager', 'operation_manager', 'admin']);
const SEARCH_DEBOUNCE_MS = 280;

const ACTIVITY_TYPE_GROUP_OPTIONS = ['פעילויות קיץ', 'שנה הבאה', 'הצעה משולבת', 'קורסים', 'סדנאות', 'סיור', 'תוכניות חינוכיות', 'STEM ומייקרים', 'התנסות בתעשייה'];
const LEGACY_GROUP_MAP = {
  'קיץ תשפ״ו':                       'פעילויות קיץ',
  'שנת הלימודים תשפ״ז':              'שנה הבאה',
  'תוכניות תשפ״ז':                   'שנה הבאה',
  'קיץ תשפ״ו ושנת הלימודים תשפ״ז': 'הצעה משולבת',
  'קיץ תשפ״ו + תשפ״ז':              'הצעה משולבת'
};
const NEXT_YEAR_GROUP_LABEL = 'שנה הבאה';
const SUMMER_PROPOSAL_GROUP = 'פעילויות קיץ';
const COMBINED_GROUP_LABEL = 'הצעה משולבת';
const PROPOSAL_GROUP_FOR_TYPE = {
  [SUMMER_PROPOSAL_GROUP]: ['summer', 'קיץ', SUMMER_PROPOSAL_GROUP, 'קיץ תשפ״ו'],
  [NEXT_YEAR_GROUP_LABEL]: ['next_year', 'תשפ״ז', NEXT_YEAR_GROUP_LABEL, 'שנת הלימודים תשפ״ז', 'תוכניות תשפ״ז'],
  [COMBINED_GROUP_LABEL]:  null
};
const ITEM_TYPE_OPTIONS = ['סדנה', 'קורס', 'הדרכה', 'פעילות', 'ייעוץ', 'ליווי'];
const TEST_HOURS_REGEX = /(?:שעות\s*)?בדיק(?:ה|ות)?/i;
const SUMMER_ITEM_REGEX = /מייקרים|חדר\s*בריחה|escape[_\s-]*room/i;
const NEXT_YEAR_ITEM_REGEX = /קורס|תוכנית|תכנית|program|course/i;
const PUBLIC_BASE = import.meta.env?.BASE_URL || './';

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
  activity_type_group: 'סוג הצעה',
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

const REQUIRED_FIELDS_DRAFT = ['client_authority', 'activity_type_group'];
const REQUIRED_FIELDS_PENDING = ['client_authority', 'activity_type_group', 'proposal_date'];
const FORM_FIELDS = [
  'client_authority', 'school_framework', 'document_type', 'activity_type_group',
  'proposal_date', 'activity_names', 'contact_name', 'contact_role', 'phone', 'email', 'notes'
];

function userRole(state) {
  return String(state?.user?.display_role || state?.user?.role || '').trim();
}

function permFlag(v) { return v === true || v === 'yes' || v === 1; }

export function canAccessProposalsAgreements(state) {
  if (!state?.user) return false;
  return PROPOSALS_AGREEMENTS_ALLOWED_ROLES.has(userRole(state))
    || permFlag(state.user.view_proposals_agreements)
    || permFlag(state.user.manage_proposals_agreements)
    || (Array.isArray(state.effectiveRoutes) && state.effectiveRoutes.includes('proposals-agreements'));
}

export function canManageProposalsAgreements(state) {
  if (!state?.user) return false;
  return PROPOSALS_AGREEMENTS_MANAGE_ROLES.has(userRole(state))
    || permFlag(state.user.manage_proposals_agreements);
}

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalizeMultilineText(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeDocumentSection(section = {}) {
  return {
    ...section,
    section_key: text(section.section_key),
    section_title: text(section.section_title),
    section_body: normalizeMultilineText(section.section_body)
  };
}

function normalizeSearch(value) {
  return text(value).toLowerCase();
}

export function buildProposalsAgreementsSearchText(row = {}) {
  return [
    row.id, row.client_authority, row.school_framework, row.document_type,
    row.activity_type_group,
    Array.isArray(row.activity_names) ? row.activity_names.join(' ') : row.activity_names,
    row.notes, row.contact_name, row.contact_role, row.phone, row.email,
    row.status ? (STATUS_LABELS[row.status] || row.status) : ''
  ].map(normalizeSearch).filter(Boolean).join(' ');
}

function normalizeActivityNames(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : text(value).split(',').map(text).filter(Boolean);
}

export function normalizeProposalAgreementRow(row = {}) {
  const rawGroup = text(row.activity_type_group);
  const normalized = {
    id:                  text(row.id),
    client_authority:    text(row.client_authority),
    school_framework:    text(row.school_framework),
    document_type:       text(row.document_type) || 'הצעת מחיר',
    activity_type_group: LEGACY_GROUP_MAP[rawGroup] || rawGroup,
    proposal_date:       text(row.proposal_date),
    activity_names:      normalizeActivityNames(row.activity_names),
    contact_name:        text(row.contact_name),
    contact_role:        text(row.contact_role),
    phone:               text(row.phone),
    email:               text(row.email),
    notes:               text(row.notes),
    status:              STATUS_OPTIONS.includes(text(row.status)) ? text(row.status) : 'draft',
    approval_note:       text(row.approval_note),
    total_amount:        row.total_amount != null ? Number(row.total_amount) || null : null,
    custom_document_sections: Array.isArray(row.custom_document_sections) ? row.custom_document_sections.map(normalizeDocumentSection) : [],
    created_at:          text(row.created_at),
    updated_at:          text(row.updated_at)
  };
  normalized._searchText = buildProposalsAgreementsSearchText(normalized);
  return normalized;
}

function localDateInputValue(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

function formatCurrency(num) {
  if (num == null || num === '' || isNaN(Number(num))) return '';
  return Number(num).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function sortRows(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => (
    text(a.client_authority).localeCompare(text(b.client_authority), 'he') ||
    text(a.school_framework).localeCompare(text(b.school_framework), 'he') ||
    text(a.activity_type_group).localeCompare(text(b.activity_type_group), 'he')
  ));
}

function rowMatches(row, filters) {
  const q = normalizeSearch(filters.q);
  if (q && !normalizeSearch(row._searchText).includes(q)) return false;
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
    if (['contact_name', 'contact_role', 'phone', 'email', 'document_type'].includes(key)) return '';
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

export function proposalsAgreementsTableRowsHtml(rows, state) {
  if (!rows.length) {
    return `<tr class="ds-pa-empty-row"><td colspan="7">אין רשומות להצגה</td></tr>`;
  }
  const role = state ? String(state?.user?.display_role || state?.user?.role || '').trim() : '';
  const canManage = PROPOSALS_AGREEMENTS_MANAGE_ROLES.has(role);
  const isAdmin = role === 'admin';
  return rows.map((row) => {
    const status = text(row.status || 'draft');
    const actionBtns = [];
    actionBtns.push(`<button type="button" class="ds-btn ds-btn--xs ds-btn--ghost ds-pa-row-action" data-pa-preview="${escapeHtml(row.id)}" title="תצוגה מקדימה">צפייה</button>`);
    if (canManage && (['draft', 'returned_for_changes'].includes(status) || isAdmin)) {
      actionBtns.push(`<button type="button" class="ds-btn ds-btn--xs ds-pa-row-action" data-pa-edit-row="${escapeHtml(row.id)}" title="עריכה">עריכה</button>`);
    }
    if (isAdmin && status === 'approved') {
      actionBtns.push(`<button type="button" class="ds-btn ds-btn--xs ds-btn--ghost ds-pa-row-action" data-pa-print="${escapeHtml(row.id)}" title="הדפסה">PDF</button>`);
    }
    if (isAdmin) {
      actionBtns.push(`<button type="button" class="ds-btn ds-btn--xs ds-btn--ghost ds-pa-row-action ds-pa-row-action--danger" data-pa-delete-row="${escapeHtml(row.id)}" title="מחיקה">מחיקה</button>`);
    }
    return `
    <tr data-pa-row-id="${escapeHtml(row.id)}" tabindex="0">
      <td>${escapeHtml(row.client_authority || '—')}</td>
      <td>${escapeHtml(row.school_framework || '—')}</td>
      <td>${escapeHtml(row.activity_type_group || '—')}</td>
      <td>${escapeHtml(formatDateDisplay(row.proposal_date) || '')}</td>
      <td>${statusBadgeHtml(row.status)}</td>
      <td>${row.total_amount != null ? `₪${escapeHtml(formatCurrency(row.total_amount))}` : ''}</td>
      <td class="ds-pa-actions-cell">${actionBtns.join('')}</td>
    </tr>`;
  }).join('');
}

function tableHtml(rows, state) {
  return dsTableWrap(`
    <table class="ds-table ds-pa-table" data-pa-table>
      <thead><tr><th>לקוח / רשות</th><th>בית ספר / מסגרת</th><th>סוג הצעה</th><th>תאריך הצעה</th><th>סטטוס</th><th>סה״כ</th><th>פעולות</th></tr></thead>
      <tbody data-pa-table-body>${proposalsAgreementsTableRowsHtml(rows, state)}</tbody>
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
      const clientName = text(c.client_name) || text(c.school) || text(c.authority);
      pairs.push({ authority: text(c.authority), school: text(c.school), clientName });
    }
  }
  pairs.sort((a, b) => a.clientName.localeCompare(b.clientName, 'he') || a.authority.localeCompare(b.authority, 'he'));
  const rowAuth = text(row.client_authority);
  const rowSchool = text(row.school_framework);
  const selectedVal = rowAuth ? `${rowAuth}||${rowSchool}` : '';
  const optionsHtml = ['<option value="">— בחרו לקוח קיים —</option>',
    ...pairs.map((p) => {
      const val = `${p.authority}||${p.school}`;
      const label = p.school && p.clientName !== p.authority
        ? `${p.clientName} — ${p.authority}`
        : p.clientName;
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
      const val = contactOptionKey(c);
      const contactName = text(c.contact_name);
      const label = c.contact_role ? `${contactName} (${text(c.contact_role)})` : contactName;
      return `<option value="${escapeHtml(val)}"${text(c.contact_name) === selectedContactName || val === selectedContactName ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    })
  ].join('');
  return `<label class="ds-pa-form-field"><span>איש קשר</span>
    <select class="ds-input ds-input--sm" data-pa-contact-select>${optionsHtml}</select>
  </label>`;
}

function contactOptionKey(contact = {}) {
  return [
    text(contact.id),
    text(contact.authority),
    text(contact.school),
    text(contact.contact_name),
    text(contact.email),
    text(contact.phone || contact.mobile || '')
  ].join('||');
}

// ─── Items editor ────────────────────────────────────────────────────────────

function itemIdentityText(item = {}) {
  return [item.item_name, item.item_type, item.pricing_activity_name, item.activity_name, item.description].map(text).join(' ');
}

function isTestHoursItem(item = {}) {
  return TEST_HOURS_REGEX.test(itemIdentityText(item));
}

function pricingOptionKey(row = {}) {
  return [row.activity_no, row.activity_name, row.item_type, row.proposal_group, row.unit_duration, row.unit_price, row.sort_order].map(text).join('||');
}

function proposalGroupText(item = {}) {
  const raw = text(item.proposal_group || item.activity_type_group);
  return LEGACY_GROUP_MAP[raw] || raw;
}

function isSummerProposalItem(item = {}) {
  if (isTestHoursItem(item)) return false;
  const group = proposalGroupText(item);
  const identity = itemIdentityText(item);
  const isSummerGroup = group === SUMMER_PROPOSAL_GROUP || SUMMER_GROUP_KEYS.has(text(item.proposal_group));
  if (isSummerGroup) return true;
  return text(item.unit_duration) === '45 דקות' && SUMMER_ITEM_REGEX.test(identity);
}

function isNextYearProposalItem(item = {}) {
  if (isTestHoursItem(item)) return false;
  const group = proposalGroupText(item);
  if (group === NEXT_YEAR_GROUP_LABEL || NEXT_YEAR_GROUP_KEYS.has(text(item.proposal_group))) return true;
  if (group === SUMMER_PROPOSAL_GROUP || SUMMER_GROUP_KEYS.has(text(item.proposal_group))) return false;
  if (isSummerProposalItem(item)) return false;
  return NEXT_YEAR_ITEM_REGEX.test(itemIdentityText(item)) || !proposalGroupText(item);
}

function shouldShowGefenForItem(item = {}, contextGroup = '') {
  const group = LEGACY_GROUP_MAP[text(contextGroup)] || text(contextGroup) || proposalGroupText(item);
  if (group === SUMMER_PROPOSAL_GROUP || isSummerProposalItem({ ...item, proposal_group: group || item.proposal_group })) return false;
  return Boolean(text(item.gefen_number));
}

function buildInfoStripInnerHtml(item = {}, contextGroup = '') {
  const numVal = (v) => (v != null && v !== '' && !isNaN(Number(v))) ? Number(v) : null;
  const showGefen = shouldShowGefenForItem(item, contextGroup);
  const parts = [];

  // Gefen (annual / combined only)
  const gefenNumber = showGefen ? text(item.gefen_number) : '';
  if (gefenNumber) parts.push(`גפ״ן ${escapeHtml(gefenNumber)}`);

  // Meetings / hours (always show if present)
  const meetings = numVal(item.meetings_count);
  const hours = numVal(item.hours_count);
  if (meetings != null) parts.push(`${meetings} מפגשים`);
  if (hours != null) parts.push(`${hours} שעות`);

  // Hourly price (annual / combined only)
  if (showGefen) {
    const hourlyPrice = numVal(item.hourly_price);
    if (hourlyPrice != null && hourlyPrice > 0) parts.push(`₪${formatCurrency(hourlyPrice)} לשעה`);
  }

  // Unit price
  const unitPrice = numVal(item.unit_price);
  if (unitPrice != null && unitPrice > 0) {
    parts.push(showGefen
      ? `מחיר לקבוצה ₪${formatCurrency(unitPrice)}`
      : `₪${formatCurrency(unitPrice)}`);
  }

  if (!parts.length) return '';
  return `<span class="ds-pa-info-summary">${parts.join(' | ')}</span>`;
}

function itemRowHtml(item = {}, idx = 0, pricingOptions = [], options = {}) {
  const n = (v) => (v != null && v !== '' && !isNaN(Number(v))) ? escapeHtml(String(v)) : '';
  const calcTotal = (Number(item.quantity) || 0) && (Number(item.unit_price) || 0)
    ? String(((Number(item.quantity) || 0) * (Number(item.unit_price) || 0)).toFixed(2))
    : n(item.total_price);
  const selectedPricingKey = text(item.pricing_option_key || item.pricing_activity_no || item.activity_no || item.pricing_activity_name || item.item_name);
  const pricingSelectOptions = ['<option value="">— בחר פעילות מהרשימה —</option>', ...pricingOptions.filter((row) => !isTestHoursItem(row)).map((row, optionIdx) => {
    const value = pricingOptionKey(row, optionIdx);
    const legacySelected = selectedPricingKey && [value, text(row.activity_no), text(row.activity_name)].includes(selectedPricingKey);
    const labelParts = [row.activity_name, row.item_type, row.proposal_group].map(text).filter(Boolean);
    return `<option value="${escapeHtml(value)}"${legacySelected ? ' selected' : ''}>${escapeHtml(labelParts.join(' — ') || value)}</option>`;
  })].join('');
  const contextGroup = text(options.groupKey || item.proposal_group || '');
  const gefenValue = text(item.gefen_number);
  const hasActivity = Boolean(text(item.item_name));
  const hasExtra = Boolean(text(item.description));
  const infoStripHtml = hasActivity ? buildInfoStripInnerHtml(item, contextGroup) : '';
  return `<article class="ds-pa-item-card ds-pa-item-row" data-pa-item-row data-pa-item-idx="${idx}" data-pa-row-group="${escapeHtml(contextGroup)}">
    <div class="ds-pa-item-quick-row">
      <label class="ds-pa-item-field ds-pa-item-field--select"><span>בחירת פעילות / קורס</span><select class="ds-input ds-input--sm" name="pricing_activity_name" data-pa-pricing-select>${pricingSelectOptions}</select></label>
      <label class="ds-pa-item-field ds-pa-item-field--qty"><span>כמות קבוצות</span><input class="ds-input ds-input--sm" type="number" name="quantity" value="${n(item.quantity) || '1'}" min="0" step="any" data-pa-item-qty></label>
      <label class="ds-pa-item-field ds-pa-item-field--price"><span>מחיר יחידה</span><input class="ds-input ds-input--sm" type="number" name="unit_price" value="${n(item.unit_price)}" min="0" step="any" data-pa-item-price></label>
      <label class="ds-pa-item-field ds-pa-item-field--total ds-pa-line-total"><span>סה״כ שורה</span><output data-pa-item-total-display>${calcTotal ? `₪${formatCurrency(calcTotal)}` : '₪0'}</output><input type="hidden" name="total_price" value="${calcTotal}" data-pa-item-total></label>
      <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost ds-pa-item-remove" data-pa-remove-item aria-label="הסר שורה">✕ הסר</button>
    </div>
    <div class="ds-pa-item-info-strip" data-pa-item-info-strip${hasActivity ? '' : ' hidden'}>${infoStripHtml}</div>
    <details class="ds-pa-item-extra" data-pa-item-details${hasExtra ? ' open' : ''}>
      <summary class="ds-pa-item-extra-toggle">עריכה / הערות</summary>
      <div class="ds-pa-item-extra-body">
        <div class="ds-pa-item-grid ds-pa-item-grid--extras">
          <label class="ds-pa-item-field ds-pa-item-field--type"><span>סוג פעילות</span><input class="ds-input ds-input--sm" name="item_type" value="${escapeHtml(item.item_type || '')}" list="pa-item-type-list" placeholder="סוג"></label>
          <label class="ds-pa-item-field ds-pa-item-field--name"><span>שם פעילות / תוכנית</span><input class="ds-input ds-input--sm" name="item_name" value="${escapeHtml(item.item_name || '')}" placeholder="שם פעילות"></label>
          <label class="ds-pa-item-field"><span>מפגשים</span><input class="ds-input ds-input--sm" type="number" name="meetings_count" value="${n(item.meetings_count)}" min="0" step="1" placeholder="—"></label>
          <label class="ds-pa-item-field"><span>שעות</span><input class="ds-input ds-input--sm" type="number" name="hours_count" value="${n(item.hours_count)}" min="0" step="0.5" placeholder="—"></label>
        </div>
        <label class="ds-pa-item-field ds-pa-item-field--full"><span>הערות או התאמות</span><textarea class="ds-input ds-input--sm" name="description" rows="2" placeholder="תיאור קצר, אם נדרש">${escapeHtml(item.description || '')}</textarea></label>
      </div>
    </details>
    <input type="hidden" name="activity_no" value="${escapeHtml(item.activity_no || item.pricing_activity_no || '')}">
    <input type="hidden" name="pricing_option_key" value="${escapeHtml(item.pricing_option_key || '')}">
    <input type="hidden" name="gefen_number" value="${escapeHtml(gefenValue)}">
    <input type="hidden" name="gefen_number_display" value="${escapeHtml(gefenValue)}">
    <input type="hidden" name="unit_duration" value="${escapeHtml(item.unit_duration || '')}">
    <input type="hidden" name="hourly_price" value="${n(item.hourly_price)}">
    <input type="hidden" name="proposal_group" value="${escapeHtml(item.proposal_group || contextGroup || '')}">
  </article>`;
}

const SUMMER_GROUP_KEYS = new Set(['summer', 'קיץ', SUMMER_PROPOSAL_GROUP, 'קיץ תשפ״ו']);
const NEXT_YEAR_GROUP_KEYS = new Set(['next_year', 'תשפ״ז', NEXT_YEAR_GROUP_LABEL, 'שנת הלימודים תשפ״ז', 'תוכניות תשפ״ז']);

function isSummerItem(item) {
  return isSummerProposalItem(item);
}
function isNextYearItem(item) {
  return isNextYearProposalItem(item);
}

function combinedItemsSectionHtml(label, groupKey, items, pricingOptions, idxOffset) {
  const startItems = items.length ? items : [{ proposal_group: groupKey }];
  const rowsHtml = startItems.map((item, i) => itemRowHtml({ ...item, proposal_group: item.proposal_group || groupKey }, idxOffset + i, pricingOptions, { groupKey })).join('');
  const addLabel = groupKey === SUMMER_PROPOSAL_GROUP ? '+ הוספת פעילות קיץ' : '+ הוספת תוכנית תשפ״ז';
  return `<div class="ds-pa-items-section ds-pa-items-section--group" data-pa-items-group="${escapeHtml(groupKey)}">
    <div class="ds-pa-items-header">
      <span class="ds-pa-items-section-label">${escapeHtml(label)}</span>
      <button type="button" class="ds-btn ds-btn--xs" data-pa-add-item data-pa-add-item-group="${escapeHtml(groupKey)}">${escapeHtml(addLabel)}</button>
    </div>
    <div class="ds-pa-items-list" data-pa-items-body data-pa-items-group-body="${escapeHtml(groupKey)}">${rowsHtml}</div>
  </div>`;
}

function itemsEditorHtml(items = [], pricingOptions = [], activityTypeGroup = '') {
  const isCombined = activityTypeGroup === COMBINED_GROUP_LABEL;
  const footer = `<datalist id="pa-item-type-list">${ITEM_TYPE_OPTIONS.map((v) => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
    <div class="ds-pa-items-total-row">סה״כ כללי: <strong data-pa-grand-total></strong></div>`;

  if (isCombined) {
    const summerItems = items.filter(isSummerItem);
    const nextYearItems = items.filter(isNextYearItem);
    const unassigned = items.filter((i) => !isTestHoursItem(i) && !isSummerItem(i) && !isNextYearItem(i));
    const allSummer = [...summerItems, ...unassigned];
    const summerPricing = filterPricingByProposalType(pricingOptions, SUMMER_PROPOSAL_GROUP);
    const nextYearPricing = filterPricingByProposalType(pricingOptions, NEXT_YEAR_GROUP_LABEL);
    return `<div class="ds-pa-items-section ds-pa-items-combined">
      ${combinedItemsSectionHtml('פעילויות קיץ תשפ״ו', SUMMER_PROPOSAL_GROUP, allSummer, summerPricing, 0)}
      ${combinedItemsSectionHtml(NEXT_YEAR_GROUP_LABEL, NEXT_YEAR_GROUP_LABEL, nextYearItems, nextYearPricing, allSummer.length || 1)}
      ${footer}
    </div>`;
  }

  const startItems = items.length ? items : [{ proposal_group: activityTypeGroup }];
  const rowsHtml = startItems.map((item, idx) => itemRowHtml({ ...item, proposal_group: item.proposal_group || activityTypeGroup }, idx, pricingOptions, { groupKey: activityTypeGroup })).join('');
  return `<div class="ds-pa-items-section">
    <div class="ds-pa-items-header">
      <span style="font-size:0.76rem;color:var(--ds-color-text-muted,#64748b);font-weight:600">שורות הצעה</span>
      <button type="button" class="ds-btn ds-btn--xs" data-pa-add-item>+ הוסף שורה</button>
    </div>
    <div class="ds-pa-items-list" data-pa-items-body>${rowsHtml}</div>
    ${footer}
  </div>`;
}

function proposalSummaryHtml(totalAmount) {
  const initialTotal = Number(totalAmount) || 0;
  return `<section class="ds-pa-summary" aria-label="סיכום הצעה">
    <h4 class="ds-pa-summary-title">סיכום הצעה</h4>
    <div class="ds-pa-summary-grid">
      <div class="ds-pa-summary-item"><span class="ds-pa-summary-label">לקוח / רשות</span><strong class="ds-pa-summary-value" data-pa-summary-client>—</strong></div>
      <div class="ds-pa-summary-item"><span class="ds-pa-summary-label">סוג הצעה</span><strong class="ds-pa-summary-value" data-pa-summary-type>—</strong></div>
      <div class="ds-pa-summary-item"><span class="ds-pa-summary-label">מספר פעילויות</span><strong class="ds-pa-summary-value" data-pa-summary-count>—</strong></div>
      <div class="ds-pa-summary-item ds-pa-summary-item--total"><span class="ds-pa-summary-label">סה״כ כללי</span><strong class="ds-pa-summary-value ds-pa-summary-total-val" data-pa-summary-total>${initialTotal ? `₪${formatCurrency(initialTotal)}` : '₪0'}</strong></div>
    </div>
  </section>`;
}

function extractItemsFromForm(form) {
  return Array.from(form.querySelectorAll('[data-pa-item-row]')).map((row) => ({
    activity_no:    text(row.querySelector('[name="activity_no"]')?.value),
    pricing_activity_no: text(row.querySelector('[name="activity_no"]')?.value),
    pricing_option_key: text(row.querySelector('[name="pricing_option_key"]')?.value),
    item_name:      text(row.querySelector('[name="item_name"]')?.value),
    item_type:      text(row.querySelector('[name="item_type"]')?.value),
    gefen_number:   text(row.querySelector('[name="gefen_number"]')?.value),
    meetings_count: parseFloat(row.querySelector('[name="meetings_count"]')?.value) || null,
    hours_count:    parseFloat(row.querySelector('[name="hours_count"]')?.value) || null,
    quantity:       parseFloat(row.querySelector('[name="quantity"]')?.value) || 1,
    unit_price:     parseFloat(row.querySelector('[name="unit_price"]')?.value) || null,
    hourly_price:   parseFloat(row.querySelector('[name="hourly_price"]')?.value) || null,
    total_price:    parseFloat(row.querySelector('[data-pa-item-total]')?.value) || null,
    description:    text(row.querySelector('[name="description"]')?.value),
    unit_duration:  text(row.querySelector('[name="unit_duration"]')?.value),
    proposal_group: text(row.querySelector('[name="proposal_group"]')?.value)
  })).filter((item) => item.item_name && !isTestHoursItem(item));
}

// ─── Items summary (drawer read-only) ────────────────────────────────────────

function itemsSummaryHtml(items = []) {
  if (!Array.isArray(items) || !items.length) {
    return '<p class="ds-muted" style="font-size:0.8rem;margin:4px 0">אין שורות הצעה</p>';
  }
  const visibleSummaryItems = items.filter((item) => !isTestHoursItem(item));
  const total = visibleSummaryItems.reduce((s, i) => {
    const t = Number(i.total_price) || ((Number(i.quantity) || 1) * (Number(i.unit_price) || 0));
    return s + t;
  }, 0);
  const rows = visibleSummaryItems.map((item) => {
    const t = Number(item.total_price) || ((Number(item.quantity) || 1) * (Number(item.unit_price) || 0));
    const details = [
      text(item.activity_no) ? `מס׳ פעילות: ${text(item.activity_no)}` : '',
      text(item.gefen_number) ? `גפ״ן: ${text(item.gefen_number)}` : '',
      text(item.meetings_count) ? `מפגשים: ${text(item.meetings_count)}` : '',
      text(item.hours_count) ? `שעות: ${text(item.hours_count)}` : '',
      text(item.unit_duration) ? `משך: ${text(item.unit_duration)}` : '',
      text(item.proposal_group) ? `קבוצה: ${text(item.proposal_group)}` : '',
      text(item.description)
    ].filter(Boolean).join(' | ');
    return `<tr>
      <td>${escapeHtml(item.item_name || '')}${details ? `<div class="ds-muted" style="font-size:0.72rem">${escapeHtml(details)}</div>` : ''}</td>
      <td>${escapeHtml(item.item_type || '')}</td>
      <td>${item.quantity != null ? item.quantity : ''}</td>
      <td>${item.unit_price != null ? '₪' + formatCurrency(item.unit_price) : ''}</td>
      <td>${t ? '₪' + formatCurrency(t) : ''}</td>
    </tr>`;
  }).join('');
  return `<div class="ds-pa-items-summary">
    <h4 style="font-size:0.82rem;margin:8px 0 4px;font-weight:600">שורות הצעה</h4>
    <table class="ds-pa-items-summary-table">
      <thead><tr><th>פעילות ופרטים</th><th>סוג</th><th>כמות</th><th>מחיר יח׳</th><th>סה״כ</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size:0.83rem;margin:4px 0;text-align:start">סה״כ: <strong>₪${formatCurrency(total)}</strong></p>
  </div>`;
}

// ─── Preview document ─────────────────────────────────────────────────────────

const TEMPLATE_KEY_BY_GROUP = {
  [SUMMER_PROPOSAL_GROUP]:         'summer',
  [NEXT_YEAR_GROUP_LABEL]:         'next_year',
  [COMBINED_GROUP_LABEL]:          'combined',
  'קיץ תשפ״ו':                    'summer',
  'שנת הלימודים תשפ״ז':           'next_year',
  'תוכניות תשפ״ז':                'next_year',
  'קיץ תשפ״ו + תשפ״ז':           'combined',
  'קיץ תשפ״ו ושנת הלימודים תשפ״ז': 'combined',
  'קורסים':                       'combined',
  'סדנאות':                       'combined',
  'סיור':                         'combined',
  'תוכניות חינוכיות':             'combined',
  'STEM ומייקרים':                'combined',
  'התנסות בתעשייה':               'combined'
};

function templateBodyText(section) {
  return normalizeMultilineText(section?.section_body);
}

function proposalTitle(row) {
  const grp = LEGACY_GROUP_MAP[text(row.activity_type_group)] || text(row.activity_type_group);
  if (grp === SUMMER_PROPOSAL_GROUP) return 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו';
  if (grp === NEXT_YEAR_GROUP_LABEL) return 'הצעת מחיר לתוכניות תעשיידע | תשפ״ז';
  return 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו ושנת הלימודים תשפ״ז';
}

function sectionBodyHtml(value, options = {}) {
  return renderSectionBodyHtml(value, options);
}

function sectionHeadingText(rawTitle, fallback = '') {
  const title = text(rawTitle) || fallback;
  if (!title) return '';
  return /[:：]\s*$/.test(title) ? title : `${title}:`;
}

function proposalLineHtml(item = {}, options = {}) {
  const itemName = text(item.item_name);
  if (!itemName) return '';

  const isSummer = options.showGefen === false;
  const parts = [];

  // Gefen (שנתי / משולב בלבד)
  const gefenNumber = isSummer ? '' : text(item.gefen_number);
  if (gefenNumber) parts.push(`גפ״ן ${gefenNumber}`);

  // מפגשים / שעות
  const duration = text(item.unit_duration);
  if (duration) {
    parts.push(duration);
  } else {
    const meetings = item.meetings_count != null && item.meetings_count !== '' ? `${formatCurrency(item.meetings_count)} מפגשים` : '';
    const hours = item.hours_count != null && item.hours_count !== '' ? `${formatCurrency(item.hours_count)} שעות` : '';
    if (meetings) parts.push(meetings);
    if (hours) parts.push(hours);
  }

  // מחיר לשעה (קורסים שנתיים / משולבים בלבד)
  if (!isSummer) {
    const hourlyPrice = Number(item.hourly_price);
    if (hourlyPrice > 0) parts.push(`${formatCurrency(hourlyPrice)} ₪ לשעה`);
  }

  // מחיר וכמות
  const unitPrice = Number(item.unit_price);
  const quantity = Number(item.quantity) || 1;
  const total = Number(item.total_price) || (quantity * unitPrice);

  if (!isSummer && unitPrice > 0) {
    parts.push(`מחיר לקבוצה: ${formatCurrency(unitPrice)} ₪`);
    if (quantity > 1 && total > 0) {
      parts.push(`כמות קבוצות: ${quantity}`);
      parts.push(`סה״כ: ${formatCurrency(total)} ₪`);
    }
  } else if (total > 0) {
    if (quantity > 1 && unitPrice > 0) {
      parts.push(`מחיר יחידה: ${formatCurrency(unitPrice)} ₪`);
      parts.push(`כמות: ${quantity}`);
    }
    parts.push(`${formatCurrency(total)} ₪`);
  } else if (unitPrice > 0) {
    parts.push(`${formatCurrency(unitPrice)} ₪`);
  }

  const suffix = parts.length ? `: ${parts.join(' | ')}` : ':';
  return ` ${itemName}${suffix}`;
}

function proposalItemsListHtml(items = [], options = {}) {
  if (!Array.isArray(items) || !items.length) return '';
  const visibleItems = items.filter((item) => !isTestHoursItem(item));
  const lines = visibleItems.map((item) => proposalLineHtml(item, options)).filter(Boolean).join('\n');
  return lines ? sectionLinesHtml(lines, { alwaysBullet: true, className: 'pa-proposal-lines' }) : '';
}

function sectionHtml(title, body, className = '', options = {}) {
  return `<section class="pa-section${className ? ` ${className}` : ''}"><h3>${escapeHtml(sectionHeadingText(title))}</h3>${sectionBodyHtml(body, options)}</section>`;
}

function recipientLineHtml(...values) {
  const line = values.map(text).filter(Boolean).join(', ');
  return line ? `<p>${escapeHtml(line)}</p>` : '';
}

function recipientBlockHtml(row = {}) {
  return `<div class="pa-doc-address">
    <p><strong>לכבוד:</strong></p>
    ${recipientLineHtml(row.contact_name, row.contact_role)}
    ${recipientLineHtml(row.school_framework, row.client_authority)}
  </div>`;
}

function parseSectionBodyStructure(value, options = {}) {
  const { alwaysBullet = false } = options;
  const raw = normalizeMultilineText(value).replace(/[ \t]*שורה\s+חדשה\s*:?\s*/gi, '\n');
  if (!raw) return [];

  const stripBulletMarker = (line) => String(line || '')
    .replace(/^\s*(?:|-|·|•|▫|▪|◦|‣|–)\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .trim();

  const normalizedLines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !/^שורה\s+חדשה\s*:?$/i.test(line));

  if (alwaysBullet) {
    const items = normalizedLines.map(stripBulletMarker).filter(Boolean);
    return items.length ? [{ type: 'ul', items }] : [];
  }

  const groups = [];
  let paragraphLines = [];
  let bulletItems = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    groups.push({ type: 'p', items: [paragraphLines] });
    paragraphLines = [];
  };
  const flushBullets = () => {
    if (!bulletItems.length) return;
    groups.push({ type: 'ul', items: bulletItems });
    bulletItems = [];
  };

  for (const line of normalizedLines) {
    if (!line) {
      flushParagraph();
      flushBullets();
      continue;
    }

    const bulletMatch = line.match(/^\s*(?:-|)\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      const item = bulletMatch[1].trim();
      if (item) bulletItems.push(item);
      continue;
    }

    flushBullets();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushBullets();
  return groups;
}

function renderProposalSectionBody(body, options = {}) {
  const { className = '' } = options;
  const groups = parseSectionBodyStructure(body, options);
  if (!groups.length) return '';
  const rendered = groups.map((group) => {
    if (group.type === 'ul') {
      return `<ul>${group.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    }
    return group.items.map((lines) => `<p>${lines.map((line) => escapeHtml(line)).join('<br>')}</p>`).join('');
  }).join('');
  return `<div class="pa-section-body${className ? ` ${className}` : ''}">${rendered}</div>`;
}

function renderSectionBodyHtml(value, options = {}) {
  return renderProposalSectionBody(value, options);
}

function sectionLinesHtml(value, options = {}) {
  return renderProposalSectionBody(value, options);
}

function signatureSectionHtml(title = 'חתימה') {
  return `<section class="proposal-signature" aria-label="${escapeHtml(title)}">
    <div class="proposal-signature-line"></div>
    <div class="proposal-signature-name">עידן נחום, סמנכ"ל כספים</div>
  </section>`;
}



const TEMPLATE_INTRO_TEXT = 'תעשיידע היא עמותה חינוכית מיסודה של התאחדות התעשיינים, הפועלת לקידום החינוך הטכנולוגי בישראל. באמצעות קורסים וסדנאות בתחומי STEM, העמותה מחברת תלמידים לעולמות המדע, הטכנולוגיה, ההנדסה והתעשייה ומובילה למידה חווייתית, התנסות מעשית ופיתוח מיומנויות לעולם טכנולוגי משתנה.';

const PROPOSAL_TEMPLATE_DEFAULTS = {
  summer: [
    {
      section_key: 'intro',
      section_title: 'פתיח',
      section_body: TEMPLATE_INTRO_TEXT,
      sort_order: 10
    },
    {
      section_key: 'activity_intro',
      section_title: 'הפעילות המוצעת',
      section_body: [
        'ההצעה כוללת סדנאות מייקרים וחדרי בריחה דיגיטליים, המיועדים להפעלה במסגרת פעילות הקיץ.',
        '',
        ' ההצעה מיועדת לקבוצה של עד 20 משתתפים.',
        ' בכל סדנת מייקרים יכין כל משתתף תוצר אישי.',
        ' דף מידע המפרט את מגוון הפעילויות המוצעות מצורף להצעה זו.'
      ].join('\n'),
      sort_order: 20
    },
    {
      section_key: 'taasiyeda_responsibility',
      section_title: 'אחריות תעשיידע',
      section_body: [
        ' ביצוע הסדנאות בהתאם לתוכן חינוכי מאושר ומותאם לשכבת הגיל.',
        ' העברת הסדנאות באמצעות מדריכים מקצועיים מטעם תעשיידע.',
        ' אספקת הציוד, החומרים והאמצעים הנדרשים לקיום הסדנאות.',
        ' תיאום, ארגון וליווי שוטף של ההפעלה מול בית הספר או הגוף המזמין.'
      ].join('\n'),
      sort_order: 30
    },
    {
      section_key: 'school_responsibility',
      section_title: 'אחריות בית הספר / הגוף המזמין',
      section_body: [
        ' מינוי איש קשר לתיאום שוטף מול תעשיידע.',
        ' נוכחות איש צוות מטעם בית הספר או הגוף המזמין לאורך כל סדנה.',
        ' עדכון תעשיידע מראש בכל שינוי הנוגע ללוחות הזמנים או לתנאי ההפעלה.',
        ' העמדת מרחב מתאים לסדנה, הכולל מקרן, לוח וחיבור תקין לאינטרנט, ככל שנדרש לפי אופי הסדנה.'
      ].join('\n'),
      sort_order: 40
    },
    {
      section_key: 'payment_terms',
      section_title: 'עלות ותנאי תשלום',
      section_body: [
        ' חשבונית לתשלום תונפק עם תחילת הסדנה.',
        ' תנאי התשלום: שוטף + 30 ממועד הנפקת החשבונית.'
      ].join('\n'),
      sort_order: 50
    },
    {
      section_key: 'cancellation_terms',
      section_title: 'שינויים, ביטולים והתאמות',
      section_body: [
        ' סדנה שתבוטל על ידי בית הספר או הגוף המזמין בהתראה של פחות משני ימי עבודה, תיחשב כסדנה שהתקיימה בפועל ותחויב בהתאם.',
        ' במקרה שבו לא ניתן לקיים את הסדנה בשל הנחיות משרד החינוך, מצב חירום או נסיבות שאינן מאפשרות קיום פרונטלי, יתואם מועד חלופי לקיום הסדנה, בכפוף לזמינות הצדדים.'
      ].join('\n'),
      sort_order: 60
    },
    { section_key: 'notes', section_title: 'הערות', section_body: '', sort_order: 70 },
    { section_key: 'signature', section_title: 'חתימה', section_body: '', sort_order: 80 }
  ],
  next_year: [
    { section_key: 'intro', section_title: 'פתיח', section_body: TEMPLATE_INTRO_TEXT, sort_order: 10 },
    {
      section_key: 'activity_intro',
      section_title: 'הפעילות המוצעת',
      section_body: 'להלן הקורסים המוצעים לשנת הלימודים תשפ״ז. פירוט מלא של הקורסים מצורף כנספח להצעה זו.',
      sort_order: 20
    },
    {
      section_key: 'taasiyeda_responsibility',
      section_title: 'אחריות תעשיידע',
      section_body: [
        ' ביצוע הקורס בהתאם לסילבוס המאושר, באמצעות מדריך מקצועי מטעם תעשיידע.',
        ' אספקת חומרי ההדרכה, חומרי הפעילות והמשאבים הנדרשים לקיום הקורס.',
        ' ליווי מקצועי ותיאום שוטף מול צוות בית הספר לאורך תקופת הקורס.',
        ' קיום משוב והערכה לבחינת שביעות הרצון, איכות ההדרכה והתאמת המענה.'
      ].join('\n'),
      sort_order: 30
    },
    {
      section_key: 'school_responsibility',
      section_title: 'אחריות בית הספר',
      section_body: [
        ' מינוי איש קשר מטעם בית הספר לתיאום שוטף מול תעשיידע.',
        ' נוכחות איש צוות מטעם בית הספר לאורך כל מפגשי הקורס.',
        ' עדכון תעשיידע מראש בכל שינוי הנוגע למועדי הקורס או ללוחות הזמנים.',
        ' העמדת מרחב מתאים לקורס, הכולל מקרן, לוח וחיבור תקין לאינטרנט.'
      ].join('\n'),
      sort_order: 40
    },
    {
      section_key: 'payment_terms',
      section_title: 'עלות ותנאי תשלום',
      section_body: [
        ' התשלום עבור הקורס יחולק לשני חלקים:',
        'חשבונית ראשונה תונפק עם תחילת הקורס. חשבונית שנייה תונפק לאחר השלמת מחצית מהיקף הקורס.',
        ' כל חשבונית תשולם בתנאי שוטף + 30 ממועד הנפקתה.'
      ].join('\n'),
      sort_order: 50
    },
    {
      section_key: 'cancellation_terms',
      section_title: 'שינויים, ביטולים והתאמות',
      section_body: [
        ' במקרה של הפסקת הקורס ביוזמת בית הספר, ייגבה תשלום מלא עבור המפגשים שהתקיימו בפועל וכן 10% מעלות יתרת המפגשים שלא התקיימו.',
        ' מפגש שיבוטל על ידי בית הספר בהתראה של פחות משני ימי עבודה, ייחשב כמפגש שהתקיים בפועל ויחויב בהתאם.',
        ' במקרה של הפסקת לימודים פרונטליים בהתאם להנחיות משרד החינוך או בשל מצב חירום, הקורס יותאם ללמידה מקוונת ללא שינוי בעלות. עם חזרת הלימודים הפרונטליים, הקורס יימשך בבית הספר בהתאם לתיאום בין הצדדים.'
      ].join('\n'),
      sort_order: 60
    },
    { section_key: 'notes', section_title: 'הערות', section_body: '', sort_order: 70 },
    { section_key: 'signature', section_title: 'חתימה', section_body: '', sort_order: 80 }
  ],
  combined: [
    { section_key: 'intro', section_title: 'פתיח', section_body: TEMPLATE_INTRO_TEXT, sort_order: 10 },
    {
      section_key: 'summer_activity_intro',
      section_title: 'הפעילות המוצעת לקיץ תשפ״ו',
      section_body: [
        'ההצעה כוללת סדנאות מייקרים וחדרי בריחה דיגיטליים, המיועדים להפעלה חווייתית, מעשית ומותאמת גיל במסגרת פעילות הקיץ.',
        '',
        ' ההצעה מיועדת לקבוצה של עד 20 משתתפים.',
        ' בכל סדנת מייקרים יכין כל משתתף תוצר אישי.',
        ' דף מידע המפרט את מגוון הפעילויות המוצעות מצורף להצעה זו.'
      ].join('\n'),
      sort_order: 20
    },
    {
      section_key: 'next_year_activity_intro',
      section_title: 'הפעילות המוצעת לשנת הלימודים תשפ״ז',
      section_body: 'להלן הקורסים המוצעים לשנת הלימודים תשפ״ז. פירוט מלא של הקורסים מצורף כנספח להצעה זו.',
      sort_order: 30
    },
    {
      section_key: 'taasiyeda_responsibility',
      section_title: 'אחריות תעשיידע',
      section_body: [
        ' ביצוע הסדנה או הקורס בהתאם לתוכן המאושר, באמצעות מדריך מקצועי מטעם תעשיידע.',
        ' אספקת חומרי ההדרכה, חומרי הפעילות והמשאבים הנדרשים לקיום הסדנה או הקורס.',
        ' ליווי מקצועי ותיאום שוטף מול צוות בית הספר או הגוף המזמין לאורך תקופת ההפעלה.',
        ' קיום משוב והערכה לבחינת שביעות הרצון, איכות ההדרכה והתאמת המענה.'
      ].join('\n'),
      sort_order: 40
    },
    {
      section_key: 'school_responsibility',
      section_title: 'אחריות בית הספר / הגוף המזמין',
      section_body: [
        ' מינוי איש קשר לתיאום שוטף מול תעשיידע.',
        ' נוכחות איש צוות מטעם בית הספר או הגוף המזמין לאורך כל סדנה או מפגש.',
        ' עדכון תעשיידע מראש בכל שינוי הנוגע למועדי הפעילות או ללוחות הזמנים.',
        ' העמדת מרחב מתאים לפעילות, הכולל מקרן, לוח וחיבור תקין לאינטרנט.'
      ].join('\n'),
      sort_order: 50
    },
    {
      section_key: 'payment_terms',
      section_title: 'עלות ותנאי תשלום',
      section_body: [
        ' עבור סדנה, חשבונית לתשלום תונפק עם תחילת הסדנה.',
        ' עבור קורס, התשלום יחולק לשני חלקים:',
        'חשבונית ראשונה תונפק עם תחילת הקורס. חשבונית שנייה תונפק לאחר השלמת מחצית מהיקף הקורס.',
        ' כל חשבונית תשולם בתנאי שוטף + 30 ממועד הנפקתה.'
      ].join('\n'),
      sort_order: 60
    },
    {
      section_key: 'cancellation_terms',
      section_title: 'שינויים, ביטולים והתאמות',
      section_body: [
        ' במקרה של הפסקת קורס ביוזמת בית הספר או הגוף המזמין, ייגבה תשלום מלא עבור המפגשים שהתקיימו בפועל וכן 10% מעלות יתרת המפגשים שלא התקיימו.',
        ' סדנה או מפגש שיבוטלו על ידי בית הספר או הגוף המזמין בהתראה של פחות משני ימי עבודה, ייחשבו כפעילות שהתקיימה בפועל ויחויבו בהתאם.',
        ' במקרה של הפסקת לימודים פרונטליים בהתאם להנחיות משרד החינוך או בשל מצב חירום, קורס יותאם ללמידה מקוונת ללא שינוי בעלות. עם חזרת הלימודים הפרונטליים, הקורס יימשך בבית הספר בהתאם לתיאום בין הצדדים.',
        ' במקרה שבו לא ניתן לקיים סדנה בשל הנחיות משרד החינוך, מצב חירום או נסיבות שאינן מאפשרות קיום פרונטלי, יתואם מועד חלופי לקיום הסדנה, בכפוף לזמינות הצדדים.'
      ].join('\n'),
      sort_order: 70
    },
    { section_key: 'notes', section_title: 'הערות', section_body: '', sort_order: 80 },
    { section_key: 'signature', section_title: 'חתימה', section_body: '', sort_order: 90 }
  ]
};

function templateDefaultSections(templateKey) {
  return (PROPOSAL_TEMPLATE_DEFAULTS[templateKey] || []).map((section) => ({ ...section, template_key: templateKey }));
}

function resolveDocumentSections(row, templateSections = []) {
  const fallback = Array.isArray(templateSections) ? templateSections : [];
  const custom = Array.isArray(row?.custom_document_sections) ? row.custom_document_sections : [];
  return custom.length ? custom : fallback;
}

function documentSectionsEditorHtml(sections = [], isCustom = false) {
  const indicator = isCustom
    ? `<p class="ds-pa-doc-indicator ds-pa-doc-indicator--custom">✎ עריכה מותאמת אישית — שימוש באיפוס לתבנית המקור ימחק שינויים אלו</p>`
    : `<p class="ds-pa-doc-indicator ds-pa-doc-indicator--template">⊞ תבנית מקור — כל שינוי ייצור גרסה מותאמת אישית</p>`;
  const rows = (Array.isArray(sections) ? sections : []).map((section, idx) => `
    <label class="ds-pa-form-field ds-pa-form-field--wide">
      <span>${escapeHtml(text(section.section_title) || text(section.section_key) || `סעיף ${idx + 1}`)}</span>
      <textarea class="ds-input ds-input--sm" rows="4" data-pa-doc-body="${escapeHtml(text(section.section_key))}">${escapeHtml(String(section.section_body || ''))}</textarea>
    </label>`).join('');
  return `<div class="ds-pa-doc-editor" data-pa-doc-editor>${indicator}${rows}</div>`;
}

const STRUCTURED_SECTION_DEFAULTS = {
  taasiyeda_responsibility: [
    '· ביצוע התוכנית בהתאם לסילבוס המאושר, באמצעות מדריך מוסמך מטעמה.',
    '· אספקת חומרי ההדרכה, הציוד הנלווה וכלל המשאבים הנדרשים להפעלת התוכנית.',
    '· ליווי מקצועי ותיאום שוטף של ההפעלה מול צוות בית הספר.',
    '· ביצוע משוב לצורך הערכת שביעות רצון ושמירה על איכות ההדרכה.'
  ].join('\n'),
  school_responsibility: [
    '· מינוי אחראי לתיאום הפעילות ולקשר שוטף עם תעשיידע.',
    '· נוכחות מורה מטעם בית הספר בכל מפגשי הקורס.',
    '· עדכון מראש על כל שינוי במועדי הפעילות או בלוחות הזמנים.',
    '· העמדת כיתה מתאימה וציוד בסיסי: מקרן, לוח וחיבור תקין לאינטרנט.'
  ].join('\n'),
  payment_terms: [
    '· התשלום יחולק לשני חלקים: חשבונית ראשונה תונפק בתחילת הפעילות וחשבונית שנייה תונפק עם הגעת הפעילות למחצית היקפה.',
    '· כל חשבונית תשולם בתנאי שוטף + 30 ממועד הנפקתה.'
  ].join('\n'),
  cancellation_terms: [
    '· במקרה של הפסקת התוכנית ביוזמת בית הספר, ייגבה תשלום מלא עבור המפגשים שהתקיימו בפועל וכן 10% מעלות המפגשים שלא התקיימו.',
    '· מפגש שיבוטל על ידי בית הספר בהתראה של פחות מ-48 שעות (2 ימי עבודה), ייחשב כמפגש שבוצע בפועל ויחויב בהתאם.',
    '· במקרה של הפסקת לימודים פרונטליים, בהתאם להנחיות משרד החינוך או בשל מצב חירום, התוכנית תועבר ללמידה מקוונת ללא שינוי בעלות. עם חזרת הלימודים הפרונטליים, הפעילות תימשך בבית הספר כרגיל.',
    '· כל שינוי בהיקף הפעילות או במועדי הביצוע יתואם מראש ובכתב בין הצדדים.'
  ].join('\n')
};

function buildProposalDocumentHtml({ dateDisplay, row, introText, sections, orgResponsibility, schoolResponsibility, paymentTerms, changesCancellation, remarks, signatureHtml, sectionLinesHtml: sectionLines }) {
  return `
    <div class="proposal-document" dir="rtl">
      <div class="proposal-document-header">
        <div class="proposal-header-left">
          <img
            src="${PUBLIC_BASE}proposals/proposal-header-logo.png"
            alt="לוגו תעשיידע"
            class="proposal-logo"
            loading="eager"
            decoding="async"
            onerror="this.style.display='none';"
          >
          <div class="pa-doc-date">${escapeHtml(dateDisplay)}</div>
        </div>
      </div>
      <div class="proposal-document-body">
        ${recipientBlockHtml(row)}
        <hr class="pa-doc-divider">
        <h1 class="pa-doc-subject">${escapeHtml(proposalTitle(row))}</h1>
        ${introText ? sectionLines(introText, { className: 'pa-doc-intro' }) : ''}
        ${sections.join('')}
        ${orgResponsibility}
        ${schoolResponsibility}
        ${paymentTerms}
        ${changesCancellation}
        ${remarks}
        <div class="pa-doc-bottom">
          ${signatureHtml}
        </div>
      </div>
      <div class="proposal-document-footer">
        <img
          src="${PUBLIC_BASE}proposals/proposal-footer-logo.png"
          alt="לוגו תחתון תעשיידע"
          class="proposal-footer-logo"
          loading="lazy"
          decoding="async"
          onerror="this.style.display='none';"
        >
      </div>
    </div>`;
}

function proposalPreviewBodyHtml(row, items = [], templateSections = []) {
  const activityTypeGroup = LEGACY_GROUP_MAP[text(row.activity_type_group)] || text(row.activity_type_group);
  const templateKey = TEMPLATE_KEY_BY_GROUP[activityTypeGroup] || 'combined';
  const isSummerOnly = templateKey === 'summer';
  const isNextYearOrCombined = templateKey === 'next_year' || templateKey === 'combined';
  const dateDisplay = formatDateDisplay(row.proposal_date) || formatDateDisplay(new Date().toISOString().slice(0, 10));
  const defaultTemplateSections = templateDefaultSections(templateKey);
  const sourceTemplateSections = Array.isArray(templateSections) && templateSections.length ? templateSections : defaultTemplateSections;
  const sectionsSource = resolveDocumentSections(row, sourceTemplateSections);
  const byKey = new Map((Array.isArray(sectionsSource) ? sectionsSource : []).map((s) => [text(s.section_key), s]));
  const defaultByKey = new Map(defaultTemplateSections.map((s) => [text(s.section_key), s]));
  const sectionBody = (key, fallback = '') => templateBodyText(byKey.get(key)) || templateBodyText(defaultByKey.get(key)) || fallback;
  const sectionTitle = (key, fallback = '') => text(byKey.get(key)?.section_title) || text(defaultByKey.get(key)?.section_title) || fallback;

  const introText = sectionBody('intro', '');
  const orgResponsibility = sectionBody('taasiyeda_responsibility', STRUCTURED_SECTION_DEFAULTS.taasiyeda_responsibility);
  const schoolResponsibility = isSummerOnly
    ? sectionBody('school_responsibility', '')
    : sectionBody('school_responsibility', STRUCTURED_SECTION_DEFAULTS.school_responsibility);
  const paymentTerms = sectionBody('payment_terms', STRUCTURED_SECTION_DEFAULTS.payment_terms);
  const changesCancellation = isNextYearOrCombined
    ? sectionBody('cancellation_terms', STRUCTURED_SECTION_DEFAULTS.cancellation_terms)
    : sectionBody('cancellation_terms', '');
  const remarks = sectionBody('notes', '') || String(row.notes || '').replace(/\r\n?/g, '\n').trim();
  const activityIntro = sectionBody('activity_intro', '');
  const summerActivityIntro = sectionBody('summer_activity_intro', '');
  const nextYearActivityIntro = sectionBody('next_year_activity_intro', '');
  const itemsByGroup = Array.isArray(items) ? items.reduce((acc, item) => {
    const itemType = text(item.item_type);
    const unitDuration = text(item.unit_duration);
    const explicitGroup = LEGACY_GROUP_MAP[text(item.proposal_group || item.activity_type_group)] || text(item.proposal_group || item.activity_type_group);
    let group = explicitGroup || activityTypeGroup;
    if (activityTypeGroup === COMBINED_GROUP_LABEL && !explicitGroup) {
      if (unitDuration === '45 דקות' || SUMMER_ITEM_REGEX.test(itemIdentityText(item))) group = SUMMER_PROPOSAL_GROUP;
      else group = NEXT_YEAR_GROUP_LABEL;
    }
    if (!acc[group]) acc[group] = [];
    acc[group].push(item);
    return acc;
  }, {}) : {};

  const sections = [];
  if (activityTypeGroup === COMBINED_GROUP_LABEL) {
    const summerBlock = `${summerActivityIntro ? sectionBodyHtml(summerActivityIntro) : ''}${proposalItemsListHtml(itemsByGroup[SUMMER_PROPOSAL_GROUP] || [], { showGefen: false })}`;
    const nextYearBlock = `${nextYearActivityIntro ? sectionBodyHtml(nextYearActivityIntro) : ''}${proposalItemsListHtml(itemsByGroup[NEXT_YEAR_GROUP_LABEL] || itemsByGroup['תוכניות תשפ״ז'] || [], { showGefen: true })}`;
    if (summerBlock) sections.push(`<section class="pa-section"><h3>${escapeHtml(sectionHeadingText(sectionTitle('summer_activity_intro', 'הפעילות המוצעת לקיץ תשפ״ו')))}</h3>${summerBlock}</section>`);
    if (nextYearBlock) sections.push(`<section class="pa-section"><h3>${escapeHtml(sectionHeadingText(sectionTitle('next_year_activity_intro', 'הפעילות המוצעת לשנת הלימודים תשפ״ז')))}</h3>${nextYearBlock}</section>`);
  } else {
    const activityBlock = `${activityIntro ? sectionBodyHtml(activityIntro) : ''}${proposalItemsListHtml(itemsByGroup[activityTypeGroup] || items, { showGefen: activityTypeGroup !== SUMMER_PROPOSAL_GROUP })}`;
    if (activityBlock) sections.push(`<section class="pa-section"><h3>${escapeHtml(sectionHeadingText(sectionTitle('activity_intro', 'הפעילות המוצעת')))}</h3>${activityBlock}</section>`);
  }

  return buildProposalDocumentHtml({
    dateDisplay,
    row,
    introText,
    sections,
    orgResponsibility: orgResponsibility ? sectionHtml(sectionTitle('taasiyeda_responsibility', 'אחריות תעשיידע'), orgResponsibility, '', { alwaysBullet: true }) : '',
    schoolResponsibility: schoolResponsibility ? sectionHtml(sectionTitle('school_responsibility', 'אחריות בית הספר'), schoolResponsibility, '', { alwaysBullet: true }) : '',
    paymentTerms: paymentTerms ? sectionHtml(sectionTitle('payment_terms', 'עלות ותנאי תשלום'), paymentTerms, '', { alwaysBullet: true }) : '',
    changesCancellation: changesCancellation ? sectionHtml(sectionTitle('cancellation_terms', 'שינויים, ביטולים והתאמות'), changesCancellation, '', { alwaysBullet: true }) : '',
    remarks: remarks ? sectionHtml(sectionTitle('notes', 'הערות'), remarks) : '',
    signatureHtml: signatureSectionHtml(sectionTitle('signature', 'חתימה')),
    sectionLinesHtml,
  });
}

// ─── Form ─────────────────────────────────────────────────────────────────────

// ─── Client dedup helpers ─────────────────────────────────────────────────────

function normalizeForDedup(str) {
  return text(str).toLowerCase()
    .replace(/['"׳״']/g, '')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findSimilarClients(contactOptions, authority, school) {
  const normAuth = normalizeForDedup(authority);
  if (!normAuth) return [];
  return (Array.isArray(contactOptions) ? contactOptions : []).reduce((acc, c) => {
    const cAuth = normalizeForDedup(c.authority);
    if (!cAuth) return acc;
    const authMatch = cAuth === normAuth || cAuth.includes(normAuth) || normAuth.includes(cAuth);
    if (!authMatch) return acc;
    const normSchool = normalizeForDedup(school);
    const cSchool = normalizeForDedup(c.school);
    if (normSchool && cSchool && cSchool !== normSchool) return acc;
    const key = `${text(c.authority)}||${text(c.school)}`;
    if (!acc._seen.has(key)) { acc._seen.add(key); acc.push(c); }
    return acc;
  }, Object.assign([], { _seen: new Set() }));
}

function pricingMatchesGroup(row, activityTypeGroup) {
  if (isTestHoursItem(row)) return false;
  const normalizedGroup = LEGACY_GROUP_MAP[text(activityTypeGroup)] || text(activityTypeGroup);
  if (normalizedGroup === SUMMER_PROPOSAL_GROUP) return isSummerProposalItem(row);
  if (normalizedGroup === NEXT_YEAR_GROUP_LABEL) return isNextYearProposalItem(row);
  if (normalizedGroup === COMBINED_GROUP_LABEL) return isSummerProposalItem(row) || isNextYearProposalItem(row);
  return true;
}

function filterPricingByProposalType(pricingOptions, activityTypeGroup) {
  return (Array.isArray(pricingOptions) ? pricingOptions : []).filter((row) => pricingMatchesGroup(row, activityTypeGroup));
}

function filterItemsByProposalType(items, activityTypeGroup) {
  const normalizedGroup = LEGACY_GROUP_MAP[text(activityTypeGroup)] || text(activityTypeGroup);
  const sourceItems = Array.isArray(items) ? items : [];
  if (normalizedGroup === SUMMER_PROPOSAL_GROUP) return sourceItems.filter(isSummerProposalItem).map((item) => ({ ...item, proposal_group: SUMMER_PROPOSAL_GROUP, gefen_number: '' }));
  if (normalizedGroup === NEXT_YEAR_GROUP_LABEL) return sourceItems.filter(isNextYearProposalItem).map((item) => ({ ...item, proposal_group: NEXT_YEAR_GROUP_LABEL }));
  if (normalizedGroup === COMBINED_GROUP_LABEL) return sourceItems.filter((item) => !isTestHoursItem(item));
  return sourceItems;
}

const TEMPLATE_LABELS = {
  'קיץ תשפ״ו':         'תבנית נטענת: הצעת קיץ תשפ״ו',
  [NEXT_YEAR_GROUP_LABEL]: 'תבנית נטענת: הצעת שנת הלימודים תשפ״ז',
  [COMBINED_GROUP_LABEL]:  'תבנית נטענת: הצעה משולבת קיץ תשפ״ו ושנת הלימודים תשפ״ז',
};

function templateIndicatorHtml(group) {
  const label = TEMPLATE_LABELS[group] || '';
  if (!label) return `<p class="ds-pa-template-indicator" data-pa-template-indicator></p>`;
  return `<p class="ds-pa-template-indicator ds-pa-template-indicator--active" data-pa-template-indicator>${escapeHtml(label)}</p>`;
}

function clientLockedBannerHtml(auth, school, contactName, contactRole, phone, email, clientName = '') {
  if (!auth && !clientName) return '';
  const displayName = clientName || school || auth;
  return `<div class="ds-pa-client-locked">
    <p class="ds-pa-client-locked-state">לקוח נבחר</p>
    <div class="ds-pa-client-locked-body">
      <strong class="ds-pa-client-locked-name">${escapeHtml(displayName)}</strong>
      ${school && school !== displayName ? `<span class="ds-pa-client-locked-detail">מסגרת: ${escapeHtml(school)}</span>` : ''}
      ${auth && auth !== displayName ? `<span class="ds-pa-client-locked-detail">רשות: ${escapeHtml(auth)}</span>` : ''}
      ${contactName ? `<span class="ds-pa-client-locked-detail">איש קשר: ${escapeHtml(contactName)}</span>` : ''}
      ${contactRole ? `<span class="ds-pa-client-locked-detail">תפקיד: ${escapeHtml(contactRole)}</span>` : ''}
      ${phone ? `<span class="ds-pa-client-locked-detail">טלפון: ${escapeHtml(phone)}</span>` : ''}
      ${email ? `<span class="ds-pa-client-locked-detail">דוא״ל: ${escapeHtml(email)}</span>` : ''}
    </div>
    <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-pa-unlock-client>שינוי לקוח</button>
  </div>`;
}

function contactMatchesProposalRow(contact = {}, row = {}) {
  const authorityMatch = text(contact.authority) === text(row.client_authority);
  const schoolMatch = text(contact.school) === text(row.school_framework);
  const nameMatch = text(contact.contact_name) === text(row.contact_name);
  const emailMatch = text(contact.email) && text(contact.email) === text(row.email);
  const phoneMatch = text(contact.phone || contact.mobile || '') && text(contact.phone || contact.mobile || '') === text(row.phone);
  return Boolean((emailMatch || phoneMatch || (authorityMatch && schoolMatch && nameMatch)) && (nameMatch || emailMatch || phoneMatch));
}

function findContactForProposalRow(contactOptions = [], row = {}) {
  return (Array.isArray(contactOptions) ? contactOptions : []).find((contact) => contactMatchesProposalRow(contact, row)) || null;
}

function contactSourceInputsHtml(contact = {}) {
  const source = contact || {};
  return `
    <input type="hidden" name="contact_source_id" value="${escapeHtml(text(source.id))}">
    <input type="hidden" name="contact_source_authority" value="${escapeHtml(text(source.authority))}">
    <input type="hidden" name="contact_source_school" value="${escapeHtml(text(source.school))}">
    <input type="hidden" name="contact_source_name" value="${escapeHtml(text(source.contact_name))}">
    <input type="hidden" name="contact_source_role" value="${escapeHtml(text(source.contact_role))}">
    <input type="hidden" name="contact_source_phone" value="${escapeHtml(text(source.phone || source.mobile || ''))}">
    <input type="hidden" name="contact_source_email" value="${escapeHtml(text(source.email))}">`;
}

function showValidationNotice(form, errors, isPending) {
  const noticeEl = form.querySelector('[data-pa-validation-notice]');
  const errorEl = form.querySelector('[data-pa-form-error]');
  if (noticeEl && errors.length) {
    const title = isPending ? 'לפני שליחה לאישור יש להשלים:' : 'חובה למלא:';
    noticeEl.innerHTML = `<strong class="ds-pa-validation-title">${escapeHtml(title)}</strong><ul class="ds-pa-validation-list">${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
    noticeEl.hidden = false;
    noticeEl.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }
  if (errorEl) errorEl.textContent = '';
}

function proposalTypeCardsHtml(selected) {
  const primaryOptions = [
    { value: SUMMER_PROPOSAL_GROUP, label: SUMMER_PROPOSAL_GROUP,  desc: 'קיץ תשפ״ו' },
    { value: NEXT_YEAR_GROUP_LABEL, label: NEXT_YEAR_GROUP_LABEL,  desc: 'קורסים ותוכניות לשנה"ל' },
    { value: COMBINED_GROUP_LABEL,  label: COMBINED_GROUP_LABEL,   desc: 'קיץ + שנה"ל' },
  ];
  const additionalOptions = ['קורסים', 'סדנאות', 'סיור', 'תוכניות חינוכיות', 'STEM ומייקרים', 'התנסות בתעשייה']
    .map((v) => ({ value: v, label: v, desc: '' }));
  const allOptions = [...primaryOptions, ...additionalOptions];
  return `<div class="ds-pa-type-cards" data-pa-type-cards>
    ${allOptions.map((opt) => `<button type="button" class="ds-pa-type-card${selected === opt.value ? ' is-selected' : ''}" data-pa-type-btn="${escapeHtml(opt.value)}"><span class="ds-pa-type-card-label">${escapeHtml(opt.label)}</span>${opt.desc ? `<span class="ds-pa-type-card-desc">${escapeHtml(opt.desc)}</span>` : ''}</button>`).join('')}
  </div><input type="hidden" name="activity_type_group" value="${escapeHtml(selected)}" data-pa-type-hidden>`;
}

function proposalStepperHtml() {
  return '';
}

function formHtml(mode, row = {}, activityNameOptions = [], contactOptions = [], items = [], pricingOptions = []) {
  const title = mode === 'edit' ? 'עריכת הצעת מחיר' : 'יצירת הצעת מחיר';
  const normalizedActivityGroup = LEGACY_GROUP_MAP[text(row.activity_type_group)] || text(row.activity_type_group);
  const filteredPricing = filterPricingByProposalType(pricingOptions, normalizedActivityGroup);
  const currentStatus = STATUS_OPTIONS.includes(text(row.status)) ? text(row.status) : 'draft';
  const initAuth = text(row.client_authority);
  const initSchool = text(row.school_framework);
  const initContact = text(row.contact_name);
  const initRole = text(row.contact_role);
  const initPhone = text(row.phone);
  const initEmail = text(row.email);
  const isLocked = !!initAuth;
  const initContactSource = findContactForProposalRow(contactOptions, row);
  const initPickerHtml = initAuth ? contactPickerHtml(contactOptions, initAuth, initSchool, initContact) : '';
  const initClientName = text(initContactSource?.client_name) || initSchool || initAuth;
  const proposalDate = mode === 'add' ? (text(row.proposal_date) || localDateInputValue()) : text(row.proposal_date);
  const hasCustomSections = Array.isArray(row.custom_document_sections) && row.custom_document_sections.length > 0;

  return `<form class="ds-pa-form ds-pa-form--compact" data-pa-form data-pa-mode="${escapeHtml(mode)}" data-pa-id="${escapeHtml(row.id || '')}" data-pa-original-type="${escapeHtml(normalizedActivityGroup)}" dir="rtl">
    <div class="ds-pa-form-header">
      <h3 class="ds-pa-form-title">${escapeHtml(title)}</h3>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-pa-cancel-form>ביטול</button>
    </div>

    <div class="ds-pa-form-meta-panel">
      <div data-pa-step-panel="client">
        <div class="ds-pa-client-row">
          ${clientSelectHtml(contactOptions, row)}
          <button type="button" class="ds-btn ds-btn--sm" data-pa-new-client-toggle>+ לקוח חדש</button>
        </div>
        <div data-pa-client-card${isLocked ? '' : ' hidden'}>${isLocked ? clientLockedBannerHtml(initAuth, initSchool, initContact, initRole, initPhone, initEmail, initClientName) : ''}</div>
        <div data-pa-new-client-hint hidden><span class="ds-pa-new-client-label">הוספת לקוח חדש</span><button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-pa-back-existing-client>חזרה לבחירת לקוח קיים</button></div>
        <div class="ds-pa-form-grid" data-pa-client-fields${isLocked ? ' hidden' : ''}>
          <label class="ds-pa-form-field" data-pa-new-client-only hidden>
            <span>סוג לקוח</span>
            <select class="ds-input ds-input--sm" name="new_client_type" data-pa-new-client-type>
              <option value="school">בית ספר</option>
              <option value="authority">רשות / מועצה / עירייה</option>
              <option value="other">אחר</option>
            </select>
          </label>
          ${textField('client_authority', FIELD_LABELS.client_authority, row.client_authority, true)}
          <div data-pa-school-field>
            ${textField('school_framework', FIELD_LABELS.school_framework, row.school_framework, true)}
          </div>
          <div data-pa-new-client-only hidden>
            <div class="ds-pa-create-client-row">
              <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-pa-create-client>✓ צור לקוח</button>
              <span data-pa-new-client-create-status style="font-size:.85em;color:var(--ds-text-muted,#888)"></span>
            </div>
          </div>
        </div>
      </div>
      <div data-pa-step-panel="contact">
        <div class="ds-pa-form-grid">
          <div data-pa-contact-picker-host>${initPickerHtml}</div>
          ${textField('contact_name', FIELD_LABELS.contact_name, row.contact_name, false)}
          ${textField('contact_role', FIELD_LABELS.contact_role, row.contact_role, false)}
          ${textField('phone', FIELD_LABELS.phone, row.phone, false)}
          ${textField('email', FIELD_LABELS.email, row.email, false)}
        </div>
      </div>
    </div>

    <div class="ds-pa-form-type-panel" data-pa-step-panel="proposal">
      <div class="ds-pa-type-meta-grid">
        <div class="ds-pa-form-field">
          <span>${escapeHtml(FIELD_LABELS.activity_type_group)} *</span>
          ${proposalTypeCardsHtml(normalizedActivityGroup)}
        </div>
        <div class="ds-pa-type-meta-aux">
          <label class="ds-pa-form-field"><span>${escapeHtml(FIELD_LABELS.proposal_date)}</span><input class="ds-input ds-input--sm" type="date" name="proposal_date" value="${escapeHtml(proposalDate)}"></label>
          <label class="ds-pa-form-field"><span>${escapeHtml(FIELD_LABELS.status)}</span><output class="ds-pa-status-output">${escapeHtml(STATUS_LABELS[currentStatus] || currentStatus)}</output></label>
          <input type="hidden" name="document_type" value="${escapeHtml(text(row.document_type) || 'הצעת מחיר')}">
        </div>
      </div>
      <div class="ds-pa-type-row">${templateIndicatorHtml(normalizedActivityGroup)}</div>
      <p class="ds-pa-template-mode ${hasCustomSections ? 'ds-pa-template-mode--custom' : ''}" data-pa-template-mode>${hasCustomSections ? 'הצעה זו כוללת נוסח מותאם אישית' : 'הצעה זו משתמשת בתבנית המקור'}</p>
    </div>

    <div class="ds-pa-form-activities-panel" data-pa-step-panel="activity">
      <div data-pa-items-host>${itemsEditorHtml(items, filteredPricing, normalizedActivityGroup)}</div>
    </div>

    <div class="ds-pa-form-bottom-panel" data-pa-step-panel="summary">
      <details class="ds-pa-notes-details"${text(row.notes) ? ' open' : ''}>
        <summary class="ds-pa-notes-summary">הערות</summary>
        <label class="ds-pa-form-field ds-pa-form-field--wide"><span>${escapeHtml(FIELD_LABELS.notes)}</span><textarea class="ds-input ds-input--sm ds-pa-notes-input" name="notes" rows="3">${escapeHtml(text(row.notes))}</textarea></label>
      </details>
      ${proposalSummaryHtml(row.total_amount)}
      <div class="ds-pa-validation-notice" data-pa-validation-notice hidden></div>
      <p class="ds-pa-form-error" data-pa-form-error role="alert"></p>
      <div class="ds-pa-form-actions ds-pa-form-actions--workflow">
        <div class="ds-pa-form-actions-main">
          <button type="button" class="ds-btn ds-btn--sm" data-pa-save-draft>שמירת טיוטה</button>
          <button type="button" class="ds-btn ds-btn--sm" data-pa-preview-form>תצוגה מקדימה</button>
          <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-pa-save-pending>שליחה לאישור</button>
        </div>
      </div>
    </div>

    <input type="hidden" name="status" data-pa-status-input value="${escapeHtml(currentStatus)}">
    <span data-pa-contact-source>${contactSourceInputsHtml(initContactSource || {})}</span>
    <div class="ds-pa-duplicate-dialog" data-pa-duplicate-dialog hidden></div>
  </form>`;
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

function drawerActionButtons(row, state) {
  const status = text(row?.status) || 'draft';
  const role = state ? String(state?.user?.display_role || state?.user?.role || '').trim() : '';
  const isAdminRole = role === 'admin';
  const canManage = PROPOSALS_AGREEMENTS_MANAGE_ROLES.has(role);
  const buttons = [];

  buttons.push(`<button type="button" class="ds-btn ds-btn--sm" data-pa-preview="${escapeHtml(row.id)}">תצוגה מקדימה</button>`);

  if (canManage && (['draft', 'returned_for_changes'].includes(status) || isAdminRole)) {
    buttons.push(`<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-pa-edit-row="${escapeHtml(row.id)}">עריכה</button>`);
  }
  if (canManage && ['draft', 'returned_for_changes'].includes(status)) {
    buttons.push(`<button type="button" class="ds-btn ds-btn--sm" data-pa-edit-document="${escapeHtml(row.id)}">עריכת מסמך</button>`);
  }
  if (canManage && ['draft', 'returned_for_changes'].includes(status) && !isAdminRole) {
    buttons.push(`<button type="button" class="ds-btn ds-btn--sm" data-pa-status-action="pending_approval" data-pa-action-id="${escapeHtml(row.id)}">שליחה לאישור</button>`);
  }
  if (isAdminRole) {
    if (status === 'pending_approval') {
      buttons.push(`<button type="button" class="ds-btn ds-btn--sm" data-pa-status-action="approved" data-pa-action-id="${escapeHtml(row.id)}">אישור</button>`);
      buttons.push(`<button type="button" class="ds-btn ds-btn--sm" data-pa-status-action="returned_for_changes" data-pa-action-id="${escapeHtml(row.id)}">החזרה לתיקון</button>`);
    }
    if (status === 'approved') {
      buttons.push(`<button type="button" class="ds-btn ds-btn--sm" data-pa-print="${escapeHtml(row.id)}">הדפסה / שמירה כ-PDF</button>`);
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
  const totalHtml = row.total_amount != null ? `
    <div class="ds-pa-detail-row">
      <span class="ds-pa-detail-label">סה״כ</span>
      <span class="ds-pa-detail-value"><strong>₪${formatCurrency(row.total_amount)}</strong></span>
    </div>` : '';

  const hasCustomSections = Array.isArray(row.custom_document_sections) && row.custom_document_sections.length > 0;
  const customBadge = hasCustomSections
    ? `<span class="ds-pa-badge" title="המסמך הזה כולל עריכה מותאמת אישית" style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:0.75rem;background:#6366f1;color:#fff;margin-right:4px">מסמך מותאם</span>`
    : '';

  return `<aside class="ds-pa-drawer" data-pa-drawer data-pa-drawer-id="${escapeHtml(row.id)}" aria-live="polite" dir="rtl">
    <div class="ds-pa-drawer-panel">
      <header class="ds-pa-drawer-head">
        <div><p class="ds-muted">פרטי רשומה</p><h3>${escapeHtml(row.client_authority || '—')}</h3></div>
        <button type="button" class="ds-btn ds-btn--sm" data-pa-close-drawer aria-label="סגירת פרטי רשומה">✕</button>
      </header>
      <div class="ds-pa-drawer-status" style="margin-bottom:8px">${statusBadgeHtml(row.status)}${customBadge}</div>
      <div class="ds-pa-detail-grid">${detailRowsHtml(row)}</div>
      ${totalHtml}
      ${approvalNoteHtml}
      ${contactDetailRowsHtml(row)}
      <div data-pa-drawer-items style="margin:8px 0"><span class="ds-muted" style="font-size:0.8rem">טוען שורות הצעה...</span></div>
      <div class="ds-pa-drawer-actions">${drawerActionButtons(row, state)}</div>
      <div data-pa-inline-form></div>
    </div>
  </aside>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    activity_type_group: root.querySelector('[data-pa-filter="activity_type_group"]')?.value || '',
    status:              root.querySelector('[data-pa-filter="status"]')?.value || ''
  };
}

export function updateProposalsAgreementsTableOnly(root, rows, state) {
  const body = root?.querySelector('[data-pa-table-body]');
  const counter = root?.querySelector('[data-pa-results-count]');
  if (body) body.innerHTML = proposalsAgreementsTableRowsHtml(rows, state);
  if (counter) counter.textContent = String(rows.length);
}


function setDocumentEditMode(root, enabled) {
  const drawer = root?.querySelector('[data-pa-drawer]');
  const panel = drawer?.querySelector('.ds-pa-drawer-panel');
  if (!drawer || !panel) return;
  drawer.classList.toggle('is-doc-editing', !!enabled);
  panel.classList.toggle('is-doc-editing', !!enabled);
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
  payload.document_type = 'הצעת מחיר';
  const items = filterItemsByProposalType(extractItemsFromForm(form), payload.activity_type_group);
  const itemNames = Array.from(new Set(items.map((i) => text(i.item_name)).filter(Boolean)));
  if (itemNames.length) payload.activity_names = itemNames;
  payload.total_amount = items.reduce((s, i) => s + (Number(i.total_price) || ((Number(i.quantity) || 0) * (Number(i.unit_price) || 0))), 0) || null;
  payload._items = items;
  payload._contact_original = {
    id:             text(formData.get('contact_source_id')),
    authority:      text(formData.get('contact_source_authority')),
    school:         text(formData.get('contact_source_school')),
    contact_name:   text(formData.get('contact_source_name')),
    contact_role:   text(formData.get('contact_source_role')),
    phone:          text(formData.get('contact_source_phone')),
    email:          text(formData.get('contact_source_email'))
  };
  return payload;
}

function validatePayload(payload, statusOverride) {
  const targetStatus = statusOverride || payload.status || 'draft';
  const requiredFields = targetStatus === 'pending_approval'
    ? REQUIRED_FIELDS_PENDING
    : REQUIRED_FIELDS_DRAFT;
  const missing = requiredFields.filter((key) => !text(payload[key]));
  const errors = missing.map((key) => FIELD_LABELS[key] || key);

  if (targetStatus === 'pending_approval') {
    const grp = LEGACY_GROUP_MAP[text(payload.activity_type_group)] || text(payload.activity_type_group);
    const items = filterItemsByProposalType(Array.isArray(payload._items) ? payload._items : [], grp);
    if (!items.length) errors.push('לפחות שורת הצעה אחת רלוונטית לסוג ההצעה');
    const invalidItem = items.find((i) => !text(i.item_name));
    if (invalidItem) errors.push('שם פעילות בכל שורה');
    if (!payload.total_amount) errors.push('סה״כ כללי');
    if (grp === COMBINED_GROUP_LABEL) {
      const missingGroup = items.find((i) => !text(i.proposal_group));
      if (missingGroup) errors.push('שייוך לקיץ/תשפ״ז בכל שורה (הצעה משולבת)');
    }
  }

  return errors;
}

function replaceLocalRow(data, savedRow) {
  const normalized = normalizeProposalAgreementRow(savedRow);
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const idx = rows.findIndex((row) => text(row.id) === normalized.id);
  if (idx >= 0) rows[idx] = normalized;
  else rows.unshift(normalized);
  data.rows = dedupeById(sortRows(rows.map(normalizeProposalAgreementRow)));
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export const proposalsAgreementsScreen = {
  load: ({ api, state }) => {
    if (!canAccessProposalsAgreements(state)) return Promise.resolve({ rows: [], unauthorized: true });
    return api.proposalsAgreements();
  },
  render(data = {}, { state } = {}) {
    if (data?.unauthorized || !canAccessProposalsAgreements(state)) {
      return dsScreenStack(`${dsPageHeader('הצעות מחיר', 'גישה מוגבלת למורשים בלבד')}${dsEmptyState('אין לך הרשאה לצפות במסך זה')}`);
    }
    const rows = displayRows(data, {});
    const canManage = canManageProposalsAgreements(state);
    const rawRows = Array.isArray(data?.rows) ? data.rows.map(normalizeProposalAgreementRow) : [];
    return dsScreenStack(`
      ${dsPageHeader('הצעות מחיר')}
      <section class="ds-pa-screen" data-pa-screen dir="rtl">
        <div class="ds-pa-toolbar">
          <label class="ds-pa-search"><span>חיפוש</span><input class="ds-input ds-input--sm" data-pa-search placeholder="חיפוש מקומי" autocomplete="off"></label>
          ${filterSelectHtml('activity_type_group', 'סוג הצעה', ACTIVITY_TYPE_GROUP_OPTIONS)}
          ${statusFilterHtml()}
          ${canManage ? '<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-pa-add>+ הצעה חדשה</button>' : ''}
        </div>
        <div class="ds-pa-local-status" aria-live="polite">מציג <strong data-pa-results-count>${rows.length}</strong> רשומות</div>
        <div data-pa-form-host hidden></div>
        ${dsCard({ title: 'רשומות', padded: false, body: `<div class="ds-pa-records-shell" data-pa-table-region>${tableHtml(rows, state)}</div>` })}
        ${drawerHtml(null, [], state)}
      </section>
    `);
  },
  bind({ root, data, state, api }) {
    if (!root || data?.unauthorized || !canAccessProposalsAgreements(state)) return;
    const canManage = canManageProposalsAgreements(state);
    if (root._paAbort) root._paAbort.abort();
    const abortController = new AbortController();
    root._paAbort = abortController;
    const { signal } = abortController;
    const seenIds = new Set();
    data.rows = sortRows((Array.isArray(data.rows) ? data.rows : [])
      .map(normalizeProposalAgreementRow)
      .filter((r) => { const k = text(r.id); if (!k || seenIds.has(k)) return false; seenIds.add(k); return true; }));
    const activityNameOptions = Array.from(new Set((Array.isArray(data?.activityNameOptions) ? data.activityNameOptions : []).map((v) => text(v)).filter(Boolean)));
    const proposalActivityPricing = Array.isArray(data?.proposalActivityPricing) ? data.proposalActivityPricing : [];
    const proposalTemplateSections = Array.isArray(data?.proposalTemplateSections) ? data.proposalTemplateSections : [];
    const contactOptions = Array.isArray(data?.contactOptions) ? data.contactOptions : [];
    const rowWithCentralContact = (row) => {
      if (!row) return row;
      const contact = findContactForProposalRow(contactOptions, row);
      if (!contact) return row;
      return {
        ...row,
        client_authority: text(contact.authority) || row.client_authority,
        school_framework: text(contact.school) || row.school_framework,
        contact_name: text(contact.contact_name) || row.contact_name,
        contact_role: text(contact.contact_role) || row.contact_role,
        phone: text(contact.phone || contact.mobile || '') || row.phone,
        email: text(contact.email) || row.email
      };
    };
    let debounceTimer = null;

    const refreshTable = () => updateProposalsAgreementsTableOnly(root, displayRows(data, currentFilters(root)), state);
    const debouncedRefresh = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refreshTable, SEARCH_DEBOUNCE_MS);
    };

    root.querySelector('[data-pa-search]')?.addEventListener('input', debouncedRefresh, { signal });
    root.querySelectorAll('[data-pa-filter]').forEach((el) => el.addEventListener('change', refreshTable, { signal }));
    root.addEventListener('change', (event) => {
      const typeSelect = event.target.closest?.('[data-pa-new-client-type]');
      if (!typeSelect) return;
      const form = typeSelect.closest('[data-pa-form]');
      if (!form) return;
      const schoolField = form.querySelector('[data-pa-school-field]');
      if (schoolField) schoolField.hidden = typeSelect.value === 'authority';
    }, { signal });

    const formHost = root.querySelector('[data-pa-form-host]');

    const stepPanel = (form, key) => form?.querySelector(`[data-pa-step-panel="${key}"]`);
    const stepComplete = (form) => {
      const clientDone = Boolean(text(form?.querySelector('[name="client_authority"]')?.value));
      const proposalDone = clientDone && Boolean(text(form?.querySelector('[name="activity_type_group"]')?.value));
      const items = proposalDone ? extractItemsFromForm(form) : [];
      const activityDone = proposalDone && items.some((item) => text(item.item_name) && (Number(item.total_price) > 0 || ((Number(item.quantity) || 0) * (Number(item.unit_price) || 0)) > 0));
      return { client: clientDone, proposal: proposalDone, activity: activityDone, summary: activityDone };
    };
    const setPanelOpen = (form, key, open) => {
      const panel = stepPanel(form, key);
      if (!panel) return;
      panel.hidden = !open;
      panel.setAttribute('aria-disabled', open ? 'false' : 'true');
    };
    const updateProposalStepper = (container) => {
      const form = container?.closest?.('[data-pa-form]') || container?.querySelector?.('[data-pa-form]') || container;
      if (!form) return;
      ['client', 'contact', 'proposal', 'activity', 'summary'].forEach((key) => setPanelOpen(form, key, true));
    };
    const setupFormStepper = (container) => {
      const form = container?.closest?.('[data-pa-form]') || container?.querySelector?.('[data-pa-form]');
      if (!form || form.dataset.paStepperBound === 'yes') return;
      form.dataset.paStepperBound = 'yes';
      form.addEventListener('input', () => { updateProposalStepper(form); calcGrandTotal(form); }, { signal });
      form.addEventListener('change', () => setTimeout(() => { updateProposalStepper(form); calcGrandTotal(form); }, 0), { signal });
      updateProposalStepper(form);
    };

    // ── Type change → re-render items section + update template indicator ────
    const setupTypeChangeHandler = (container) => {
      const form = container?.closest?.('[data-pa-form]') || container?.querySelector?.('[data-pa-form]') || container;
      if (!form) return;
      const typeSelect = form.querySelector('[name="activity_type_group"]');
      if (!typeSelect) return;
      typeSelect.addEventListener('change', () => {
        const newType = text(typeSelect.value);
        form.dataset.paPreviewSeen = '';
        // Update template indicator
        const indicatorEl = form.querySelector('[data-pa-template-indicator]');
        if (indicatorEl) {
          const tmp = document.createElement('div');
          tmp.innerHTML = templateIndicatorHtml(newType);
          const newIndicator = tmp.firstElementChild;
          if (newIndicator) indicatorEl.replaceWith(newIndicator);
        }
        const currentItems = filterItemsByProposalType(extractItemsFromForm(form), newType);
        const itemsHost = form.querySelector('[data-pa-items-host]');
        if (!itemsHost) return;
        const filteredPricing = filterPricingByProposalType(proposalActivityPricing, newType);
        itemsHost.innerHTML = itemsEditorHtml(currentItems, filteredPricing, newType);
        const modeEl = form.querySelector('[data-pa-template-mode]');
        if (modeEl && text(form.dataset.paOriginalType) && text(form.dataset.paOriginalType) !== newType) {
          modeEl.textContent = 'סוג ההצעה השתנה - תיטען תבנית המקור של הסוג החדש';
          modeEl.classList.remove('ds-pa-template-mode--custom');
        }
        setupItemCalc(form);
        updateProposalStepper(form);
      }, { signal });
    };

    // ── Client lock / unlock helpers ──────────────────────────────────────────
    const lockClientFields = (form, auth, school, cName, cRole, phone, email, clientName = '') => {
      const cardEl = form?.querySelector('[data-pa-client-card]');
      const fieldsEl = form?.querySelector('[data-pa-client-fields]');
      const hintEl = form?.querySelector('[data-pa-new-client-hint]');
      if (cardEl) { cardEl.innerHTML = clientLockedBannerHtml(auth, school, cName, cRole, phone, email, clientName); cardEl.hidden = false; }
      if (fieldsEl) fieldsEl.hidden = true;
      if (hintEl) hintEl.hidden = true;
    };

    const unlockClientFields = (form) => {
      const cardEl = form?.querySelector('[data-pa-client-card]');
      const fieldsEl = form?.querySelector('[data-pa-client-fields]');
      if (cardEl) cardEl.hidden = true;
      if (fieldsEl) fieldsEl.hidden = false;
    };

    // ── Contact / client setup ────────────────────────────────────────────────
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

    const setContactSource = (form, contact = {}) => {
      const host = form?.querySelector('[data-pa-contact-source]');
      if (host) host.innerHTML = contactSourceInputsHtml(contact || {});
    };

    const setupContactPicker = (container, form) => {
      const contactSelect = container?.querySelector?.('[data-pa-contact-select]');
      if (!contactSelect) return;
      contactSelect.addEventListener('change', () => {
        const key = contactSelect.value;
        if (!key) return;
        const contact = contactOptions.find((c) => contactOptionKey(c) === key);
        if (contact) {
          fillContactFields(form, contact);
          setContactSource(form, contact);
        }
      }, { signal });
    };

    const setupActivityPickers = (container) => {
      container?.querySelectorAll?.('[data-pa-activity-picker]').forEach((picker) => {
        if (picker.dataset.paActivityBound === 'yes') return;
        picker.dataset.paActivityBound = 'yes';
        const trigger = picker.querySelector('[data-pa-activity-toggle]');
        const dropdown = picker.querySelector('[data-pa-activity-dropdown]');
        const chipsHost = picker.querySelector('[data-pa-activity-chips]');
        const hiddenHost = picker.querySelector('[data-pa-activity-hidden-inputs]');
        const search = picker.querySelector('[data-pa-activity-search]');
        const options = Array.from(picker.querySelectorAll('.ds-pa-activity-option'));
        const updatePicker = () => {
          const selected = options
            .filter((option) => option.querySelector('input[type="checkbox"]')?.checked)
            .map((option) => text(option.querySelector('input[type="checkbox"]')?.value))
            .filter(Boolean);
          if (hiddenHost) {
            hiddenHost.innerHTML = selected.map((value) => `<input type="hidden" name="activity_names" value="${escapeHtml(value)}">`).join('');
          }
          if (chipsHost) {
            chipsHost.innerHTML = selected.map((value) => `<span class="ds-pa-chip">${escapeHtml(value)}</span>`).join('');
          }
          if (trigger) trigger.textContent = selected.length ? `${selected.length} פעילויות נבחרו` : 'בחרו פעילויות';
        };
        trigger?.addEventListener('click', () => {
          if (!dropdown) return;
          dropdown.hidden = !dropdown.hidden;
          trigger.setAttribute('aria-expanded', dropdown.hidden ? 'false' : 'true');
          if (!dropdown.hidden) search?.focus?.();
        }, { signal });
        picker.querySelectorAll('input[type="checkbox"]').forEach((input) => {
          input.addEventListener('change', updatePicker, { signal });
        });
        search?.addEventListener('input', () => {
          const q = normalizeSearch(search.value);
          options.forEach((option) => {
            option.hidden = q ? !normalizeSearch(option.textContent).includes(q) : false;
          });
        }, { signal });
        updatePicker();
      });
    };

    const setupClientSelector = (container) => {
      const clientSelect = container?.querySelector?.('[data-pa-client-select]');
      if (!clientSelect) return;
      const form = clientSelect.closest('[data-pa-form]');
      if (!form) return;
      clientSelect.addEventListener('change', () => {
        const val = clientSelect.value;
        if (!val) { unlockClientFields(form); return; }
        form.dataset.paNewClient = 'no';
        const [authority, school] = val.split('||');
        const matches = contactOptions.filter((c) => text(c.authority) === authority && text(c.school) === school);
        const authInput = form.querySelector('input[name="client_authority"]');
        const schoolInput = form.querySelector('input[name="school_framework"]');
        if (authInput) authInput.value = authority;
        if (schoolInput) schoolInput.value = school;
        const pickerHost = form.querySelector('[data-pa-contact-picker-host]');
        let cName = '', cRole = '', phone = '', email = '';
        if (matches.length > 1) {
          if (pickerHost) { pickerHost.innerHTML = contactPickerHtml(contactOptions, authority, school, ''); setupContactPicker(pickerHost, form); }
          setContactSource(form, {});
        } else {
          if (pickerHost) pickerHost.innerHTML = '';
          if (matches.length === 1) {
            fillContactFields(form, matches[0]);
            setContactSource(form, matches[0]);
            cName = text(matches[0].contact_name);
            cRole = text(matches[0].contact_role);
            phone = text(matches[0].phone || matches[0].mobile || '');
            email = text(matches[0].email || '');
          } else {
            setContactSource(form, {});
          }
        }
        const clientName = matches.length > 0
          ? (text(matches[0].client_name) || text(matches[0].school) || text(matches[0].authority))
          : (school || authority);
        lockClientFields(form, authority, school, cName, cRole, phone, email, clientName);
      }, { signal });
    };

    // ── Items calc ────────────────────────────────────────────────────────────
    const calcItemRow = (rowEl) => {
      const qty = parseFloat(rowEl.querySelector('[data-pa-item-qty]')?.value || '0') || 0;
      const price = parseFloat(rowEl.querySelector('[data-pa-item-price]')?.value || '0') || 0;
      const totalInput = rowEl.querySelector('[data-pa-item-total]');
      const totalDisplay = rowEl.querySelector('[data-pa-item-total-display]');
      const total = qty && price ? qty * price : 0;
      if (totalInput) totalInput.value = total ? total.toFixed(2) : '';
      if (totalDisplay) totalDisplay.textContent = total ? `₪${formatCurrency(total)}` : '';
      return total;
    };

    const calcGrandTotal = (container) => {
      let sum = 0;
      container.querySelectorAll('[data-pa-item-row]').forEach((rowEl) => { sum += calcItemRow(rowEl); });
      const el = container.querySelector('[data-pa-grand-total]');
      if (el) el.textContent = sum ? `₪${formatCurrency(sum)}` : '₪0';
      const summaryEl = container.querySelector('[data-pa-summary-total]');
      if (summaryEl) summaryEl.textContent = sum ? `₪${formatCurrency(sum)}` : '₪0';
      // Update summary card fields
      const form = container.closest?.('[data-pa-form]') || (container.matches?.('[data-pa-form]') ? container : null);
      if (form) {
        const clientEl = form.querySelector('[data-pa-summary-client]');
        if (clientEl) clientEl.textContent = text(form.querySelector('[name="client_authority"]')?.value) || '—';
        const typeEl = form.querySelector('[data-pa-summary-type]');
        if (typeEl) typeEl.textContent = text(form.querySelector('[name="activity_type_group"]')?.value) || '—';
        const countEl = form.querySelector('[data-pa-summary-count]');
        if (countEl) countEl.textContent = String(form.querySelectorAll('[data-pa-item-row]').length) || '—';
      }
      return sum;
    };

    const setupItemCalc = (container) => { calcGrandTotal(container); };
    const pricingByName = new Map(proposalActivityPricing.map((row) => [text(row.activity_name), row]));
    const pricingByNo = proposalActivityPricing.reduce((acc, row) => {
      const key = text(row.activity_no);
      if (!key || acc.has(key)) return acc;
      acc.set(key, row);
      return acc;
    }, new Map());
    const pricingByOptionKey = new Map(proposalActivityPricing.map((row, idx) => [pricingOptionKey(row, idx), row]));
    const pricingFallbackByName = {
      workshop_space: proposalActivityPricing.find((row) => text(row.activity_name) === 'סדנת חלל') || null,
      workshop_makers: proposalActivityPricing.find((row) => text(row.activity_name) === 'סדנת מייקרים') || null,
      escape_room: proposalActivityPricing.find((row) => text(row.activity_name) === 'חדר בריחה דיגיטלי') || null
    };
    const workshopSpaceCodes = new Set(['001', '002', '013']);

    const resolvePricingRow = ({ activityNo, activityName, itemType, optionKey }) => {
      const selectedOptionKey = text(optionKey);
      const no = text(activityNo);
      const name = text(activityName);
      const type = text(itemType).toLowerCase();
      if (selectedOptionKey && pricingByOptionKey.has(selectedOptionKey)) return pricingByOptionKey.get(selectedOptionKey);
      if (no && pricingByNo.has(no)) return pricingByNo.get(no);
      if (name && pricingByName.has(name)) return pricingByName.get(name);
      if (type === 'tour') return no ? pricingByNo.get(no) || null : null;
      if (type === 'escape_room') return pricingFallbackByName.escape_room;
      if (type === 'workshop') {
        if (workshopSpaceCodes.has(no)) return pricingFallbackByName.workshop_space || pricingFallbackByName.workshop_makers;
        return pricingFallbackByName.workshop_makers || pricingFallbackByName.workshop_space;
      }
      return null;
    };

    // ── Form open/close ───────────────────────────────────────────────────────
    const openForm = async (mode, row = {}, preloadedItems = []) => {
      if (!formHost) return;
      let items = preloadedItems;
      if (mode === 'edit' && text(row.id) && !preloadedItems.length) {
        try {
          if (typeof api.readProposalAgreementItems === 'function') {
            items = await api.readProposalAgreementItems(text(row.id));
          }
        } catch { items = []; }
      }
      formHost.hidden = false;
      formHost.innerHTML = formHtml(mode, row, activityNameOptions, contactOptions, items, proposalActivityPricing);
      setupTypeChangeHandler(formHost);
      setupClientSelector(formHost);
      setupActivityPickers(formHost);
      setupItemCalc(formHost);
      setupFormStepper(formHost);
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

    // ── Preview ───────────────────────────────────────────────────────────────
    const openPreview = (row, items, options = {}) => {
      // Always rebuild preview from current state + current templates
      const freshRow = rowWithCentralContact(data.rows.find((r) => text(r.id) === text(row.id)) || row);
      const templateKey = TEMPLATE_KEY_BY_GROUP[text(freshRow.activity_type_group)] || 'combined';
      const templateSections = proposalTemplateSections.filter((s) => text(s.template_key) === templateKey);
      document.getElementById('pa-preview-overlay')?.remove();
      const overlay = document.createElement('div');
      overlay.id = 'pa-preview-overlay';
      overlay.className = 'proposal-preview-overlay';
      overlay.setAttribute('dir', 'rtl');
      const clientLabel = [freshRow.client_authority, freshRow.school_framework].filter(Boolean).map(escapeHtml).join(' — ');
      const saveBtnHtml = options.onSave ? `<button type="button" class="ds-btn ds-btn--sm no-print" id="pa-preview-save">שמירת טיוטה</button>` : '';
      overlay.innerHTML = `
        <div class="proposal-preview-toolbar no-print">
          <button type="button" class="ds-btn ds-btn--sm no-print" id="pa-preview-close">← חזרה לעריכה</button>
          ${saveBtnHtml}
          <button type="button" class="ds-btn ds-btn--primary ds-btn--sm no-print" id="pa-print-btn">הדפסה / שמירה כ-PDF</button>
          <span class="ds-pa-preview-client no-print">${clientLabel}</span>
        </div>
        <div class="proposal-preview-area">
          ${proposalPreviewBodyHtml(freshRow, items, templateSections)}
        </div>`;
      document.body.appendChild(overlay);
      document.body.classList.add('is-print-preview');
      overlay.querySelector('#pa-print-btn')?.addEventListener('click', () => window.print());
      const closeOverlay = () => { overlay.remove(); document.body.classList.remove('is-print-preview'); };
      overlay.querySelector('#pa-preview-close')?.addEventListener('click', closeOverlay);
      if (options.onSave) overlay.querySelector('#pa-preview-save')?.addEventListener('click', () => options.onSave());
      overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOverlay(); });
    };

    // ── Save ──────────────────────────────────────────────────────────────────
    const saveForm = async (form, statusOverride) => {
      const errorEl = form.querySelector('[data-pa-form-error]');
      if (form.dataset.saving === 'yes') return;
      form.dataset.saving = 'yes';
      const allBtns = form.querySelectorAll('button');
      allBtns.forEach((b) => { b.disabled = true; });
      const payload = payloadFromForm(form);
      payload.is_new_client = form.dataset.paNewClient === 'yes';
      if (statusOverride) payload.status = statusOverride;

      // Client dedup — warn if a similar client already exists
      if (payload.is_new_client && text(payload.client_authority)) {
        const similar = findSimilarClients(contactOptions, payload.client_authority, payload.school_framework);
        if (similar.length) {
          const pick = similar[0];
          const shouldUseExisting = window.confirm(`נמצא לקוח דומה במערכת:\nלקוח / רשות: ${text(pick.authority)}\nבית ספר / מסגרת: ${text(pick.school) || '—'}\nאיש קשר: ${text(pick.contact_name) || '—'}\n\nבחר את הלקוח הקיים?`);
          if (shouldUseExisting) {
            const match = similar[0];
            payload.client_authority = text(match.authority);
            payload.school_framework = text(match.school);
            payload.is_new_client = false;
          } else {
            const shouldKeepNew = window.confirm('להמשיך ולשמור כלקוח חדש בכל זאת?');
            if (!shouldKeepNew) {
              form.dataset.saving = '';
              allBtns.forEach((b) => { b.disabled = false; });
              return;
            }
          }
        }
      }

      const validationErrors = validatePayload(payload, statusOverride);
      if ((statusOverride === 'pending_approval') && form.dataset.paPreviewSeen !== 'yes') {
        validationErrors.push('מומלץ לבדוק תצוגה מקדימה לפני שליחה לאישור.');
      }
      if (validationErrors.length) {
        showValidationNotice(form, validationErrors, statusOverride === 'pending_approval');
        form.dataset.saving = '';
        allBtns.forEach((b) => { b.disabled = false; });
        return;
      }
      const noticeEl = form.querySelector('[data-pa-validation-notice]');
      if (noticeEl) noticeEl.hidden = true;
      const mode = form.dataset.paMode;
      const id = text(form.dataset.paId);
      if (mode === 'edit') {
        const existingRow = data.rows.find((row) => text(row.id) === id);
        if (existingRow && text(form.dataset.paOriginalType) === text(payload.activity_type_group) && Array.isArray(existingRow.custom_document_sections)) {
          payload.custom_document_sections = existingRow.custom_document_sections;
        } else {
          payload.custom_document_sections = [];
        }
      }
      try {
        const result = mode === 'edit'
          ? await api.updateProposalAgreement(id, payload)
          : await api.addProposalAgreement(payload);
        const savedId = text(result?.row?.id || id);
        const items = filterItemsByProposalType(extractItemsFromForm(form), payload.activity_type_group);
        if (savedId && typeof api.saveProposalAgreementItems === 'function') {
          try { await api.saveProposalAgreementItems(savedId, items); } catch { /* non-fatal */ }
        }
        replaceLocalRow(data, result?.row || { ...payload, id: savedId });
        refreshTable();
        closeForm();
        const drawer = root.querySelector('[data-pa-drawer]');
        if (drawer && mode === 'edit') {
          const updated = data.rows.find((item) => text(item.id) === id);
          if (updated) drawer.outerHTML = drawerHtml(updated, activityNameOptions, state);
        }
      } catch (err) {
        if (errorEl) errorEl.textContent = `שגיאה בשמירה: ${err?.message || err}`;
        form.dataset.saving = '';
        allBtns.forEach((b) => { b.disabled = false; });
      }
    };

    // ── Add button ────────────────────────────────────────────────────────────
    if (canManage) root.querySelector('[data-pa-add]')?.addEventListener('click', () => openForm('add'), { signal });

    // ── Input handler (items calc) ────────────────────────────────────────────
    root.addEventListener('input', (event) => {
      const target = event.target;
      if (target.closest?.('[data-pa-item-qty]') || target.dataset?.paItemQty != null ||
          target.closest?.('[data-pa-item-price]') || target.dataset?.paItemPrice != null ||
          target.matches?.('[data-pa-item-qty]') || target.matches?.('[data-pa-item-price]')) {
        const itemRow = target.closest('[data-pa-item-row]');
        const form = target.closest('[data-pa-form]');
        if (itemRow) calcItemRow(itemRow);
        if (form) calcGrandTotal(form);
      }
      if (target.name === 'meetings_count' || target.name === 'hours_count') {
        const itemRow = target.closest?.('[data-pa-item-row]');
        if (!itemRow) return;
        const infoStrip = itemRow.querySelector('[data-pa-item-info-strip]');
        if (!infoStrip || infoStrip.hidden) return;
        const getVal = (name) => text(itemRow.querySelector(`[name="${name}"]`)?.value);
        const getNum = (name) => { const v = itemRow.querySelector(`[name="${name}"]`)?.value; return v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : null; };
        const rowGroup = getVal('proposal_group') || text(itemRow.dataset.paRowGroup);
        infoStrip.innerHTML = buildInfoStripInnerHtml({
          item_name: getVal('item_name'), item_type: getVal('item_type'),
          gefen_number: getVal('gefen_number'), meetings_count: getNum('meetings_count'), hours_count: getNum('hours_count'),
          hourly_price: getNum('hourly_price'), unit_price: getNum('unit_price'), proposal_group: rowGroup
        }, rowGroup);
      }
    }, { signal });
    root.addEventListener('change', (event) => {
      const pricingSelect = event.target.closest?.('[data-pa-pricing-select]');
      if (!pricingSelect) return;
      const itemRow = pricingSelect.closest('[data-pa-item-row]');
      const form = pricingSelect.closest('[data-pa-form]');
      const selectedKey = text(pricingSelect.value);
      const itemTypeInput = itemRow?.querySelector?.('[name="item_type"]');
      const picked = resolvePricingRow({
        optionKey: selectedKey,
        activityNo: selectedKey,
        activityName: selectedKey,
        itemType: itemTypeInput?.value
      });
      if (!itemRow || !picked) return;
      const setValue = (name, value) => {
        const input = itemRow.querySelector(`[name="${name}"]`);
        if (input) input.value = value == null ? '' : String(value);
      };
      setValue('pricing_option_key', selectedKey);
      setValue('activity_no', picked.activity_no || '');
      setValue('item_name', picked.activity_name || '');
      setValue('item_type', picked.item_type || '');
      setValue('gefen_number', picked.gefen_number || '');
      setValue('gefen_number_display', picked.gefen_number || '');
      setValue('hours_count', picked.hours_count);
      setValue('meetings_count', picked.meetings_count);
      setValue('unit_price', picked.unit_price);
      setValue('hourly_price', picked.hourly_price ?? '');
      setValue('description', picked.description_for_proposal || '');
      setValue('unit_duration', picked.unit_duration || '');
      setValue('proposal_group', picked.proposal_group || text(itemRow.dataset.paRowGroup) || '');
      const rowGroup = text(itemRow.dataset.paRowGroup || picked.proposal_group);
      const infoStrip = itemRow.querySelector('[data-pa-item-info-strip]');
      if (infoStrip) {
        const get = (name) => text(itemRow.querySelector(`[name="${name}"]`)?.value);
        const getNum = (name) => { const v = itemRow.querySelector(`[name="${name}"]`)?.value; return v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : null; };
        infoStrip.innerHTML = buildInfoStripInnerHtml({
          item_name: get('item_name'),
          item_type: get('item_type'),
          gefen_number: get('gefen_number'),
          meetings_count: getNum('meetings_count'),
          hours_count: getNum('hours_count'),
          hourly_price: getNum('hourly_price'),
          unit_price: getNum('unit_price'),
          proposal_group: rowGroup
        }, rowGroup);
        infoStrip.hidden = !text(picked.activity_name);
      }

      calcItemRow(itemRow);
      if (form) calcGrandTotal(form);
      if (form) updateProposalStepper(form);
    }, { signal });

    // ── Click handler ─────────────────────────────────────────────────────────
    root.addEventListener('click', async (event) => {
      // Type card selection (proposal type wizard cards)
      const typeCardBtn = event.target.closest?.('[data-pa-type-btn]');
      if (typeCardBtn) {
        const val = text(typeCardBtn.dataset.paTypeBtn);
        const form = typeCardBtn.closest('[data-pa-form]');
        const typeInput = form?.querySelector('[name="activity_type_group"]');
        if (typeInput && val) {
          typeInput.value = val;
          typeCardBtn.closest('[data-pa-type-cards]')?.querySelectorAll('[data-pa-type-btn]').forEach((btn) => {
            btn.classList.toggle('is-selected', text(btn.dataset.paTypeBtn) === val);
          });
          typeInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return;
      }

      // Row click — skip if clicking an inline action button inside the row
      const rowEl = !event.target.closest?.('[data-pa-preview],[data-pa-edit-row],[data-pa-print],[data-pa-delete-row]')
        ? event.target.closest?.('[data-pa-row-id]')
        : null;
      if (rowEl) {
        const row = rowWithCentralContact(data.rows.find((item) => text(item.id) === text(rowEl.dataset.paRowId)));
        const drawer = root.querySelector('[data-pa-drawer]');
        if (drawer && row) {
          drawer.outerHTML = drawerHtml(row, activityNameOptions, state);
          // Load items for drawer display
          const newDrawer = root.querySelector('[data-pa-drawer]');
          const itemsHost = newDrawer?.querySelector('[data-pa-drawer-items]');
          if (itemsHost && text(row.id) && typeof api.readProposalAgreementItems === 'function') {
            try {
              const items = await api.readProposalAgreementItems(text(row.id));
              if (itemsHost.isConnected) itemsHost.innerHTML = itemsSummaryHtml(items);
            } catch { if (itemsHost.isConnected) itemsHost.innerHTML = ''; }
          } else if (itemsHost) {
            itemsHost.innerHTML = '';
          }
        }
        return;
      }

      if (event.target.closest?.('[data-pa-close-drawer]')) {
        const drawer = root.querySelector('[data-pa-drawer]');
        if (drawer) drawer.outerHTML = drawerHtml(null, activityNameOptions, state);
        setDocumentEditMode(root, false);
        return;
      }

      const editBtn = event.target.closest?.('[data-pa-edit-row]');
      if (editBtn) {
        if (!canManage) return;
        const row = rowWithCentralContact(data.rows.find((item) => text(item.id) === text(editBtn.dataset.paEditRow)));
        const host = root.querySelector('[data-pa-inline-form]');
        if (host && row) {
          let items = [];
          try {
            if (typeof api.readProposalAgreementItems === 'function') {
              items = await api.readProposalAgreementItems(text(row.id));
            }
          } catch { items = []; }
          host.innerHTML = formHtml('edit', row, activityNameOptions, contactOptions, items, proposalActivityPricing);
          setDocumentEditMode(root, false);
          setupTypeChangeHandler(host);
          setupClientSelector(host);
          setupActivityPickers(host);
          setupItemCalc(host);
          setupFormStepper(host);
          const pickerHost = host.querySelector('[data-pa-contact-picker-host]');
          if (pickerHost && pickerHost.children.length) {
            setupContactPicker(pickerHost, host.querySelector('[data-pa-form]'));
          }
        }
        return;
      }


      const editDocumentBtn = event.target.closest?.('[data-pa-edit-document]');
      if (editDocumentBtn) {
        if (!canManage) return;
        const id = text(editDocumentBtn.dataset.paEditDocument);
        const row = data.rows.find((r) => text(r.id) === id);
        if (!row || text(row.status) === 'approved') return;
        const templateKey = TEMPLATE_KEY_BY_GROUP[text(row.activity_type_group)] || 'combined';
        const loadedTemplateSections = proposalTemplateSections.filter((s) => text(s.template_key) === templateKey);
        const templateSections = loadedTemplateSections.length ? loadedTemplateSections : templateDefaultSections(templateKey);
        const workingSections = resolveDocumentSections(row, templateSections).map((section) => ({
          section_key: text(section.section_key),
          section_title: text(section.section_title),
          section_body: normalizeMultilineText(section.section_body)
        }));
        const host = root.querySelector('[data-pa-inline-form]');
        if (!host) return;
        const isCustom = Array.isArray(row.custom_document_sections) && row.custom_document_sections.length > 0;
        host.innerHTML = `<div class="ds-pa-form ds-pa-doc-edit-form" data-pa-doc-edit-wrap>
          <h4>עריכת מסמך</h4>${documentSectionsEditorHtml(workingSections, isCustom)}
          <div class="ds-pa-form-actions">
            <button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-pa-doc-save="${escapeHtml(id)}">שמירת עריכת מסמך</button>
            <button type="button" class="ds-btn ds-btn--sm" data-pa-doc-reset="${escapeHtml(id)}">איפוס לתבנית מקור</button>
            <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-pa-doc-cancel>ביטול</button>
          </div></div>`;
        setDocumentEditMode(root, true);
        return;
      }

      const docSaveBtn = event.target.closest?.('[data-pa-doc-save]');
      if (docSaveBtn) {
        if (!canManage) return;
        const id = text(docSaveBtn.dataset.paDocSave);
        const row = data.rows.find((r) => text(r.id) === id);
        const wrap = docSaveBtn.closest('[data-pa-doc-edit-wrap]');
        if (!row || !wrap) return;
        const templateKey = TEMPLATE_KEY_BY_GROUP[text(row.activity_type_group)] || 'combined';
        const loadedTemplateSections = proposalTemplateSections.filter((s) => text(s.template_key) === templateKey);
        const templateSections = loadedTemplateSections.length ? loadedTemplateSections : templateDefaultSections(templateKey);
        const sections = templateSections.map((section) => ({
          section_key: text(section.section_key),
          section_title: text(section.section_title),
          section_body: normalizeMultilineText(Array.from(wrap.querySelectorAll('[data-pa-doc-body]')).find((el) => text(el.dataset.paDocBody) === text(section.section_key))?.value)
        }));
        const result = typeof api.saveProposalAgreementCustomDocumentSections === 'function'
          ? await api.saveProposalAgreementCustomDocumentSections(id, sections)
          : await api.updateProposalAgreement(id, { ...row, custom_document_sections: sections });
        replaceLocalRow(data, result?.row || { ...row, custom_document_sections: sections });
        wrap.remove();
        setDocumentEditMode(root, false);
        refreshTable();
        return;
      }

      const docResetBtn = event.target.closest?.('[data-pa-doc-reset]');
      if (docResetBtn) {
        if (!canManage) return;
        const id = text(docResetBtn.dataset.paDocReset);
        const row = data.rows.find((r) => text(r.id) === id);
        if (!row) return;
        const result = typeof api.saveProposalAgreementCustomDocumentSections === 'function'
          ? await api.saveProposalAgreementCustomDocumentSections(id, [])
          : await api.updateProposalAgreement(id, { ...row, custom_document_sections: [] });
        replaceLocalRow(data, result?.row || { ...row, custom_document_sections: [] });
        docResetBtn.closest('[data-pa-doc-edit-wrap]')?.remove();
        setDocumentEditMode(root, false);
        refreshTable();
        return;
      }

      if (event.target.closest?.('[data-pa-doc-cancel]')) {
        event.target.closest('[data-pa-doc-edit-wrap]')?.remove();
        setDocumentEditMode(root, false);
        return;
      }

      // Preview button (drawer or inline form)
      const previewBtn = event.target.closest?.('[data-pa-preview]');
      if (previewBtn) {
        const id = text(previewBtn.dataset.paPreview);
        const row = data.rows.find((r) => text(r.id) === id);
        if (!row) return;
        previewBtn.disabled = true;
        let items = [];
        try {
          if (typeof api.readProposalAgreementItems === 'function') {
            items = await api.readProposalAgreementItems(id);
          }
        } catch { items = []; }
        previewBtn.disabled = false;
        openPreview(row, items);
        // Mark preview seen on any open form for this record
        root.querySelectorAll(`[data-pa-form][data-pa-id="${id}"]`).forEach((f) => { f.dataset.paPreviewSeen = 'yes'; });
        return;
      }

      // Print button (direct, admin + approved)
      const printBtn = event.target.closest?.('[data-pa-print]');
      if (printBtn) {
        const id = text(printBtn.dataset.paPrint);
        const row = data.rows.find((r) => text(r.id) === id);
        if (!row) return;
        printBtn.disabled = true;
        let items = [];
        try {
          if (typeof api.readProposalAgreementItems === 'function') {
            items = await api.readProposalAgreementItems(id);
          }
        } catch { items = []; }
        printBtn.disabled = false;
        openPreview(row, items);
        return;
      }

      const statusActionBtn = event.target.closest?.('[data-pa-status-action]');
      if (statusActionBtn) {
        if (!canManage) return;
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

      // Items: add row
      const addItemBtn = event.target.closest?.('[data-pa-add-item]');
      if (addItemBtn) {
        const form = addItemBtn.closest('[data-pa-form]');
        const groupKey = text(addItemBtn.dataset.paAddItemGroup);
        const groupSection = groupKey ? form?.querySelector(`[data-pa-items-group="${groupKey}"]`) : null;
        const tbody = groupSection?.querySelector('[data-pa-items-body]') || form?.querySelector('[data-pa-items-body]');
        if (!tbody) return;
        const idx = form ? form.querySelectorAll('[data-pa-item-row]').length : 0;
        const tmp = document.createElement('div');
        const currentType = text(form?.querySelector('[name="activity_type_group"]')?.value);
        const rowGroup = groupKey || currentType;
        const rowPricing = filterPricingByProposalType(proposalActivityPricing, rowGroup || currentType);
        tmp.innerHTML = itemRowHtml({ proposal_group: rowGroup }, idx, rowPricing, { groupKey: rowGroup });
        tbody.appendChild(tmp.firstElementChild);
        if (form) calcGrandTotal(form);
        if (form) updateProposalStepper(form);
        tbody.querySelector(`[data-pa-item-idx="${idx}"] [data-pa-pricing-select]`)?.focus();
        return;
      }

      // Items: remove row
      const removeItemBtn = event.target.closest?.('[data-pa-remove-item]');
      if (removeItemBtn) {
        const itemRow = removeItemBtn.closest('[data-pa-item-row]');
        const form = removeItemBtn.closest('[data-pa-form]');
        if (itemRow) itemRow.remove();
        if (form) calcGrandTotal(form);
        if (form) updateProposalStepper(form);
        return;
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
        if (!window.confirm('למחוק את הצעת המחיר?')) return;
        deleteBtn.disabled = true;
        try {
          await api.deleteProposalAgreement(id);
          data.rows = dedupeById((Array.isArray(data.rows) ? data.rows : []).filter((item) => text(item.id) !== id).map(normalizeProposalAgreementRow));
          refreshTable();
          const drawer = root.querySelector('[data-pa-drawer]');
          if (drawer) drawer.outerHTML = drawerHtml(null, activityNameOptions, state);
        setDocumentEditMode(root, false);
        } catch (err) {
          deleteBtn.disabled = false;
          window.alert(`שגיאה במחיקה: ${err?.message || err}`);
        }
        return;
      }

      if (event.target.closest?.('[data-pa-unlock-client]')) {
        const form = event.target.closest('[data-pa-form]');
        unlockClientFields(form);
        const hint = form?.querySelector('[data-pa-new-client-hint]');
        if (hint) hint.hidden = true;
        updateProposalStepper(form);
        form?.querySelector('input[name="client_authority"]')?.focus();
        return;
      }

      if (event.target.closest?.('[data-pa-new-client-toggle]')) {
        const form = event.target.closest('[data-pa-form]');
        const clientSelect = form?.querySelector('[data-pa-client-select]');
        if (clientSelect) clientSelect.value = '';
        if (form) form.dataset.paNewClient = 'yes';
        unlockClientFields(form);
        const sourceHost = form?.querySelector('[data-pa-contact-source]');
        if (sourceHost) sourceHost.innerHTML = contactSourceInputsHtml({});
        const hint = form?.querySelector('[data-pa-new-client-hint]');
        if (hint) hint.hidden = false;
        form?.querySelectorAll('[data-pa-new-client-only]').forEach((el) => { el.hidden = false; });
        const schoolField = form?.querySelector('[data-pa-school-field]');
        if (schoolField) schoolField.hidden = false;
        ['client_authority', 'school_framework', 'contact_name', 'contact_role', 'phone', 'email'].forEach((name) => {
          const inp = form?.querySelector(`input[name="${name}"]`);
          if (inp) inp.value = '';
        });
        updateProposalStepper(form);
        form?.querySelector('[data-pa-new-client-type]')?.focus?.();
        return;
      }
      if (event.target.closest?.('[data-pa-back-existing-client]')) {
        const form = event.target.closest('[data-pa-form]');
        if (!form) return;
        form.dataset.paNewClient = 'no';
        const hint = form.querySelector('[data-pa-new-client-hint]');
        if (hint) hint.hidden = true;
        form.querySelectorAll('[data-pa-new-client-only]').forEach((el) => { el.hidden = true; });
        const clientSelect = form.querySelector('[data-pa-client-select]');
        updateProposalStepper(form);
        clientSelect?.focus();
        return;
      }
      if (event.target.closest?.('[data-pa-create-client]')) {
        const btn = event.target.closest('[data-pa-create-client]');
        const form = btn?.closest('[data-pa-form]');
        if (!form) return;
        const statusEl = form.querySelector('[data-pa-new-client-create-status]');
        const clientType = text(form.querySelector('[name="new_client_type"]')?.value) || 'school';
        const authority = text(form.querySelector('input[name="client_authority"]')?.value);
        const school = clientType === 'authority' ? '' : text(form.querySelector('input[name="school_framework"]')?.value);
        const contactName = text(form.querySelector('input[name="contact_name"]')?.value);
        const contactRole = text(form.querySelector('input[name="contact_role"]')?.value);
        const phone = text(form.querySelector('input[name="phone"]')?.value);
        const email = text(form.querySelector('input[name="email"]')?.value);
        if (!authority) { if (statusEl) statusEl.textContent = 'יש להזין שם רשות / לקוח'; return; }
        if (clientType === 'school' && !school) { if (statusEl) statusEl.textContent = 'יש להזין שם בית הספר'; return; }
        if (!contactName) { if (statusEl) statusEl.textContent = 'יש להזין שם איש קשר'; return; }
        const clientName = clientType === 'school' ? school : authority;
        try {
          btn.disabled = true;
          if (statusEl) statusEl.textContent = 'יוצר לקוח...';
          const result = await api.addProposalClient({
            client_type: clientType,
            client_name: clientName,
            authority,
            school: school || null,
            contact_name: contactName,
            contact_role: contactRole || null,
            phone: phone || null,
            email: email || null,
            active: 'פעיל'
          });
          const newRow = result.row || {};
          if (newRow.id != null) contactOptions.push(newRow);
          const authInput = form.querySelector('input[name="client_authority"]');
          const schoolInput = form.querySelector('input[name="school_framework"]');
          if (authInput) authInput.value = authority;
          if (schoolInput) schoolInput.value = school;
          fillContactFields(form, { contact_name: contactName, contact_role: contactRole, phone, email });
          setContactSource(form, newRow);
          form.dataset.paNewClient = 'no';
          form.querySelectorAll('[data-pa-new-client-only]').forEach((el) => { el.hidden = true; });
          const hint = form.querySelector('[data-pa-new-client-hint]');
          if (hint) hint.hidden = true;
          lockClientFields(form, authority, school, contactName, contactRole, phone, email, clientName);
          const clientSelectEl = form.querySelector('[data-pa-client-select]');
          if (clientSelectEl) {
            const tmp = document.createElement('div');
            tmp.innerHTML = clientSelectHtml(contactOptions, { client_authority: authority, school_framework: school });
            const newSelect = tmp.querySelector('[data-pa-client-select]');
            if (newSelect) { clientSelectEl.replaceWith(newSelect); setupClientSelector(form); }
          }
          updateProposalStepper(form);
          if (statusEl) statusEl.textContent = '';
        } catch (err) {
          if (statusEl) statusEl.textContent = `שגיאה: ${err?.message || err}`;
          btn.disabled = false;
        }
        return;
      }

      const previewFormBtn = event.target.closest?.('[data-pa-preview-form]');
      if (previewFormBtn) {
        const form = previewFormBtn.closest('[data-pa-form]');
        if (!form) return;
        const payload = payloadFromForm(form);
        const tempRow = { ...payload, id: text(form.dataset.paId) || '' };
        const items = payload._items || [];
        openPreview(tempRow, items, {
          onSave: async () => { await saveForm(form, 'draft'); }
        });
        form.dataset.paPreviewSeen = 'yes';
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
