import { escapeHtml } from './shared/html.js';
import { dsCard, dsEmptyState, dsPageHeader, dsScreenStack, dsTableWrap } from './shared/layout.js';
import { showToast } from './shared/toast.js';

export const PROPOSALS_AGREEMENTS_ALLOWED_ROLES = new Set(['domain_manager', 'operation_manager', 'admin', 'business_development_manager']);
export const PROPOSALS_AGREEMENTS_MANAGE_ROLES = new Set(['domain_manager', 'operation_manager', 'admin']);
const SEARCH_DEBOUNCE_MS = 280;

// Business data for proposal groups, templates and aliases must come from Supabase/API data.
// This frontend keeps only UI logic and derives options from the loader payload.
const TEST_HOURS_REGEX = /(?:שעות\s*)?בדיק(?:ה|ות)?/i;
const PUBLIC_BASE = import.meta.env?.BASE_URL || './';
const PROPOSAL_SIGNATURE_IMAGE = 'proposals/signature-idan-nahum.png';
const DEFAULT_SIGNATURE_META = Object.freeze({ image: PROPOSAL_SIGNATURE_IMAGE });
const DEFAULT_SIGNER_NAME = 'עידן נחום, סמנכ״ל כספים ותפעול';

export const STATUS_OPTIONS = ['draft', 'sent', 'returned_for_changes', 'approved', 'cancelled'];
export const STATUS_LABELS = {
  draft:                'טיוטה',
  sent:                 'נשלח',
  pending_approval:     'ממתין לאישור',
  returned_for_changes: 'הוחזר לתיקון',
  approved:             'מאושר',
  cancelled:            'בוטל'
};
const STATUS_ALIASES = { pending_approval: 'sent' };
function normalizeProposalStatus(status) {
  const raw = text(status);
  return STATUS_ALIASES[raw] || raw;
}

const FIELD_LABELS = {
  client_authority:    'רשות / מועצה / עירייה',
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

function canApproveProposalsAgreements(state) {
  return userRole(state) === 'admin' || permFlag(state?.user?.approve_proposals_agreements);
}

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}


const EMPTY_PROPOSAL_GROUP_LOOKUPS = Object.freeze({
  groups: [],
  groupByKey: new Map(),
  aliasToKey: new Map()
});
let proposalGroupLookups = EMPTY_PROPOSAL_GROUP_LOOKUPS;

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return value.split(',').map(text).filter(Boolean);
  }
  return [];
}

function normalizeProposalGroupRecord(record = {}, fallbackIndex = 0) {
  const groupKey = text(record.group_key || record.key || record.value || record.id || record.display_name || record.name || record.label);
  if (!groupKey) return null;
  const displayName = text(record.display_name || record.name || record.label || record.title || groupKey);
  const templateKey = text(record.template_key || record.template || record.document_template_key || groupKey);
  const aliases = toArray(record.aliases || record.alias_names || record.legacy_names || record.old_names);
  const includedGroupKeys = toArray(record.included_group_keys || record.child_group_keys || record.child_groups || record.includes)
    .map(text).filter(Boolean);
  return {
    ...record,
    group_key: groupKey,
    display_name: displayName,
    template_key: templateKey,
    sort_order: Number(record.sort_order ?? record.order ?? fallbackIndex + 1) || fallbackIndex + 1,
    is_active: record.is_active !== false,
    is_combined: record.is_combined === true || record.allows_multiple_groups === true || includedGroupKeys.length > 0,
    show_gefen: record.show_gefen !== false,
    included_group_keys: includedGroupKeys,
    aliases: aliases.filter(Boolean)
  };
}

function dataGroupAliasRows(data = {}) {
  return Array.isArray(data.proposalGroupAliases)
    ? data.proposalGroupAliases
    : Array.isArray(data.proposal_group_aliases) ? data.proposal_group_aliases : [];
}

function collectGroupRecords(data = {}, rows = [], pricingOptions = []) {
  const directGroups = [
    data.proposalActivityGroups,
    data.proposalGroups,
    data.activityTypeGroups,
    data.proposal_activity_groups
  ].find(Array.isArray) || [];
  const groups = [];
  const seen = new Set();
  // Names already covered by Supabase groups/aliases must not become standalone groups.
  const knownNames = new Set();
  dataGroupAliasRows(data).forEach((aliasRow) => {
    const alias = text(aliasRow.alias_name || aliasRow.alias || aliasRow.name || aliasRow.value);
    if (alias) knownNames.add(alias);
  });
  const addGroup = (record, idx = groups.length) => {
    const normalized = normalizeProposalGroupRecord(record, idx);
    if (!normalized || seen.has(normalized.group_key)) return;
    seen.add(normalized.group_key);
    knownNames.add(normalized.group_key);
    knownNames.add(normalized.display_name);
    normalized.aliases.forEach((alias) => knownNames.add(alias));
    groups.push(normalized);
  };

  directGroups.forEach(addGroup);

  const addRawGroup = (value) => {
    const raw = text(value);
    if (!raw || seen.has(raw) || knownNames.has(raw)) return;
    addGroup({ group_key: raw, display_name: raw, template_key: raw, is_active: true }, groups.length);
  };

  (Array.isArray(rows) ? rows : []).forEach((row) => addRawGroup(row.activity_type_group || row.proposal_group));
  (Array.isArray(pricingOptions) ? pricingOptions : []).forEach((row) => addRawGroup(row.proposal_group || row.activity_type_group));

  return groups.filter((group) => group.is_active).sort((a, b) => a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name, 'he'));
}

function setProposalGroupLookups(data = {}, rows = [], pricingOptions = []) {
  const groups = collectGroupRecords(data, rows, pricingOptions);
  const groupByKey = new Map();
  const aliasToKey = new Map();
  groups.forEach((group) => {
    groupByKey.set(group.group_key, group);
    aliasToKey.set(group.group_key, group.group_key);
    aliasToKey.set(group.display_name, group.group_key);
    group.aliases.forEach((alias) => aliasToKey.set(alias, group.group_key));
  });
  dataGroupAliasRows(data)
    .forEach((aliasRow) => {
      const alias = text(aliasRow.alias_name || aliasRow.alias || aliasRow.name || aliasRow.value);
      const groupKey = text(aliasRow.group_key || aliasRow.target_group_key || aliasRow.proposal_group_key);
      if (alias && groupKey) aliasToKey.set(alias, groupKey);
    });
  proposalGroupLookups = { groups, groupByKey, aliasToKey };
  return proposalGroupLookups;
}

function normalizeProposalGroup(value) {
  const raw = text(value);
  if (!raw) return '';
  return proposalGroupLookups.aliasToKey.get(raw) || raw;
}

function proposalGroupMeta(value) {
  const key = normalizeProposalGroup(value);
  return proposalGroupLookups.groupByKey.get(key) || null;
}

function proposalGroupDisplayName(value) {
  const raw = text(value);
  if (!raw) return '';
  const meta = proposalGroupMeta(raw);
  return meta?.display_name || raw;
}

function proposalGroupTemplateKey(value) {
  const meta = proposalGroupMeta(value);
  return text(meta?.template_key || normalizeProposalGroup(value));
}

function isCombinedProposalGroup(value) {
  const meta = proposalGroupMeta(value);
  return Boolean(meta?.is_combined || (Array.isArray(meta?.included_group_keys) && meta.included_group_keys.length));
}

function includedProposalGroups(value) {
  const meta = proposalGroupMeta(value);
  return (Array.isArray(meta?.included_group_keys) ? meta.included_group_keys : [])
    .map(normalizeProposalGroup)
    .filter(Boolean);
}

function shouldShowGefenForGroup(value) {
  const meta = proposalGroupMeta(value);
  return meta?.show_gefen !== false;
}

function proposalGroupOptions(data = {}, rows = [], pricingOptions = []) {
  const lookups = setProposalGroupLookups(data, rows, pricingOptions);
  return lookups.groups.map((group) => ({ value: group.group_key, label: group.display_name }));
}

function itemTypeOptions(pricingOptions = []) {
  return [...new Set((Array.isArray(pricingOptions) ? pricingOptions : [])
    .map((row) => text(row.item_type))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'));
}

// Module-level pricing lookup so form extraction can always resolve the picked
// pricing row (item_name, pricing_key, unit_price) even if a row input was not filled.
const EMPTY_PRICING_LOOKUP = Object.freeze({ byOptionKey: new Map(), byNo: new Map(), byName: new Map() });
let proposalPricingLookup = EMPTY_PRICING_LOOKUP;

function setProposalPricingLookup(pricingOptions = []) {
  const byOptionKey = new Map();
  const byNo = new Map();
  const byName = new Map();
  (Array.isArray(pricingOptions) ? pricingOptions : []).forEach((row, idx) => {
    const optionKey = pricingOptionKey(row, idx);
    if (optionKey && !byOptionKey.has(optionKey)) byOptionKey.set(optionKey, row);
    const no = text(row.activity_no);
    if (no && !byNo.has(no)) byNo.set(no, row);
    const rawName = text(row.activity_name);
    if (rawName && !byName.has(rawName)) byName.set(rawName, row);
    const publicName = publicActivityName(row.activity_name);
    if (publicName && !byName.has(publicName)) byName.set(publicName, row);
  });
  proposalPricingLookup = { byOptionKey, byNo, byName };
  return proposalPricingLookup;
}

function lookupPricingRow({ optionKey = '', activityNo = '', itemName = '' } = {}) {
  const key = text(optionKey);
  if (key && proposalPricingLookup.byOptionKey.has(key)) return proposalPricingLookup.byOptionKey.get(key);
  const no = text(activityNo);
  if (no && proposalPricingLookup.byNo.has(no)) return proposalPricingLookup.byNo.get(no);
  const name = text(itemName);
  if (name && proposalPricingLookup.byName.has(name)) return proposalPricingLookup.byName.get(name);
  const publicName = publicActivityName(itemName);
  if (publicName && proposalPricingLookup.byName.has(publicName)) return proposalPricingLookup.byName.get(publicName);
  return null;
}


// Public display helpers: keep Supabase/internal ids in data fields only, never in customer-facing UI.
function stripInternalActivityPrefix(value) {
  let s = text(value);
  if (!s) return '';
  // Examples cleaned: "13 — חללית בראשית", "013 - חללית", "מס׳ 13 — חללית".
  s = s.replace(/^\s*(?:מס\s*[׳'`]?\s*)?\d{1,5}\s*(?:[.)]|[-–—:])\s*/u, '').trim();
  return s;
}

function publicActivityName(value) {
  return stripInternalActivityPrefix(value)
    .replace(/\s{2,}/g, ' ')
    .replace(/^[-–—:]+\s*/u, '')
    .trim();
}

function publicActivityLabelFromRow(row = {}) {
  return publicActivityName(row.activity_name || row.item_name || row.pricing_activity_name || row.name || '');
}

function numberValue(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function itemUnitPrice(item = {}) {
  return numberValue(item.unit_price) ?? numberValue(item.price) ?? 0;
}

function cleanCustomerText(value) {
  return normalizeMultilineText(value)
    .split('\n')
    .map((line) => publicActivityName(line))
    .join('\n')
    .trim();
}

function bundleChildrenFromInputValue(value) {
  const raw = text(value) || '[]';
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
    row.id, row.client_name, row.client_authority, row.school_framework, row.authority_code, row.semel_mosad,
    row.document_type,
    row.activity_type_group, proposalGroupDisplayName(row.activity_type_group),
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
    client_name:         text(row.client_name),
    client_type:         text(row.client_type),
    authority_id:        row.authority_id ?? null,
    school_id:           row.school_id ?? null,
    contact_school_id:   row.contact_school_id ?? null,
    client_authority:    text(row.client_authority),
    school_framework:    text(row.school_framework),
    authority_code:      text(row.authority_code),
    semel_mosad:         text(row.semel_mosad),
    document_type:       text(row.document_type) || 'הצעת מחיר',
    activity_type_group: normalizeProposalGroup(rawGroup),
    proposal_date:       text(row.proposal_date),
    activity_names:      normalizeActivityNames(row.activity_names),
    contact_name:        text(row.contact_name),
    contact_role:        text(row.contact_role),
    phone:               text(row.phone),
    email:               text(row.email),
    notes:               text(row.notes),
    status:              (new Set(['draft', 'sent', 'pending_approval', 'returned_for_changes', 'approved', 'cancelled'])).has(text(row.status)) ? text(row.status) : 'draft',
    approval_note:       text(row.approval_note),
    total_amount:        row.total_amount != null ? Number(row.total_amount) || null : null,
    custom_document_sections: Array.isArray(row.custom_document_sections) ? row.custom_document_sections.map(normalizeDocumentSection) : [],
    include_catalog:     false,
    signature_meta:      normalizeSignatureMeta(row.signature_meta || row.approval_meta),
    created_at:          text(row.created_at),
    approved_by:         text(row.approved_by),
    approved_at:         text(row.approved_at),
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
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
  }
  return s;
}

function signatureSectionHtml(_signatureBody = '', row = {}, options = {}) {
  const meta = normalizeSignatureMeta(row.signature_meta || row.approval_meta);
  const hasSavedSignature = Boolean(meta?.signature?.image);
  const showSignatureImage = hasSavedSignature || options.showSignatureImage === true;
  const img = text(meta?.signature?.image) || PROPOSAL_SIGNATURE_IMAGE;
  const imageHtml = showSignatureImage
    ? `<img class="pa-signature-image" src="${PUBLIC_BASE}${escapeHtml(img)}" alt="חתימת עידן נחום" loading="eager" decoding="async" onerror="this.style.display='none';">`
    : '';

  return `<div class="pa-footer-signature" aria-label="חתימה">
    <div class="pa-blessing">בברכה,</div>
    <div class="pa-signer-block">
      ${imageHtml}
      <div class="pa-signature-rule" aria-hidden="true"></div>
      <div class="pa-signer-name">${DEFAULT_SIGNER_NAME}</div>
    </div>
  </div>`;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeSignatureMeta(value) {
  let raw = value;
  if (typeof raw === 'string' && raw.trim()) {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  const source = raw?.signature && typeof raw.signature === 'object' ? raw.signature : raw;
  if (!source || typeof source !== 'object') return null;
  const image = text(source.image) || PROPOSAL_SIGNATURE_IMAGE;
  return { signature: { image } };
}

function defaultSignatureMeta() {
  return { signature: { ...DEFAULT_SIGNATURE_META } };
}

function formatCurrency(num) {
  if (num == null || num === '' || isNaN(Number(num))) return '';
  return Number(num).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function currencyAmountHtml(num) {
  if (num == null || num === '' || isNaN(Number(num))) return '';
  const value = Number(num);
  const formatted = formatCurrency(Math.abs(value));
  const prefix = value < 0 ? '-' : '';
  return `<span class="pa-currency-amount" dir="ltr">${escapeHtml(`${prefix}${formatted}`)}\u00a0₪</span>`;
}

function sortRows(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const dateA = text(a.proposal_date) || '';
    const dateB = text(b.proposal_date) || '';
    if (dateB !== dateA) return dateB.localeCompare(dateA);
    const tsA = text(a.updated_at) || text(a.created_at) || '';
    const tsB = text(b.updated_at) || text(b.created_at) || '';
    return tsB.localeCompare(tsA);
  });
}

function rowMatches(row, filters) {
  const q = normalizeSearch(filters.q);
  if (q && !normalizeSearch(row._searchText).includes(q)) return false;
  if (filters.activity_type_group && normalizeProposalGroup(row.activity_type_group) !== normalizeProposalGroup(filters.activity_type_group)) return false;
  if (filters.status && normalizeProposalStatus(row.status) !== filters.status) return false;
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
  const pairs = (Array.isArray(values) ? values : []).map((value) =>
    (value && typeof value === 'object') ? { value: text(value.value), label: text(value.label || value.value) } : { value: text(value), label: text(value) });
  const options = ['<option value="">הכול</option>', ...pairs.map((pair) => optionHtml(pair.value, '', pair.label))].join('');
  return `<label class="ds-pa-filter"><span>${escapeHtml(label)}</span><select class="ds-input ds-input--sm" data-pa-filter="${escapeHtml(key)}">${options}</select></label>`;
}

function statusFilterHtml() {
  const options = ['<option value="">הכול</option>',
    ...STATUS_OPTIONS.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(STATUS_LABELS[s] || s)}</option>`)
  ].join('');
  return `<label class="ds-pa-filter"><span>סטטוס</span><select class="ds-input ds-input--sm" data-pa-filter="status">${options}</select></label>`;
}

function statusBadgeHtml(status) {
  const normalizedStatus = normalizeProposalStatus(status);
  const label = STATUS_LABELS[status] || STATUS_LABELS[normalizedStatus] || status || '—';
  if (normalizedStatus === 'sent') {
    return `<span class="ds-pa-badge ds-pa-badge--sent">✓ ${escapeHtml(label)}</span>`;
  }
  const colorMap = {
    draft:                '#888',
    pending_approval:     '#d97706',
    returned_for_changes: '#dc2626',
    approved:             '#16a34a',
    cancelled:            '#6b7280'
  };
  const color = colorMap[status] || colorMap[normalizedStatus] || '#888';
  return `<span class="ds-pa-badge" style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:0.78rem;background:${color};color:#fff;white-space:nowrap">${escapeHtml(label)}</span>`;
}

function statusSelectHtml(row, enabled, canApprove = false) {
  const currentStatus = STATUS_OPTIONS.includes(normalizeProposalStatus(row?.status)) ? normalizeProposalStatus(row.status) : 'draft';
  if (currentStatus === 'sent') {
    return statusBadgeHtml(currentStatus);
  }
  const selectableStatuses = canApprove ? STATUS_OPTIONS : STATUS_OPTIONS.filter((status) => status !== 'approved');
  const options = selectableStatuses.map((status) => optionHtml(status, currentStatus, STATUS_LABELS[status] || status)).join('');
  const disabled = enabled ? '' : ' disabled aria-disabled="true"';
  return `<select class="ds-pa-status-select" data-pa-row-status data-pa-status-id="${escapeHtml(row?.id || '')}" data-pa-previous-status="${escapeHtml(currentStatus)}" aria-label="עדכון סטטוס הצעה"${disabled}>${options}</select>`;
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
    } else if (key === 'activity_type_group') {
      displayValue = proposalGroupDisplayName(row[key]);
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
  const canManage = canManageProposalsAgreements(state);
  const isAdmin = canApproveProposalsAgreements(state);
  return rows.map((row) => {
    const status = text(row.status || 'draft');
    const isSent = normalizeProposalStatus(status) === 'sent';
    const actionBtns = [];
    actionBtns.push(`<button type="button" class="ds-btn ds-btn--xs ds-btn--ghost ds-pa-row-action" data-pa-preview="${escapeHtml(row.id)}" title="תצוגה מקדימה">צפייה</button>`);
    if (!isSent && canManage && (['draft', 'returned_for_changes'].includes(status) || (isAdmin && status !== 'approved'))) {
      actionBtns.push(`<button type="button" class="ds-btn ds-btn--xs ds-pa-row-action" data-pa-edit-row="${escapeHtml(row.id)}" title="עריכה">עריכה</button>`);
    }
    if (canManage && (status === 'approved' || isSent)) {
      actionBtns.push(`<button type="button" class="ds-btn ds-btn--xs ds-btn--ghost ds-pa-row-action" data-pa-clone-row="${escapeHtml(row.id)}" title="שכפול להצעה חדשה">שכפול</button>`);
    }
    if (isAdmin && (status === 'approved' || isSent)) {
      actionBtns.push(`<button type="button" class="ds-btn ds-btn--xs ds-btn--ghost ds-pa-row-action" data-pa-print="${escapeHtml(row.id)}" title="הדפסה">PDF</button>`);
    }
    if (isAdmin) {
      actionBtns.push(`<button type="button" class="ds-btn ds-btn--xs ds-btn--ghost ds-pa-row-action ds-pa-row-action--danger" data-pa-delete-row="${escapeHtml(row.id)}" title="מחיקה">מחיקה</button>`);
    }
    return `
    <tr data-pa-row-id="${escapeHtml(row.id)}" tabindex="0">
      <td>${escapeHtml(row.client_name || row.client_authority || '—')}</td>
      <td>${escapeHtml(row.school_framework || '—')}</td>
      <td>${escapeHtml(proposalGroupDisplayName(row.activity_type_group) || '—')}</td>
      <td>${escapeHtml(formatDateDisplay(row.proposal_date) || '')}</td>
      <td>${statusSelectHtml(row, canManage, isAdmin)}</td>
      <td>${row.total_amount != null ? `${escapeHtml(formatCurrency(row.total_amount))} ₪` : ''}</td>
      <td class="ds-pa-actions-cell">${actionBtns.join('')}</td>
    </tr>`;
  }).join('');
}

function tableHtml(rows, state) {
  return dsTableWrap(`
    <table class="ds-table ds-pa-table" data-pa-table>
      <thead><tr><th>רשות / מועצה / עירייה</th><th>בית ספר / מסגרת</th><th>סוג הצעה</th><th>תאריך הצעה</th><th>סטטוס</th><th>סה״כ</th><th>פעולות</th></tr></thead>
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

function hiddenField(key, value) {
  return `<input type="hidden" name="${key}" value="${escapeHtml(value || '')}">`;
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

function isCatalogContactRow(contact = {}) {
  const source = text(contact._catalog_source);
  return source === 'authorities' || source === 'schools';
}

function catalogIdMatch(left, right) {
  return String(left ?? '') === String(right ?? '');
}

function filterContactsForClient(contactOptions, { authorityId, schoolId } = {}) {
  if (!authorityId || !schoolId) return [];
  return (Array.isArray(contactOptions) ? contactOptions : []).filter((contact) => {
    if (!text(contact.contact_name) || isCatalogContactRow(contact)) return false;
    if (!catalogIdMatch(contact.authority_id, authorityId)) return false;
    if (!catalogIdMatch(contact.school_id, schoolId)) return false;
    return true;
  });
}

function catalogAuthorityName(row = {}) {
  return text(row.authority_name || row.authority || row.client_name);
}

function catalogSchoolName(row = {}) {
  return text(row.school_name || row.school || row.client_name);
}

function clientSearchHtml(_contactOptions, row = {}) {
  const existingAuthority = text(row.client_authority);
  const existingSchool = text(row.school_framework);
  const hasSchool = existingSchool && existingSchool !== existingAuthority;
  return `<div class="ds-pa-client-search" data-pa-client-search-wrap>
    <label class="ds-pa-form-field ds-pa-form-field--client-search" data-pa-client-search-field>
      <span data-pa-client-search-label>רשות</span>
      <input class="ds-input ds-input--sm" type="search" data-pa-client-search-input value="${escapeHtml(existingAuthority)}" placeholder="חיפוש לפי שם רשות, קוד רשות או מחוז" autocomplete="off" aria-autocomplete="list">
    </label>
    <div class="ds-pa-client-results" data-pa-client-results hidden></div>
    <div class="ds-pa-school-search-panel" data-pa-school-search-panel hidden>
      <p class="ds-pa-school-step-text">רשות נבחרה: <strong data-pa-step-authority-name-school></strong>
        <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-pa-change-authority-step>שנה רשות</button>
      </p>
      <label class="ds-pa-form-field ds-pa-form-field--client-search" data-pa-school-search-field>
        <span>בית ספר / מסגרת</span>
        <input class="ds-input ds-input--sm" type="search" data-pa-school-search-input value="${escapeHtml(hasSchool ? existingSchool : '')}" placeholder="חיפוש לפי שם בית ספר או סמל מוסד" autocomplete="off" aria-autocomplete="list">
      </label>
      <div class="ds-pa-client-results" data-pa-school-results hidden></div>
    </div>
  </div>`;
}

function contactPickerHtml(contactOptions, authority, school, selectedContactName, authorityId = null, schoolId = null) {
  const contacts = filterContactsForClient(contactOptions, { authorityId, schoolId });
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


function normalizedKindText(value) {
  return text(value).replace(/["'׳״]/g, '').toLowerCase();
}

function groupKindText(value) {
  const normalized = normalizeProposalGroup(value);
  const meta = proposalGroupMeta(normalized);
  return [
    normalized,
    meta?.display_name,
    meta?.template_key,
    meta?.document_title,
    meta?.proposal_title,
    meta?.title,
    ...(Array.isArray(meta?.aliases) ? meta.aliases : [])
  ].map(normalizedKindText).filter(Boolean).join(' ');
}

function itemKindText(item = {}) {
  return [
    item.item_type,
    item.type,
    item.catalog_type,
    item.proposal_group,
    item.activity_type_group,
    item.item_name,
    item.pricing_activity_name,
    item.activity_name,
    item.source_pricing_key,
    item.pricing_key
  ].map(normalizedKindText).filter(Boolean).join(' ');
}

function isSummerKindText(value = '') {
  return /קיץ|קייטנה|summer/.test(value);
}

function isSummerProposalGroup(value = '') {
  return isSummerKindText(groupKindText(value));
}

function isWorkshopKindText(value = '') {
  return /סדנ|workshop|stem|חלל/.test(value);
}

function isCourseKindText(value = '') {
  return /קורס|תוכנית|תכנית|הדרכה|שנת|שנה הבאה|תשפ|program|course/.test(value);
}

function isNonCourseActivityKindText(value = '') {
  return /פעילו|פעילות|משחק|game|activity/.test(value);
}

function explicitCatalogKindText(item = {}) {
  return [
    item.item_type,
    item.type,
    item.catalog_type,
    item.proposal_group,
    item.activity_type_group
  ].map(normalizedKindText).filter(Boolean).join(' ');
}

function hasExplicitCourseKind(item = {}) {
  const kindText = explicitCatalogKindText(item);
  return isCourseKindText(kindText) && !isWorkshopKindText(kindText) && !isNonCourseActivityKindText(kindText);
}

function itemCatalogKind(item = {}) {
  if (!item || isTestHoursItem(item)) return '';
  const displayMode = text(item.proposal_display_mode);
  if (displayMode === 'bundle_child') return '';
  if (displayMode === 'bundle_parent' || item.is_bundle_parent) return 'workshop';
  const kindText = itemKindText(item);
  if (isSummerKindText(kindText)) return 'summer';
  if (isWorkshopKindText(kindText)) return 'workshop';
  if (hasExplicitCourseKind(item)) return 'course';
  return '';
}

function proposalActivityKind(row = {}, items = []) {
  const group = normalizeProposalGroup(row.activity_type_group);
  if (isCombinedProposalGroup(group)) return 'combined';
  const kindText = groupKindText(group || row.activity_type_group);
  if (/משולב|combined/.test(kindText)) return 'combined';
  if (isSummerKindText(kindText)) return 'summer';
  if (isWorkshopKindText(kindText)) return 'workshop';
  if (isNonCourseActivityKindText(kindText)) return 'activity';
  if (isCourseKindText(kindText)) return 'course';

  const itemKinds = new Set((Array.isArray(items) ? items : [])
    .map(itemCatalogKind)
    .filter(Boolean));
  if (itemKinds.size > 1) return 'combined';
  return itemKinds.values().next().value || 'course';
}

function activityIntroForCatalog(row = {}, items = [], hasCatalogAppendix = true) {
  const appendixSuffix = hasCatalogAppendix ? ' מצורף כנספח להצעה זו.' : '.';
  switch (proposalActivityKind(row, items)) {
    case 'workshop':
      return `פירוט הסדנאות המוצעות${appendixSuffix}`;
    case 'summer':
      return `פירוט הפעילויות המוצעות${appendixSuffix}`;
    case 'combined':
    case 'activity':
      return `פירוט הפעילויות המוצעות${appendixSuffix}`;
    case 'course':
    default:
      return hasCatalogAppendix
        ? 'ההצעה כוללת קורסים ותוכניות חינוכיות לשנת הלימודים תשפ״ז. פירוט התכנים, מבנה הקורסים והמידע הפדגוגי מצורפים כנספח להצעה זו.'
        : 'ההצעה כוללת קורסים ותוכניות חינוכיות לשנת הלימודים תשפ״ז.';
  }
}

function pricingOptionKey(row = {}) {
  return [row.activity_no, row.activity_name, row.item_type, row.proposal_group, row.unit_duration, row.unit_price, row.sort_order].map(text).join('||');
}

function proposalGroupText(item = {}) {
  return normalizeProposalGroup(item.proposal_group || item.activity_type_group);
}

function itemBelongsToGroup(item = {}, groupKey = '') {
  const target = normalizeProposalGroup(groupKey);
  if (!target) return true;
  const itemGroup = proposalGroupText(item);
  return !itemGroup || itemGroup === target;
}

function shouldShowGefenForItem(item = {}, contextGroup = '') {
  const group = normalizeProposalGroup(contextGroup || item.proposal_group || item.activity_type_group);
  return Boolean(text(item.gefen_number)) && shouldShowGefenForGroup(group);
}

function paNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function recalculateHourlyPriceValue(unitPrice, hoursCount) {
  const price = paNumberOrNull(unitPrice);
  const hours = paNumberOrNull(hoursCount);
  if (price == null || hours == null || hours <= 0) return null;
  return Number((price / hours).toFixed(4));
}

function buildInfoStripInnerHtml(item = {}, contextGroup = '') {
  const numVal = paNumberOrNull;
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
    if (hourlyPrice != null && hourlyPrice > 0) parts.push(`${formatCurrency(hourlyPrice)} ₪ לשעה`);
  }

  // Unit price
  const unitPrice = numVal(item.unit_price);
  if (unitPrice != null && unitPrice > 0) {
    parts.push(showGefen
      ? `מחיר לקבוצה ${formatCurrency(unitPrice)} ₪`
      : `${formatCurrency(unitPrice)} ₪`);
  }

  if (!parts.length) return '';
  return `<span class="ds-pa-info-summary">${parts.join(' | ')}</span>`;
}

function isSummerItemRowContext(contextGroup = '') {
  return isSummerProposalGroup(contextGroup);
}

function itemRowHtml(item = {}, idx = 0, pricingOptions = [], options = {}) {
  const n = (v) => (v != null && v !== '' && !isNaN(Number(v))) ? escapeHtml(String(v)) : '';
  const calcTotal = (Number(item.quantity) || 0) && (Number(item.unit_price) || 0)
    ? String(((Number(item.quantity) || 0) * (Number(item.unit_price) || 0)).toFixed(2))
    : n(item.total_price);
  const selectedPricingKey = text(item.pricing_option_key || item.pricing_activity_no || item.activity_no || item.pricing_activity_name || item.item_name);
  const pricingSelectOptionsHtml = buildPricingSelectOptionsHtml(pricingOptions, selectedPricingKey);
  const contextGroup = text(options.groupKey || item.proposal_group || '');
  const isSummerRow = isSummerItemRowContext(contextGroup);
  const gefenValue = text(item.gefen_number);
  const hasActivity = Boolean(text(item.item_name));
  const infoStripHtml = !isSummerRow && hasActivity ? buildInfoStripInnerHtml(item, contextGroup) : '';
  const activitySelectLabel = isSummerRow ? 'פעילות' : 'בחירת פעילות / קורס';
  const meetingsHoursFieldsHtml = isSummerRow
    ? `<input type="hidden" name="meetings_count" value="${n(item.meetings_count)}">
    <input type="hidden" name="hours_count" value="${n(item.hours_count)}">`
    : `<label class="ds-pa-item-field"><span>מפגשים</span><input class="ds-input ds-input--sm" type="number" name="meetings_count" value="${n(item.meetings_count)}" min="0" step="1" placeholder="—"></label>
          <label class="ds-pa-item-field"><span>שעות</span><input class="ds-input ds-input--sm" type="number" name="hours_count" value="${n(item.hours_count)}" min="0" step="0.5" placeholder="—"></label>`;
  return `<article class="ds-pa-item-card ds-pa-item-row${isSummerRow ? ' ds-pa-item-row--summer' : ''}" data-pa-item-row data-pa-item-idx="${idx}" data-pa-row-group="${escapeHtml(contextGroup)}"${isSummerRow ? ' data-pa-summer-row' : ''}>
    <div class="ds-pa-item-quick-row">
      <label class="ds-pa-item-field ds-pa-item-field--select"><span>${activitySelectLabel}</span><select class="ds-input ds-input--sm" name="pricing_activity_name" data-pa-pricing-select>${pricingSelectOptionsHtml}</select></label>
      <label class="ds-pa-item-field ds-pa-item-field--qty"><span>כמות קבוצות</span><input class="ds-input ds-input--sm" type="number" name="quantity" value="${n(item.quantity) || '1'}" min="0" step="any" data-pa-item-qty></label>
      <label class="ds-pa-item-field ds-pa-item-field--price"><span>מחיר יחידה</span><input class="ds-input ds-input--sm" type="number" name="unit_price" value="${n(item.unit_price)}" min="0" step="any" data-pa-item-price></label>
      <label class="ds-pa-item-field ds-pa-item-field--total ds-pa-line-total"><span>סה״כ שורה</span><output data-pa-item-total-display>${calcTotal ? `${formatCurrency(calcTotal)} ₪` : '0 ₪'}</output><input type="hidden" name="total_price" value="${calcTotal}" data-pa-item-total></label>
      <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost ds-pa-item-remove" data-pa-remove-item aria-label="הסר שורה">✕ הסר</button>
    </div>
    <div class="ds-pa-bundle-prompt" data-pa-bundle-prompt hidden></div>
    <div class="ds-pa-item-info-strip" data-pa-item-info-strip${!isSummerRow && hasActivity ? '' : ' hidden'}>${infoStripHtml}</div>
    <details class="ds-pa-item-extra" data-pa-item-details>
      <summary class="ds-pa-item-extra-toggle">עריכה / הערות</summary>
      <div class="ds-pa-item-extra-body">
        <div class="ds-pa-item-grid ds-pa-item-grid--extras">
          <label class="ds-pa-item-field ds-pa-item-field--type"><span>סוג פעילות</span><input class="ds-input ds-input--sm" name="item_type" value="${escapeHtml(item.item_type || '')}" list="pa-item-type-list" placeholder="סוג"></label>
          <label class="ds-pa-item-field ds-pa-item-field--name"><span>שם פעילות / תוכנית</span><input class="ds-input ds-input--sm" name="item_name" value="${escapeHtml(item.item_name || '')}" placeholder="שם פעילות"></label>
          ${meetingsHoursFieldsHtml}
        </div>
        <label class="ds-pa-item-field ds-pa-item-field--full"><span>הערות או התאמות</span><textarea class="ds-input ds-input--sm" name="description" rows="2" placeholder="תיאור קצר, אם נדרש">${escapeHtml(item.description || '')}</textarea></label>
      </div>
    </details>
    <input type="hidden" name="activity_no" value="${escapeHtml(item.activity_no || item.pricing_activity_no || '')}">
    <input type="hidden" name="pricing_option_key" value="${escapeHtml(item.pricing_option_key || '')}">
    <input type="hidden" name="bundle_pricing_key" value="${escapeHtml(item.bundle_pricing_key || item.pricing_key || item.source_pricing_key || '')}">
    <input type="hidden" name="item_display_mode" value="${escapeHtml(item.proposal_display_mode || 'single')}">
    <input type="hidden" name="item_source_pricing_key" value="${escapeHtml(item.source_pricing_key || item.pricing_key || '')}">
    <input type="hidden" name="item_selected_bundle_items" value="${escapeHtml(Array.isArray(item.selected_bundle_items) ? JSON.stringify(item.selected_bundle_items) : (item.selected_bundle_items || '[]'))}">
    <input type="hidden" name="gefen_number" value="${escapeHtml(gefenValue)}">
    <input type="hidden" name="gefen_number_display" value="${escapeHtml(gefenValue)}">
    <input type="hidden" name="unit_duration" value="${escapeHtml(item.unit_duration || '')}">
    <input type="hidden" name="hourly_price" value="${n(item.hourly_price)}">
    <input type="hidden" name="proposal_group" value="${escapeHtml(item.proposal_group || contextGroup || '')}">
  </article>`;
}

function combinedItemsSectionHtml(label, groupKey, items, pricingOptions, idxOffset) {
  const startItems = items.length ? items : [{ proposal_group: groupKey }];
  const rowsHtml = startItems.map((item, i) => itemRowHtml({ ...item, proposal_group: item.proposal_group || groupKey }, idxOffset + i, pricingOptions, { groupKey })).join('');
  return `<div class="ds-pa-items-section ds-pa-items-section--group" data-pa-items-group="${escapeHtml(groupKey)}">
    <div class="ds-pa-items-header">
      <span class="ds-pa-items-section-label">${escapeHtml(label)}</span>
      <button type="button" class="ds-btn ds-btn--xs" data-pa-add-item data-pa-add-item-group="${escapeHtml(groupKey)}">+ הוסף שורה</button>
    </div>
    <div class="ds-pa-items-list" data-pa-items-body data-pa-items-group-body="${escapeHtml(groupKey)}">${rowsHtml}</div>
  </div>`;
}

function activityTypeFilterHtml(pricingOptions) {
  const types = [...new Set((Array.isArray(pricingOptions) ? pricingOptions : [])
    .filter((r) => text(r.item_type) && text(r.proposal_display_mode) !== 'bundle_child')
    .map((r) => text(r.item_type)))].sort((a, b) => a.localeCompare(b, 'he'));
  if (!types.length) return '';
  const opts = ['<option value="">כל סוגי הפעילות</option>',
    ...types.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
  ].join('');
  return `<label class="ds-pa-activity-type-filter"><span style="font-size:0.75rem;white-space:nowrap">סוג פעילות:</span>
    <select class="ds-input ds-input--sm" data-pa-activity-type-filter>${opts}</select>
  </label>`;
}

function itemsEditorHtml(items = [], pricingOptions = [], activityTypeGroup = '') {
  const normalizedGroup = normalizeProposalGroup(activityTypeGroup);
  const filterHtml = isSummerProposalGroup(normalizedGroup) ? '' : activityTypeFilterHtml(pricingOptions);
  const footer = `<datalist id="pa-item-type-list">${itemTypeOptions(pricingOptions).map((v) => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
    <div class="ds-pa-items-total-row">סה״כ כללי: <strong data-pa-grand-total></strong></div>`;

  const childGroups = isCombinedProposalGroup(normalizedGroup) ? includedProposalGroups(normalizedGroup) : [];
  if (childGroups.length) {
    let idxOffset = 0;
    const sections = childGroups.map((groupKey) => {
      const groupItems = (Array.isArray(items) ? items : []).filter((item) => itemBelongsToGroup(item, groupKey));
      const groupPricing = filterPricingByProposalType(pricingOptions, groupKey);
      const sectionHtml = combinedItemsSectionHtml(proposalGroupDisplayName(groupKey), groupKey, groupItems, groupPricing, idxOffset);
      idxOffset += groupItems.length || 1;
      return sectionHtml;
    }).join('');
    return `<div class="ds-pa-items-section ds-pa-items-combined">
      <div class="ds-pa-items-header">${filterHtml}</div>
      ${sections}
      ${footer}
    </div>`;
  }

  const startItems = items.length ? items : [{ proposal_group: normalizedGroup }];
  const rowsHtml = startItems.map((item, idx) => itemRowHtml({ ...item, proposal_group: item.proposal_group || normalizedGroup }, idx, pricingOptions, { groupKey: normalizedGroup })).join('');
  return `<div class="ds-pa-items-section">
    <div class="ds-pa-items-header">
      <span style="font-size:0.76rem;color:var(--ds-color-text-muted,#64748b);font-weight:600">שורות הצעה</span>
      ${filterHtml}
      <button type="button" class="ds-btn ds-btn--xs" data-pa-add-item>+ הוסף שורה</button>
    </div>
    <div class="ds-pa-items-list" data-pa-items-body>${rowsHtml}</div>
    ${footer}
  </div>`;
}

function proposalSummaryHtml(totalAmount) {
  const initialTotal = Number(totalAmount) || 0;
  return `<section class="ds-pa-summary" aria-label="סיכום הצעה">
    <span style="display:none" data-pa-summary-client></span>
    <span style="display:none" data-pa-summary-type></span>
    <div class="ds-pa-summary-bar">
      <div class="ds-pa-summary-pill">
        <span class="ds-pa-summary-label">פעילויות</span>
        <strong class="ds-pa-summary-value" data-pa-summary-count>—</strong>
      </div>
      <div class="ds-pa-summary-pill">
        <span class="ds-pa-summary-label">לפני הנחה</span>
        <strong class="ds-pa-summary-value" data-pa-summary-subtotal>0 ₪</strong>
      </div>
      <div class="ds-pa-summary-pill">
        <span class="ds-pa-summary-label">הנחה</span>
        <strong class="ds-pa-summary-value" data-pa-summary-discount>0 ₪</strong>
      </div>
      <div class="ds-pa-summary-pill ds-pa-summary-pill--total">
        <span class="ds-pa-summary-label">לתשלום</span>
        <strong class="ds-pa-summary-value ds-pa-summary-total-val" data-pa-summary-total>${initialTotal ? `${formatCurrency(initialTotal)} ₪` : '0 ₪'}</strong>
      </div>
      <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-pa-discount-toggle>+ הנחה / הערות</button>
    </div>
    <div class="ds-pa-discount-details" data-pa-discount-details hidden>
      <div class="ds-pa-discount-row" data-pa-discount-controls>
        <label class="ds-pa-form-field"><span>הנחה</span><select class="ds-input ds-input--sm" name="discount_type" data-pa-discount-type><option value="amount">₪</option><option value="percent">%</option></select></label>
        <label class="ds-pa-form-field ds-pa-discount-amount-field"><span>סכום / אחוז</span><input class="ds-input ds-input--sm" type="number" min="0" step="any" name="discount_value" data-pa-discount-value></label>
        <label class="ds-pa-form-field ds-pa-discount-note-field"><span>הערת הנחה</span><input class="ds-input ds-input--sm" name="discount_note" data-pa-discount-note placeholder="אופציונלי"></label>
      </div>
    </div>
  </section>`;
}

const PROPOSAL_DISPLAY_MODES = new Set(['single', 'bundle_parent', 'bundle_child']);

function extractItemsFromForm(form) {
  const formGroup = text(form.querySelector('[name="activity_type_group"]')?.value);
  return Array.from(form.querySelectorAll('[data-pa-item-row]')).map((row, rowIdx) => {
    const rawBundleItems = text(row.querySelector('[name="item_selected_bundle_items"]')?.value) || '[]';
    let selectedBundleItems = [];
    try { selectedBundleItems = JSON.parse(rawBundleItems); if (!Array.isArray(selectedBundleItems)) selectedBundleItems = []; } catch { selectedBundleItems = []; }

    const fieldText = (name) => text(row.querySelector(`[name="${name}"]`)?.value);
    const fieldNumber = (name) => {
      const raw = row.querySelector(`[name="${name}"]`)?.value;
      if (raw == null || raw === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };

    // Resolve the pricing row picked in the select so saved items always carry
    // the catalog item_name / pricing_key / unit_price instead of relying on free text.
    const optionKey = fieldText('pricing_option_key') || text(row.querySelector('[data-pa-pricing-select]')?.value);
    const editedName = fieldText('item_name');
    const pricingRow = lookupPricingRow({ optionKey, activityNo: fieldText('activity_no'), itemName: editedName });
    const pricingName = publicActivityName(pricingRow?.activity_name);

    const itemName = editedName || pricingName;
    const quantity = fieldNumber('quantity') ?? 1;
    const unitPrice = fieldNumber('unit_price') ?? numberValue(pricingRow?.unit_price);
    const hoursCount = fieldNumber('hours_count') ?? numberValue(pricingRow?.hours_count);
    const hourlyPrice = recalculateHourlyPriceValue(unitPrice, hoursCount)
      ?? (hoursCount != null && hoursCount > 0 ? fieldNumber('hourly_price') : null);
    const hiddenTotal = numberValue(row.querySelector('[data-pa-item-total]')?.value);
    const totalPrice = unitPrice != null
      ? Number(((quantity || 1) * unitPrice).toFixed(2))
      : hiddenTotal;

    const rawDisplayMode = fieldText('item_display_mode');
    const displayMode = PROPOSAL_DISPLAY_MODES.has(rawDisplayMode) ? rawDisplayMode : 'single';
    const rawGroup = fieldText('proposal_group')
      || text(row.dataset.paRowGroup)
      || text(pricingRow?.proposal_group)
      || formGroup;

    return {
      activity_no:            fieldText('activity_no') || text(pricingRow?.activity_no),
      pricing_activity_no:    fieldText('activity_no') || text(pricingRow?.activity_no),
      pricing_option_key:     text(optionKey),
      item_name:              itemName,
      item_type:              fieldText('item_type') || text(pricingRow?.item_type),
      gefen_number:           fieldText('gefen_number') || text(pricingRow?.gefen_number),
      meetings_count:         fieldNumber('meetings_count') ?? numberValue(pricingRow?.meetings_count),
      hours_count:            hoursCount,
      quantity:               quantity || 1,
      unit_duration:          fieldText('unit_duration') || text(pricingRow?.unit_duration),
      unit_price:             unitPrice,
      hourly_price:           hourlyPrice,
      total_price:            totalPrice,
      description:            fieldText('description') || '',
      proposal_group:         normalizeProposalGroup(rawGroup),
      sort_order:             rowIdx,
      proposal_display_mode:  displayMode,
      source_pricing_key:     fieldText('item_source_pricing_key') || text(pricingRow?.pricing_key),
      selected_bundle_items:  selectedBundleItems
    };
  }).filter((item) => item.item_name && !isTestHoursItem(item));
}

// ─── Items summary (drawer read-only) ────────────────────────────────────────

function itemsSummaryHtml(items = []) {
  if (!Array.isArray(items) || !items.length) {
    return '<p class="ds-pa-no-items-alert" role="alert" style="font-size:0.8rem;margin:4px 0;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:6px 10px">לא נשמרו שורות פעילות להצעה זו</p>';
  }
  const visibleSummaryItems = items.filter((item) => !isTestHoursItem(item));
  const total = visibleSummaryItems.reduce((s, i) => {
    const t = Number(i.total_price) || ((Number(i.quantity) || 1) * (Number(i.unit_price) || 0));
    return s + t;
  }, 0);
  const rows = visibleSummaryItems.map((item) => {
    const t = Number(item.total_price) || ((Number(item.quantity) || 1) * (Number(item.unit_price) || 0));
    const bundleItems = Array.isArray(item.selected_bundle_items) ? item.selected_bundle_items : [];
    const bundleLinesList = bundleItems.map((bi) => {
      if (typeof bi === 'object') {
        const parts = [publicActivityName(bi.activity_name)].filter(Boolean);
        if (bi.unit_price != null && bi.unit_price !== '') parts.push(`${formatCurrency(Number(bi.unit_price))} ₪`);
        return parts.join(' — ');
      }
      return publicActivityName(bi);
    }).filter(Boolean);
    const details = [
      text(item.gefen_number) ? `גפ״ן: ${text(item.gefen_number)}` : '',
      text(item.meetings_count) ? `מפגשים: ${text(item.meetings_count)}` : '',
      text(item.hours_count) ? `שעות: ${text(item.hours_count)}` : '',
      text(item.unit_duration) ? `משך: ${text(item.unit_duration)}` : '',
      text(item.proposal_group) ? `קבוצה: ${proposalGroupDisplayName(item.proposal_group)}` : '',
      !bundleLinesList.length ? cleanCustomerText(item.description) : ''
    ].filter(Boolean).join(' | ');
    const bundleDetailHtml = bundleLinesList.length
      ? `<ul class="ds-pa-summary-bundle-list">${bundleLinesList.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
      : '';
    return `<tr>
      <td>${escapeHtml(publicActivityName(item.item_name) || '')}${details ? `<div class="ds-muted" style="font-size:0.72rem">${escapeHtml(details)}</div>` : ''}${bundleDetailHtml}</td>
      <td>${escapeHtml(item.item_type || '')}</td>
      <td>${item.quantity != null ? item.quantity : ''}</td>
      <td>${item.unit_price != null ? `${formatCurrency(item.unit_price)} ₪` : ''}</td>
      <td>${t ? `${formatCurrency(t)} ₪` : ''}</td>
    </tr>`;
  }).join('');
  return `<div class="ds-pa-items-summary">
    <h4 style="font-size:0.82rem;margin:8px 0 4px;font-weight:600">שורות הצעה</h4>
    <table class="ds-pa-items-summary-table">
      <thead><tr><th>פעילות ופרטים</th><th>סוג</th><th>כמות</th><th>מחיר יח׳</th><th>סה״כ</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size:0.83rem;margin:4px 0;text-align:start">סה״כ: <strong>${formatCurrency(total)} ₪</strong></p>
  </div>`;
}

// ─── Preview document ─────────────────────────────────────────────────────────

function templateBodyText(section) {
  return normalizeMultilineText(section?.section_body);
}

// Document title must come from Supabase data (template_name on proposal_template_sections),
// never from a generic hardcoded fallback.
function proposalTitle(row, templateSections = []) {
  const fromRow = text(row.proposal_title || row.document_title || row.title);
  if (fromRow) return fromRow;
  const fromTemplate = (Array.isArray(templateSections) ? templateSections : [])
    .map((section) => text(section?.template_name))
    .find(Boolean);
  if (fromTemplate) return fromTemplate;
  const meta = proposalGroupMeta(row.activity_type_group);
  // Last resort is the row's own document_type column (a DB value), never a hardcoded literal.
  return text(meta?.document_title || meta?.proposal_title || meta?.title) || text(row.document_type) || '';
}

function sectionBodyHtml(value, options = {}) {
  return renderSectionBodyHtml(value, options);
}

function sectionHeadingText(rawTitle, fallback = '') {
  const title = text(rawTitle) || fallback;
  if (!title) return '';
  return /[:：]\s*$/.test(title) ? title : `${title}:`;
}

function proposalLineHtml(item = {}, _options = {}) {
  const itemName = publicActivityName(item.item_name);
  if (!itemName) return '';

  const bundleItems = Array.isArray(item.selected_bundle_items) ? item.selected_bundle_items : [];
  if (bundleItems.length && (item.proposal_display_mode === 'bundle_parent' || item.is_bundle_parent)) {
    const subLines = bundleItems.map((bi) => {
      const name = typeof bi === 'object' ? publicActivityName(bi.activity_name) : publicActivityName(bi);
      return name;
    }).filter(Boolean);
    if (subLines.length) return ` ${itemName}\n${subLines.map((line) => `  • ${line}`).join('\n')}`;
  }

  return ` ${itemName}`;
}

function proposalItemsListHtml(items = [], options = {}) {
  if (!Array.isArray(items) || !items.length) return '';
  const visibleItems = items.filter((item) => !isTestHoursItem(item));
  const lines = visibleItems.map((item) => proposalLineHtml(item, options)).filter(Boolean).join('\n');
  return lines ? sectionLinesHtml(lines, { alwaysBullet: true, className: 'pa-proposal-lines' }) : '';
}

function isDiscountItem(item = {}) {
  return text(item.item_name) === 'הנחה' || Number(item.total_price) < 0 || Number(item.unit_price) < 0;
}

function costTableRowData(name, quantity, unitPrice, total) {
  if (!name || unitPrice == null || total == null || total === 0) return null;
  if (total > 0 && unitPrice <= 0) return null;
  return {
    name,
    quantity: Number(quantity) || 1,
    unitPrice,
    total
  };
}

function costTableRowsFromItem(item = {}) {
  const bundleItems = Array.isArray(item.selected_bundle_items) ? item.selected_bundle_items : [];
  const displayMode = text(item.proposal_display_mode);
  const isBundleParent = displayMode === 'bundle_parent' || item.is_bundle_parent;

  if (isBundleParent && bundleItems.length) {
    const parentQuantity = Number(item.quantity) || 1;
    const childRows = bundleItems.map((bundleItem) => {
      const name = publicActivityName(typeof bundleItem === 'object' ? bundleItem.activity_name : bundleItem);
      const unitPrice = numberValue(typeof bundleItem === 'object' ? bundleItem.unit_price : null);
      const quantity = parentQuantity;
      const total = unitPrice != null ? quantity * unitPrice : null;
      return costTableRowData(name, quantity, unitPrice, total);
    }).filter(Boolean);
    if (childRows.length) return childRows;
  }

  const name = publicActivityName(item.item_name);
  const quantity = Number(item.quantity) || 1;
  const unitPrice = numberValue(item.unit_price);
  const total = numberValue(item.total_price) ?? (unitPrice != null ? quantity * unitPrice : null);
  const row = costTableRowData(name, quantity, unitPrice, total);
  return row ? [row] : [];
}

// Customer-facing price breakdown, built only from saved proposal_agreement_items.
// Rows without a real price are never shown. Selected bundle children become billed
// rows; the parent row is omitted when children carry the actual prices.
function proposalCostTableHtml(items = []) {
  const billedItems = (Array.isArray(items) ? items : []).filter((item) =>
    !isTestHoursItem(item) && text(item.proposal_display_mode) !== 'bundle_child');
  const rows = billedItems.flatMap((item) => costTableRowsFromItem(item));
  if (!rows.length) return '';
  const subtotal = rows.filter((row) => row.total > 0).reduce((sum, row) => sum + row.total, 0);
  const discount = Math.abs(rows.filter((row) => row.total < 0).reduce((sum, row) => sum + row.total, 0));
  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);
  const discountFooter = discount > 0
    ? `<tr><td colspan="3">סה״כ לפני הנחה</td><td>${currencyAmountHtml(subtotal)}</td></tr>
       <tr><td colspan="3">הנחה</td><td>${currencyAmountHtml(-discount)}</td></tr>`
    : '';
  return `<table class="pa-cost-table pa-activities-table">
    <thead><tr><th>פעילות</th><th>כמות</th><th>מחיר יחידה</th><th>סה״כ שורה</th></tr></thead>
    <tbody>${rows.map((row) => `<tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${escapeHtml(formatCurrency(row.quantity))}</td>
        <td>${currencyAmountHtml(row.unitPrice)}</td>
        <td>${currencyAmountHtml(row.total)}</td>
      </tr>`).join('')}</tbody>
    <tfoot>${discountFooter}<tr><td colspan="3">סה״כ לתשלום</td><td>${currencyAmountHtml(grandTotal)}</td></tr></tfoot>
  </table>`;
}



function proposalDiscountSummaryHtml(items = []) {
  const allItems = Array.isArray(items) ? items : [];
  const discount = Math.abs(allItems.filter(isDiscountItem).reduce((sum, item) => sum + (Number(item.total_price) || Number(item.unit_price) || 0), 0));
  if (!discount) return '';
  const subtotal = allItems.filter((item) => !isDiscountItem(item)).reduce((sum, item) => {
    const quantity = Number(item.quantity) || 1;
    const unitPrice = numberValue(item.unit_price);
    const total = numberValue(item.total_price) ?? (unitPrice != null ? quantity * unitPrice : 0);
    return sum + (Number(total) || 0);
  }, 0);
  const payable = Math.max(subtotal - discount, 0);
  return `<table class="pa-cost-table pa-activities-table pa-discount-summary-table">
    <tbody>
      <tr><td>סה״כ לפני הנחה</td><td>${currencyAmountHtml(subtotal)}</td></tr>
      <tr><td>הנחה</td><td>${currencyAmountHtml(-discount)}</td></tr>
      <tr><td><strong>סה״כ לתשלום</strong></td><td><strong>${currencyAmountHtml(payable)}</strong></td></tr>
    </tbody>
  </table>`;
}

function itemQuantity(item = {}) {
  return Number(item.quantity) || 1;
}

function itemQuantityTotal(item = {}) {
  const quantity = itemQuantity(item);
  const unitPrice = numberValue(item.unit_price);
  const total = numberValue(item.total_price) ?? (unitPrice != null ? quantity * unitPrice : null);
  return total != null && total > 0 ? total : null;
}

function proposalItemDetailsTableHtml(items = [], contextGroup = '') {
  if (!isCourseKindText(groupKindText(contextGroup))) return '';
  const visibleItems = (Array.isArray(items) ? items : []).filter((item) =>
    !isTestHoursItem(item) && text(item.proposal_display_mode) !== 'bundle_child');
  const rows = visibleItems.map((item) => {
    const hasPedagogicPricingData = Boolean(
      text(item.gefen_number) || item.meetings_count != null || item.hours_count != null || item.hourly_price != null
    );
    if (!hasPedagogicPricingData) return '';
    const quantity = itemQuantity(item);
    const quantityTotal = itemQuantityTotal(item);
    const cells = [
      { value: publicActivityName(item.item_name) },
      { value: shouldShowGefenForItem(item, contextGroup) ? text(item.gefen_number) : '' },
      { value: item.meetings_count != null ? formatCurrency(item.meetings_count) : '' },
      { value: formatCurrency(quantity) },
      { value: item.hours_count != null ? formatCurrency(item.hours_count) : '' },
      { value: item.hourly_price != null ? currencyAmountHtml(item.hourly_price) : '', html: true },
      { value: quantityTotal != null ? currencyAmountHtml(quantityTotal) : '', html: true }
    ];
    if (!cells.some((cell) => cell.value)) return '';
    return `<tr>${cells.map((cell) => `<td>${cell.html ? (cell.value || '') : escapeHtml(cell.value || '')}</td>`).join('')}</tr>`;
  }).filter(Boolean);
  if (!rows.length) return '';
  return `<table class="pa-item-details-table pa-activities-table">
    <thead><tr><th>קורס / תוכנית</th><th>מס׳ גפ״ן</th><th>מפגשים</th><th>קבוצות</th><th>שעות</th><th>מחיר לשעה</th><th>סה״כ</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;
}

function summerActivityProposalBody() {
  return 'ההצעה כוללת פעילויות מותאמות להפעלה במהלך חודש יולי, בין התאריכים 1.7.26–30.7.26.\nכל פעילות נמשכת 45 דקות ומיועדת לקבוצה של עד 25 משתתפים.\nבסדנאות כל משתתף מכין תוצר אישי ולוקח אותו איתו בסיום הפעילות.';
}

function costsIntroBody(row = {}, items = []) {
  const groupText = groupKindText(row.activity_type_group);
  const visibleCount = (Array.isArray(items) ? items : []).filter((item) =>
    !isTestHoursItem(item) && text(item.proposal_display_mode) !== 'bundle_child' && text(item.item_name)
  ).length;
  if (isCourseKindText(groupText)) {
    return visibleCount === 1
      ? 'להלן פירוט הקורס והעלות הכלולה בהצעה.'
      : 'להלן פירוט הקורסים והעלויות הכלולות בהצעה.';
  }
  if (isSummerProposalGroup(row.activity_type_group)) {
    return 'פירוט הפעילויות והעלויות מוצג בטבלת העלויות שלהלן.';
  }
  return visibleCount ? 'פירוט הפעילויות והעלויות מוצג בטבלת העלויות שלהלן.' : '';
}

function sectionHtml(title, body, className = '', options = {}) {
  return `<section class="pa-section${className ? ` ${className}` : ''}"><h3 class="pa-section-heading">${escapeHtml(sectionHeadingText(title))}</h3>${sectionBodyHtml(body, options)}</section>`;
}

function recipientLineHtml(...values) {
  // Dedupe identical values (e.g. school_framework defaulted to client_authority)
  // so the recipient block never shows "X, X" or stray commas.
  const parts = [];
  for (const value of values.map(text)) {
    if (value && !parts.includes(value)) parts.push(value);
  }
  const line = parts.join(', ');
  return line ? `<p>${escapeHtml(line)}</p>` : '';
}

function recipientBlockHtml(row = {}) {
  const safeVal = (v) => { const s = text(v); return (s === 'undefined' || s === 'null') ? '' : s; };
  const schoolName = safeVal(row.school_framework) || safeVal(row.school_name);
  const authorityName = safeVal(row.client_authority) || safeVal(row.authority_name);
  const contactName = safeVal(row.contact_name);
  const contactRole = safeVal(row.contact_role);
  const contactParts = [];
  if (contactName) contactParts.push(`<strong>${escapeHtml(contactName)}</strong>`);
  if (contactRole && contactRole !== contactName) contactParts.push(escapeHtml(contactRole));
  const contactLine = contactParts.length ? `<p>${contactParts.join(', ')}</p>` : '';
  const orgLine = recipientLineHtml(schoolName, authorityName);
  const lines = [contactLine, orgLine].filter(Boolean);
  return `<div class="pa-doc-address pa-to-block">
    <p class="pa-label-to"><strong>לכבוד:</strong></p>
    ${lines.join('\n    ')}
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


function selectedCourseShortNamesText(row = {}, items = []) {
  const proposalGroup = normalizeProposalGroup(row.activity_type_group);
  const sourceItems = (Array.isArray(items) ? items : []).filter((item) => {
    if (isTestHoursItem(item) || text(item.proposal_display_mode) === 'bundle_child') return false;
    if (!text(item.item_name)) return false;
    const rowKind = `${groupKindText(proposalGroup)} ${normalizedKindText(row.activity_type_group)} ${proposalGroupTemplateKey(proposalGroup)}`;
    const combined = isCombinedProposalGroup(proposalGroup) || /משולב(?:ת)?|combined/.test(rowKind);
    if (!combined) return true;
    const itemGroup = normalizeProposalGroup(item.proposal_group || item.activity_type_group);
    const itemKind = itemKindText(item);
    if (isSummerKindText(itemKind) || isWorkshopKindText(itemKind)) return false;
    return isCourseKindText(groupKindText(itemGroup)) || isCourseKindText(itemKind) || itemCatalogKind(item) === 'course';
  });
  return sourceItems
    .map((item) => text(item.course_short_name || item.short_name || item.item_short_name || item.item_name))
    .filter(Boolean)
    .join('\n');
}

function applyProposalTemplatePlaceholders(body, row = {}, items = []) {
  const raw = normalizeMultilineText(body);
  if (!raw) return '';
  return raw.replace(/{{\s*selected_course_short_names\s*}}/g, selectedCourseShortNamesText(row, items));
}

function renderProposalSectionBody(body, options = {}) {
  const { className = '' } = options;
  const groups = parseSectionBodyStructure(body, options);
  if (!groups.length) return '';
  const rendered = groups.map((group) => {
    if (group.type === 'ul') {
      return `<ul class="pa-proposal-list">${group.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    }
    return group.items.map((lines) => `<p>${lines.map((line) => escapeHtml(line)).join('<br>')}</p>`).join('');
  }).join('');
  return `<div class="pa-section-body pa-section-text${className ? ` ${className}` : ''}">${rendered}</div>`;
}

function renderSectionBodyHtml(value, options = {}) {
  return renderProposalSectionBody(value, options);
}

function sectionLinesHtml(value, options = {}) {
  return renderProposalSectionBody(value, options);
}

// Proposal document text must come from Supabase.
// This frontend file is not the source of truth for proposal wording, clauses, appendices, or template sections.
// Expected Supabase-fed shape: proposalTemplateSections[] with template_key, section_key, section_title, section_body, sort_order.
function templateDefaultSections(_templateKey) {
  return [];
}

function resolveDocumentSections(row, templateSections = []) {
  const custom = Array.isArray(row?.custom_document_sections) ? row.custom_document_sections : [];
  const fromSupabase = Array.isArray(templateSections) ? templateSections : [];
  let source = custom.length ? custom : fromSupabase;
  if (custom.length) {
    const customKeys = new Set(custom.map((section) => text(section.section_key)));
    if (!customKeys.has('signature')) {
      const templateSignature = fromSupabase.find((section) =>
        text(section.section_key) === 'signature' && text(section.section_body));
      if (templateSignature) source = [...source, templateSignature];
    }
  }
  return source
    .map(normalizeDocumentSection)
    .filter((section) => text(section.section_key) || text(section.section_title) || text(section.section_body));
}

function documentSectionsEditorHtml(sections = [], isCustom = false) {
  if (!Array.isArray(sections) || !sections.length) {
    return `<div class="ds-pa-doc-editor" data-pa-doc-editor>
      <p class="ds-pa-doc-indicator ds-pa-doc-indicator--missing">לא נמצאה תבנית פעילה לסוג הצעה זה</p>
    </div>`;
  }
  const indicator = isCustom
    ? `<p class="ds-pa-doc-indicator ds-pa-doc-indicator--custom">עריכה מותאמת אישית למסמך</p>`
    : `<p class="ds-pa-doc-indicator ds-pa-doc-indicator--template">עריכת סעיפי מסמך מתוך Supabase</p>`;
  const rows = sections.map((section, idx) => `
    <label class="ds-pa-form-field ds-pa-form-field--wide">
      <span>${escapeHtml(text(section.section_title) || text(section.section_key) || `סעיף ${idx + 1}`)}</span>
      <textarea class="ds-input ds-input--sm" rows="4" data-pa-doc-body="${escapeHtml(text(section.section_key))}">${escapeHtml(String(section.section_body || ''))}</textarea>
    </label>`).join('');
  return `<div class="ds-pa-doc-editor" data-pa-doc-editor>${indicator}${rows}</div>`;
}

function buildProposalDocumentHtml({ dateDisplay, documentTitle, row, introText, sections, orgResponsibility, schoolResponsibility, paymentTerms, changesCancellation, remarks, signatureHtml, sectionLinesHtml: sectionLines }) {
  const title = text(documentTitle);
  return `
    <div class="proposal-document pa-document pa-a4-page" dir="rtl">
      <div class="proposal-document-header pa-page-header">
        <div class="proposal-header-brand pa-logo-area">
          <img
            src="${PUBLIC_BASE}proposals/proposal-header-logo.png"
            alt="לוגו תעשיידע"
            class="proposal-logo"
            loading="eager"
            decoding="async"
            onerror="this.style.display='none';"
          >
        </div>
      </div>
      ${recipientBlockHtml(row)}
      <hr class="pa-doc-divider pa-divider">
      ${dateDisplay ? `<div class="pa-doc-date pa-date-area">${escapeHtml(dateDisplay)}</div>` : ''}
      <div class="proposal-document-body">
        <div class="proposal-document-content">
          ${title ? `<h1 class="pa-doc-subject pa-doc-title">${escapeHtml(title)}</h1>` : ''}
          ${introText ? sectionLines(introText, { className: 'pa-doc-intro pa-intro-text' }) : ''}
          ${sections.join('')}
          ${orgResponsibility}
          ${schoolResponsibility}
          ${paymentTerms}
          ${changesCancellation}
          ${remarks}
          ${signatureHtml}
        </div>
      </div>
      <div class="pa-page-footer">
        <img
          src="${PUBLIC_BASE}proposals/logo.png"
          alt="לוגו תחתון תעשיידע"
          class="pa-page-footer-logo"
          loading="lazy"
          decoding="async"
          onerror="this.style.display='none';"
        >
        <span><strong>תעשיידע</strong> — תעשייה למען חינוך מתקדם (ע״ר) &nbsp;|&nbsp; www.think.org.il</span>
      </div>
    </div>`;
}

function catalogAppendixNoticeHtml(row = {}, items = []) {
  if (!includeCatalogValue(row.include_catalog)) return '';
  const count = buildProposalCatalogPdfEntries(row, items).filter((entry) => entry.path && !entry.missing).length;
  const message = count > 1
    ? `מצורפים ${count} נספחי קטלוג לקובץ ההפקה`
    : 'נספח קטלוג יצורף לקובץ הסופי';
  return `<section class="pa-catalog-appendix-notice" data-pa-catalog-appendix-notice>${escapeHtml(message)}</section>`;
}

export function proposalPreviewBodyHtml(row, items = [], templateSections = [], renderOptions = {}) {
  const activityTypeGroup = normalizeProposalGroup(row.activity_type_group);
  const templateKey = proposalGroupTemplateKey(activityTypeGroup);
  // Date comes only from the proposal row — no "today" fallback in customer documents.
  const dateDisplay = formatDateDisplay(row.proposal_date);
  const sourceTemplateSections = Array.isArray(templateSections)
    ? templateSections.filter((section) => !text(section.template_key) || text(section.template_key) === templateKey)
    : [];
  const sectionsSource = resolveDocumentSections(row, sourceTemplateSections);
  const byKey = new Map(sectionsSource.map((section) => [text(section.section_key), section]));
  const sectionBody = (key) => applyProposalTemplatePlaceholders(templateBodyText(byKey.get(key)), row, items);
  const sectionTitle = (key) => text(byKey.get(key)?.section_title);

  const includeCatalog = false;
  const introText = sectionBody('intro');
  const remarks = sectionBody('notes') || String(row.notes || '').replace(/\r\n?/g, '\n').trim();
  const templateActivityIntro = filterCatalogContentFromBody(sectionBody('activity_intro'), false);
  const activityIntro = isSummerProposalGroup(activityTypeGroup)
    ? summerActivityProposalBody()
    : templateActivityIntro;

  const renderActivitySection = (heading, body) => {
    const bodyHtml = body ? sectionBodyHtml(body) : '';
    if (!bodyHtml) return '';
    return `<section class="pa-section">${heading ? `<h3 class="pa-section-heading">${escapeHtml(sectionHeadingText(heading))}</h3>` : ''}${bodyHtml}</section>`;
  };

  const sections = [];
  const childGroups = isCombinedProposalGroup(activityTypeGroup) ? includedProposalGroups(activityTypeGroup) : [];
  if (childGroups.length && !includeCatalog) {
    childGroups.forEach((groupKey) => {
      // Supabase template sections may use either naming convention for per-group intros.
      const candidateKeys = [`activity_intro_${groupKey}`, `${groupKey}_activity_intro`];
      const key = candidateKeys.find((candidate) => byKey.has(candidate)) || candidateKeys[0];
      const body = filterCatalogContentFromBody(sectionBody(key), includeCatalog);
      const heading = sectionTitle(key) || proposalGroupDisplayName(groupKey);
      const section = renderActivitySection(heading, body);
      if (section) sections.push(section);
    });
    if (!sections.length) {
      const activitySection = renderActivitySection(
        sectionTitle('activity_intro'),
        activityIntro
      );
      if (activitySection) sections.push(activitySection);
    }
  } else {
    const activitySection = renderActivitySection(
      sectionTitle('activity_intro'),
      activityIntro
    );
    if (activitySection) sections.push(activitySection);
  }

  const renderSectionFromSupabase = (key, options = {}) => {
    const body = sectionBody(key);
    if (!body) return '';
    return sectionHtml(sectionTitle(key) || '', body, '', options);
  };

  // Payment section: general terms text comes from Supabase, while the price
  // breakdown is always built dynamically from proposal_agreement_items.
  const paymentTermsBody = sectionBody('payment_terms');
  const costTableHtml = proposalCostTableHtml(items);
  const costsIntro = costsIntroBody(row, items);
  const costTableBlock = (costsIntro || costTableHtml)
    ? `<div class="pa-cost-table-block">${costsIntro ? `<p class="pa-costs-intro-heading">${escapeHtml(costsIntro)}</p>` : ''}${costTableHtml}</div>`
    : '';
  const paymentTerms = (paymentTermsBody || costTableBlock)
    ? `<section class="pa-section pa-cost-section">${sectionTitle('payment_terms') ? `<h3 class="pa-section-heading">${escapeHtml(sectionHeadingText(sectionTitle('payment_terms')))}</h3>` : ''}${paymentTermsBody ? sectionBodyHtml(paymentTermsBody, { alwaysBullet: true }) : ''}${costTableBlock}</section>`
    : '';

  const signatureHtml = signatureSectionHtml(sectionBody('signature'), row, renderOptions);

  return buildProposalDocumentHtml({
    dateDisplay,
    documentTitle: proposalTitle(row, sourceTemplateSections),
    row,
    introText,
    sections,
    orgResponsibility: renderSectionFromSupabase('taasiyeda_responsibility', { alwaysBullet: true }),
    schoolResponsibility: renderSectionFromSupabase('school_responsibility', { alwaysBullet: true }),
    paymentTerms,
    changesCancellation: renderSectionFromSupabase('cancellation_terms', { alwaysBullet: true }),
    remarks: `${remarks ? sectionHtml(sectionTitle('notes') || '', remarks) : ''}${catalogAppendixNoticeHtml(row, items)}`,
    signatureHtml,
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
  const normalizedGroup = normalizeProposalGroup(activityTypeGroup);
  if (!normalizedGroup) return true;
  if (isCombinedProposalGroup(normalizedGroup)) {
    const children = includedProposalGroups(normalizedGroup);
    if (!children.length) return true;
    return children.some((groupKey) => itemBelongsToGroup(row, groupKey));
  }
  return itemBelongsToGroup(row, normalizedGroup);
}

function filterPricingByProposalType(pricingOptions, activityTypeGroup) {
  return (Array.isArray(pricingOptions) ? pricingOptions : []).filter((row) => pricingMatchesGroup(row, activityTypeGroup));
}

function filterPricingByActivityType(pricing, activityType) {
  if (!activityType) return pricing;
  return pricing.filter((row) => text(row.item_type) === activityType);
}

function buildPricingSelectOptionsHtml(pricingOptions, selectedPricingKey) {
  const visibleRows = pricingOptions.filter((row) =>
    !isTestHoursItem(row) &&
    text(row.proposal_display_mode) !== 'bundle_child' &&
    !/^תמיר/i.test(text(row.activity_name))
  );
  return ['<option value="">— בחר פעילות מהרשימה —</option>', ...visibleRows.map((row, optionIdx) => {
    const value = pricingOptionKey(row, optionIdx);
    const legacySelected = selectedPricingKey && [value, text(row.activity_no), text(row.activity_name), publicActivityName(row.activity_name)].includes(selectedPricingKey);
    const isBundleParent = row.proposal_display_mode === 'bundle_parent' || row.is_bundle_parent;
    const name = publicActivityLabelFromRow(row) || value;
    const price = numberValue(row.unit_price);
    const labelParts = [
      name,
      isBundleParent ? 'הגדרה כוללת' : text(row.item_type),
      price != null && price > 0 ? `${formatCurrency(price)} ₪` : ''
    ].filter(Boolean);
    return `<option value="${escapeHtml(value)}"${legacySelected ? ' selected' : ''}${isBundleParent ? ' data-bundle-parent="1"' : ''}>${escapeHtml(labelParts.join(' — '))}</option>`;
  })].join('');
}

function filterItemsByProposalType(items, activityTypeGroup) {
  const normalizedGroup = normalizeProposalGroup(activityTypeGroup);
  const sourceItems = (Array.isArray(items) ? items : []).filter((item) => !isTestHoursItem(item));
  if (!normalizedGroup) return sourceItems;
  if (isCombinedProposalGroup(normalizedGroup)) {
    const children = includedProposalGroups(normalizedGroup);
    if (!children.length) return sourceItems;
    return sourceItems.filter((item) => children.some((groupKey) => itemBelongsToGroup(item, groupKey)));
  }
  return sourceItems.filter((item) => itemBelongsToGroup(item, normalizedGroup));
}

function templateIndicatorHtml(group) {
  return `<p class="ds-pa-template-indicator" data-pa-template-indicator hidden></p>`;
}

function clientLockedBannerHtml(auth, school, contactName, contactRole, phone, email, clientName = '') {
  if (!auth && !clientName) return '';
  const displayName = clientName || school || auth;
  const summaryParts = [
    displayName,
    auth && auth !== displayName ? auth : '',
    contactName || ''
  ].filter(Boolean);
  const details = [
    school && school !== displayName ? ['בית ספר', school] : null,
    contactName ? ['איש קשר', contactName] : null,
    contactRole ? ['תפקיד', contactRole] : null,
    phone ? ['טלפון', phone] : null,
    email ? ['דוא״ל', email] : null
  ].filter(Boolean);
  return `<div class="ds-pa-client-locked">
    <div class="ds-pa-client-locked-body">
      ${summaryParts.length ? `<p class="ds-pa-client-locked-state">נבחר: ${escapeHtml(summaryParts.join(' — '))}</p>` : ''}
      ${details.map(([label, value]) => `<span class="ds-pa-client-locked-detail"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</span>`).join('')}
      ${!contactName ? '<span class="ds-pa-client-locked-detail ds-pa-client-locked-detail--warn">אפשר להשלים איש קשר ידנית.</span>' : ''}
    </div>
    <div class="ds-pa-client-locked-actions">
      <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-pa-unlock-client>שינוי</button>
      <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-pa-clear-client>נקה בחירה</button>
    </div>
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

function buildContactSourceFromRow(row = {}) {
  if (!row.authority_id) return null;
  const school = text(row.school_framework) !== text(row.client_authority) ? text(row.school_framework) : '';
  return {
    id:           text(row.contact_school_id) || null,
    authority_id: row.authority_id,
    school_id:    row.school_id || null,
    client_type:  text(row.client_type) || (row.school_id ? 'school' : 'authority'),
    client_name:  school || text(row.client_authority),
    authority:    text(row.client_authority),
    school,
    contact_name: text(row.contact_name),
    contact_role: text(row.contact_role),
    phone:        text(row.phone),
    email:        text(row.email),
    mobile:       ''
  };
}

function contactSourceInputsHtml(contact = {}) {
  const source = contact || {};
  return `
    <input type="hidden" name="contact_source_id" value="${escapeHtml(text(source.id))}">
    <input type="hidden" name="contact_source_authority_id" value="${escapeHtml(text(source.authority_id))}">
    <input type="hidden" name="contact_source_school_id" value="${escapeHtml(text(source.school_id))}">
    <input type="hidden" name="contact_source_school_required" value="${escapeHtml(text(source.school_required))}">
    <input type="hidden" name="contact_source_client_type" value="${escapeHtml(text(source.client_type))}">
    <input type="hidden" name="contact_source_client_name" value="${escapeHtml(text(source.client_name))}">
    <input type="hidden" name="contact_source_authority" value="${escapeHtml(text(source.authority))}">
    <input type="hidden" name="contact_source_school" value="${escapeHtml(text(source.school))}">
    <input type="hidden" name="contact_source_name" value="${escapeHtml(text(source.contact_name))}">
    <input type="hidden" name="contact_source_role" value="${escapeHtml(text(source.contact_role))}">
    <input type="hidden" name="contact_source_phone" value="${escapeHtml(text(source.phone || source.mobile || ''))}">
    <input type="hidden" name="contact_source_mobile" value="${escapeHtml(text(source.mobile))}">
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
  const normalizedSelected = normalizeProposalGroup(selected);
  const options = proposalGroupLookups.groups;
  if (!options.length) {
    return `<div class="ds-pa-type-cards" data-pa-type-cards></div><input type="hidden" name="activity_type_group" value="${escapeHtml(normalizedSelected)}" data-pa-type-hidden>`;
  }
  return `<div class="ds-pa-type-cards" data-pa-type-cards>
    ${options.map((opt) => `<button type="button" class="ds-pa-type-card${normalizedSelected === opt.group_key ? ' is-selected' : ''}" data-pa-type-btn="${escapeHtml(opt.group_key)}"><span class="ds-pa-type-card-label">${escapeHtml(opt.display_name)}</span>${text(opt.description) ? `<span class="ds-pa-type-card-desc">${escapeHtml(text(opt.description))}</span>` : ''}</button>`).join('')}
  </div><input type="hidden" name="activity_type_group" value="${escapeHtml(normalizedSelected)}" data-pa-type-hidden>`;
}

function proposalStepperHtml() {
  return '';
}

// ─── Catalog appendix attach (per proposal) ──────────────────────────────────

function includeCatalogValue(value) {
  return value === true || value === 'yes' || value === 'true' || value === 1;
}

// Catalog-attachment wording lives in Supabase template bodies; hide it in the document
// when the proposal was saved without include_catalog.
const CATALOG_ATTACH_LINE_RE = /דף\s+מידע[\s\S]*?(?:קטלוג|מגוון\s+הפעילויות)[\s\S]*?מצורף[\s\S]*?הצעה/u;

function isCatalogAttachLine(line = '') {
  const stripped = text(line).replace(/^[•\-·]\s*/, '');
  if (!stripped) return false;
  if (CATALOG_ATTACH_LINE_RE.test(stripped)) return true;
  return (/(?:קטלוג|דף\s+מידע|מגוון\s+הפעילויות|נספח)/u.test(stripped) && /מצורף/u.test(stripped)) || (/פירוט\s+מלא/u.test(stripped) && /מצורף/u.test(stripped));
}

function isProposalPricingDetailLine(line = '') {
  const stripped = text(line).replace(/^[•\-·]\s*/, '');
  if (!stripped) return false;
  return /(?:גפ״ן|גפן|מפגשים|שעות|לשעה|מחיר\s+לקבוצה|₪|\bILS\b)/u.test(stripped);
}

function stripCatalogSentences(line = '') {
  const raw = String(line || '').trim();
  if (!raw) return '';
  return raw
    .split(/(?<=[.!?׃:])\s+/u)
    .filter((part) => !isCatalogAttachLine(part))
    .join(' ')
    .trim();
}

function filterCatalogContentFromBody(body = '', includeCatalog = false) {
  if (!body) return body;
  const kept = normalizeMultilineText(body)
    .split('\n')
    .map((line) => includeCatalog ? line : stripCatalogSentences(line))
    .filter((line) => !isCatalogAttachLine(line) && !isProposalPricingDetailLine(line));
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function setCatalogAttachState(wrap, attached) {
  if (!wrap) return;
  const input = wrap.querySelector('[name="include_catalog"]');
  const statusEl = wrap.querySelector('[data-pa-catalog-status]');
  const toggleBtn = wrap.querySelector('[data-pa-catalog-toggle]');
  if (input) input.value = attached ? 'yes' : 'no';
  wrap.classList.toggle('is-attached', attached);
  if (toggleBtn) {
    toggleBtn.textContent = attached ? 'הקטלוג צורף להצעה' : 'הוספת הקטלוג להצעה';
    toggleBtn.classList.toggle('ds-btn--ghost', attached);
    toggleBtn.classList.toggle('ds-btn--primary', !attached);
    toggleBtn.setAttribute('aria-pressed', String(attached));
  }
  if (statusEl) {
    statusEl.textContent = attached
      ? '✓ הקטלוג צורף להצעה'
      : 'דף המידע / קטלוג הפעילויות יצורף למסמך בתצוגה מקדימה וב-PDF';
    statusEl.classList.toggle('is-attached', attached);
  }
}

function catalogAttachHtml(row = {}) {
  const attached = includeCatalogValue(row.include_catalog);
  return `<div class="ds-pa-catalog-attach${attached ? ' is-attached' : ''}" data-pa-catalog-attach>
    <input type="hidden" name="include_catalog" value="${attached ? 'yes' : 'no'}">
    <div class="ds-pa-catalog-attach-text">
      <strong>נספח קטלוג</strong>
      <span class="ds-pa-catalog-status${attached ? ' is-attached' : ''}" data-pa-catalog-status>${attached ? '✓ הקטלוג צורף להצעה' : 'דף המידע / קטלוג הפעילויות יצורף למסמך בתצוגה מקדימה וב-PDF'}</span>
    </div>
    <button type="button" class="ds-btn ds-btn--sm${attached ? ' ds-btn--ghost' : ' ds-btn--primary'}" data-pa-catalog-toggle aria-pressed="${attached ? 'true' : 'false'}">${attached ? 'הקטלוג צורף להצעה' : 'הוספת הקטלוג להצעה'}</button>
  </div>`;
}

function formHtml(mode, row = {}, activityNameOptions = [], contactOptions = [], items = [], pricingOptions = [], state = null) {
  const title = mode === 'edit' ? 'עריכת הצעת מחיר' : 'יצירת הצעת מחיר';
  const normalizedActivityGroup = normalizeProposalGroup(row.activity_type_group);
  const filteredPricing = filterPricingByProposalType(pricingOptions, normalizedActivityGroup);
  const currentStatus = STATUS_OPTIONS.includes(normalizeProposalStatus(row.status)) ? normalizeProposalStatus(row.status) : 'draft';
  const initAuth = text(row.client_authority);
  const initSchool = text(row.school_framework);
  const initContact = text(row.contact_name);
  const initRole = text(row.contact_role);
  const initPhone = text(row.phone);
  const initEmail = text(row.email);
  const initContactSource = findContactForProposalRow(contactOptions, row) || buildContactSourceFromRow(row);
  const isLocked = !!initAuth;
  const initSchoolId = text(initContactSource?.school_id) || text(row.school_id);
  const contactPanelVisible = isLocked && Boolean(initSchoolId);
  const initAuthorityId = text(initContactSource?.authority_id) || null;
  const initPickerHtml = contactPanelVisible ? contactPickerHtml(
    contactOptions,
    initAuth,
    initSchool,
    initContact,
    initAuthorityId,
    initSchoolId || null
  ) : '';
  const initClientName = text(initContactSource?.client_name) || initSchool || initAuth;
  const proposalDate = mode === 'add' ? (text(row.proposal_date) || localDateInputValue()) : text(row.proposal_date);
  const hasCustomSections = Array.isArray(row.custom_document_sections) && row.custom_document_sections.length > 0;
  const canApproveDirectly = canApproveProposalsAgreements(state);
  const primaryActionLabel = canApproveDirectly ? 'אישור והפקת הצעה' : 'שליחה לאישור';
  const primaryActionStatus = canApproveDirectly ? 'approved' : 'sent';

  const initialPreviewRow = normalizeProposalAgreementRow({
    ...row,
    document_type: text(row.document_type) || 'הצעת מחיר',
    activity_type_group: normalizedActivityGroup,
    proposal_date: proposalDate
  });
  const initialTemplateKey = proposalGroupTemplateKey(normalizedActivityGroup);
  const initialTemplateSections = resolveDocumentSections(row, [])
    .filter((section) => !text(section.template_key) || text(section.template_key) === initialTemplateKey);
  const initialPreviewHtml = proposalPreviewBodyHtml(initialPreviewRow, items, initialTemplateSections);

  return `<form class="ds-pa-form ds-pa-form--compact pa-editor" data-pa-form data-pa-mode="${escapeHtml(mode)}" data-pa-id="${escapeHtml(row.id || '')}" data-pa-original-type="${escapeHtml(normalizedActivityGroup)}" dir="rtl">
    <div class="ds-pa-form-header">
      <h3 class="ds-pa-form-title">${escapeHtml(title)}</h3>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-pa-cancel-form>ביטול</button>
    </div>

    <div class="pa-editor-workspace">
      <aside class="pa-sidebar" aria-label="עריכת פרטי הצעת מחיר">
        <div class="pa-sidebar-heading">
          <span class="pa-sidebar-kicker">עורך הצעה</span>
          <strong>${escapeHtml(title)}</strong>
        </div>
    <div class="ds-pa-form-meta-panel">
      <h4 class="pa-sidebar-section-title">פרטי נמען</h4>
      <div data-pa-step-panel="client">
        <div class="ds-pa-client-search-block" data-pa-client-search-row${isLocked ? ' hidden' : ''}>
          ${clientSearchHtml(contactOptions, row)}
        </div>
        <div data-pa-client-card${isLocked ? '' : ' hidden'}>${isLocked ? clientLockedBannerHtml(initAuth, initSchool, initContact, initRole, initPhone, initEmail, initClientName) : ''}</div>
        <div class="ds-pa-client-hidden-values" data-pa-client-fields hidden>
          ${hiddenField('client_authority', row.client_authority)}
          ${hiddenField('school_framework', row.school_framework)}
        </div>
      </div>
      <div data-pa-step-panel="contact"${contactPanelVisible ? '' : ' hidden'}>
        <h4 class="pa-sidebar-section-title">איש קשר</h4>
        <div class="ds-pa-form-grid">
          <div data-pa-contact-picker-host>${initPickerHtml}</div>
          <div data-pa-add-contact-row hidden>
            <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-pa-add-contact-toggle>לא מצאת? הוסף איש קשר ידנית</button>
            <p class="ds-pa-add-contact-note">איש הקשר יתווסף לרשות ולבית הספר שנבחרו.</p>
          </div>
          <div class="ds-pa-form-grid ds-pa-contact-manual-fields" data-pa-contact-manual-fields hidden>
            <div data-pa-contact-ro-ctx hidden>
              <label class="ds-pa-form-field"><span>רשות</span><input type="text" class="ds-input ds-input--sm" data-pa-contact-ro-authority readonly tabindex="-1"></label>
              <label class="ds-pa-form-field"><span>בית ספר</span><input type="text" class="ds-input ds-input--sm" data-pa-contact-ro-school readonly tabindex="-1"></label>
            </div>
            ${textField('contact_name', FIELD_LABELS.contact_name, row.contact_name, false)}
            ${textField('contact_role', FIELD_LABELS.contact_role, row.contact_role, false)}
            ${textField('phone', FIELD_LABELS.phone, row.phone, false)}
            ${textField('email', FIELD_LABELS.email, row.email, false)}
          </div>
        </div>
      </div>
    </div>

    <div class="ds-pa-form-type-panel" data-pa-step-panel="proposal">
      <h4 class="pa-sidebar-section-title">סוג ותאריך הצעה</h4>
      <div class="ds-pa-type-meta-grid">
        <div class="ds-pa-form-field">
          <span>${escapeHtml(FIELD_LABELS.activity_type_group)} *</span>
          ${proposalTypeCardsHtml(normalizedActivityGroup)}
        </div>
        <div class="ds-pa-type-meta-aux">
          ${mode === 'edit' ? `<label class="ds-pa-form-field"><span>${escapeHtml(FIELD_LABELS.proposal_date)}</span><input class="ds-input ds-input--sm" type="date" name="proposal_date" value="${escapeHtml(proposalDate)}"></label>` : `<input type="hidden" name="proposal_date" value="${escapeHtml(proposalDate)}">`}
          <input type="hidden" name="document_type" value="${escapeHtml(text(row.document_type) || 'הצעת מחיר')}">
        </div>
      </div>
      <div class="ds-pa-type-row">${templateIndicatorHtml(normalizedActivityGroup)}</div>
      <p class="ds-pa-template-mode ${hasCustomSections ? 'ds-pa-template-mode--custom' : ''}" data-pa-template-mode${hasCustomSections ? '' : ' hidden'}>${hasCustomSections ? 'נוסח מותאם אישית' : ''}</p>
    </div>

    <div class="ds-pa-form-activities-panel" data-pa-step-panel="activity">
      <h4 class="pa-sidebar-section-title">פעילויות ומחירים</h4>
      <div data-pa-items-host>${itemsEditorHtml(items, filteredPricing, normalizedActivityGroup)}</div>
    </div>

    <div class="ds-pa-form-bottom-panel" data-pa-step-panel="summary">
      <h4 class="pa-sidebar-section-title">סיכום והפקה</h4>
      <details class="ds-pa-notes-details"${text(row.notes) ? ' open' : ''}>
        <summary class="ds-pa-notes-summary">הערות</summary>
        <label class="ds-pa-form-field ds-pa-form-field--wide"><span>${escapeHtml(FIELD_LABELS.notes)}</span><textarea class="ds-input ds-input--sm ds-pa-notes-input" name="notes" rows="3">${escapeHtml(text(row.notes))}</textarea></label>
      </details>
      ${proposalSummaryHtml(row.total_amount)}
      <div class="ds-pa-validation-notice" data-pa-validation-notice hidden></div>
      <p class="ds-pa-form-error" data-pa-form-error role="alert"></p>
      <div class="ds-pa-form-actions ds-pa-form-actions--workflow">
        <div class="ds-pa-form-actions-main">
          <button type="button" class="ds-btn ds-btn--sm" data-pa-preview-form>תצוגה מקדימה</button>
          <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-pa-save-pending data-pa-target-status="${primaryActionStatus}">${escapeHtml(primaryActionLabel)}</button>
          <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-pa-cancel-form>ביטול</button>
        </div>
      </div>
    </div>
      </aside>
      <section class="pa-preview" aria-label="תצוגת מסמך A4">
        <div class="pa-preview-toolbar no-print">
          <span>תצוגה מקדימה חיה</span>
          <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-pa-preview-form>פתח לתצוגה / PDF</button>
        </div>
        <div class="pa-preview-canvas" data-pa-live-preview>
          ${initialPreviewHtml}
        </div>
      </section>
    </div>

    <input type="hidden" name="status" data-pa-status-input value="${escapeHtml(currentStatus)}">
    <span data-pa-contact-source>${contactSourceInputsHtml(initContactSource || {})}</span>
    <div class="ds-pa-duplicate-dialog" data-pa-duplicate-dialog hidden></div>
  </form>`;
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

function drawerActionButtons(row, state) {
  const status = text(row?.status) || 'draft';
  const isSent = normalizeProposalStatus(status) === 'sent';
  const isAdminRole = canApproveProposalsAgreements(state);
  const canManage = canManageProposalsAgreements(state);
  const buttons = [];

  buttons.push(`<button type="button" class="ds-btn ds-btn--sm" data-pa-preview="${escapeHtml(row.id)}">תצוגה מקדימה</button>`);

  if (!isSent && canManage && (['draft', 'returned_for_changes'].includes(status) || (isAdminRole && status !== 'approved'))) {
    buttons.push(`<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-pa-edit-row="${escapeHtml(row.id)}">עריכה</button>`);
  }
  if (!isSent && canManage && ['draft', 'returned_for_changes'].includes(status)) {
    buttons.push(`<button type="button" class="ds-btn ds-btn--sm" data-pa-edit-document="${escapeHtml(row.id)}">עריכת מסמך</button>`);
  }
  if (!isSent && canManage && ['draft', 'returned_for_changes'].includes(status) && !isAdminRole) {
    buttons.push(`<button type="button" class="ds-btn ds-btn--sm" data-pa-status-action="sent" data-pa-action-id="${escapeHtml(row.id)}">שליחה לאישור</button>`);
  }
  if (isAdminRole) {
    if (!isSent && !['cancelled', 'approved'].includes(status)) {
      buttons.push(`<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-pa-status-action="cancelled" data-pa-action-id="${escapeHtml(row.id)}">ביטול</button>`);
    }
    buttons.push(`<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-pa-delete-row="${escapeHtml(row.id)}">מחיקה</button>`);
  }
  if (isAdminRole && (status === 'approved' || isSent)) {
    buttons.push(`<button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-pa-print="${escapeHtml(row.id)}">הדפסה / שמירה כ-PDF</button>`);
    buttons.push(`<button type="button" class="ds-btn ds-btn--sm" data-pa-clone-row="${escapeHtml(row.id)}">שכפול להצעה חדשה</button>`);
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
      <span class="ds-pa-detail-value"><strong>${formatCurrency(row.total_amount)} ₪</strong></span>
    </div>` : '';
  const hasCustomSections = Array.isArray(row.custom_document_sections) && row.custom_document_sections.length > 0;
  const customBadge = hasCustomSections
    ? `<span class="ds-pa-badge" title="המסמך הזה כולל עריכה מותאמת אישית" style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:0.75rem;background:#6366f1;color:#fff;margin-right:4px">מסמך מותאם</span>`
    : '';

  const clientDisplayName = text(row.client_name) || text(row.school_framework) || text(row.client_authority) || '—';
  const schoolLine = text(row.school_framework) && text(row.school_framework) !== clientDisplayName
    ? `<p class="ds-muted" style="font-size:0.78rem;margin:2px 0 0">${escapeHtml(row.school_framework)}</p>`
    : '';
  const authLine = text(row.client_authority) && text(row.client_authority) !== clientDisplayName && text(row.client_authority) !== text(row.school_framework)
    ? `<p class="ds-muted" style="font-size:0.78rem;margin:1px 0 0">רשות: ${escapeHtml(row.client_authority)}</p>`
    : '';
  const proposalIdHtml = '';
  return `<aside class="ds-pa-drawer" data-pa-drawer data-pa-drawer-id="${escapeHtml(row.id)}" aria-live="polite" dir="rtl">
    <div class="ds-pa-drawer-panel">
      <header class="ds-pa-drawer-head">
        <div>
          ${proposalIdHtml}
          <h3 style="margin:0">${escapeHtml(clientDisplayName)}</h3>
          ${schoolLine}${authLine}
        </div>
        <button type="button" class="ds-btn ds-btn--sm" data-pa-close-drawer aria-label="סגירת פרטי רשומה">✕</button>
      </header>
      <div class="ds-pa-drawer-status" style="margin:6px 0 8px">${statusBadgeHtml(row.status)}${customBadge}</div>
      <div class="ds-pa-detail-grid">${detailRowsHtml(row)}</div>
      ${totalHtml}
      ${approvalNoteHtml}
      ${contactDetailRowsHtml(row)}
      <div data-pa-drawer-items style="margin:8px 0"><span class="ds-muted" style="font-size:0.8rem">טוען שורות הצעה...</span></div>
      <div class="ds-pa-drawer-actions">${drawerActionButtons(row, state)}</div>
      <p class="ds-pa-form-error" data-pa-drawer-error role="alert" style="color:#dc2626;font-size:0.8rem;margin-top:4px"></p>
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
  payload.include_catalog = false;
  const items = filterItemsByProposalType(extractItemsFromForm(form), payload.activity_type_group);
  const subtotal = items.reduce((s, i) => s + Math.max(Number(i.total_price) || ((Number(i.quantity) || 0) * (Number(i.unit_price) || 0)), 0), 0);
  const discountType = text(form.querySelector('[data-pa-discount-type]')?.value) || 'amount';
  const discountValue = Number(form.querySelector('[data-pa-discount-value]')?.value) || 0;
  const discountAmount = discountType === 'percent' ? subtotal * (Math.min(discountValue, 100) / 100) : Math.min(discountValue, subtotal);
  if (discountAmount > 0) {
    items.push({
      activity_no: '', pricing_activity_no: '', pricing_option_key: '', item_name: 'הנחה', item_type: '',
      gefen_number: '', meetings_count: null, hours_count: null, quantity: 1, unit_duration: '',
      unit_price: -Number(discountAmount.toFixed(2)), hourly_price: null, total_price: -Number(discountAmount.toFixed(2)),
      description: text(form.querySelector('[data-pa-discount-note]')?.value), proposal_group: normalizeProposalGroup(payload.activity_type_group),
      sort_order: items.length, proposal_display_mode: 'single', source_pricing_key: '', selected_bundle_items: []
    });
  }
  const itemNames = Array.from(new Set(items.map((i) => text(i.item_name)).filter((name) => name && name !== 'הנחה')));
  if (itemNames.length) payload.activity_names = itemNames;
  payload.total_amount = items.reduce((s, i) => s + (Number(i.total_price) || ((Number(i.quantity) || 0) * (Number(i.unit_price) || 0))), 0) || null;
  payload._items = items;
  payload._school_required = 'yes';
  payload.contact_school_id = text(formData.get('contact_source_id')) || null;
  payload.authority_id = text(formData.get('contact_source_authority_id')) || null;
  payload.school_id = text(formData.get('contact_source_school_id')) || null;
  payload.client_type = text(formData.get('contact_source_client_type')) || (payload.school_id ? 'school' : 'authority');
  payload._contact_original = {
    id:           text(formData.get('contact_source_id')),
    client_type:  payload.client_type,
    authority_id: text(formData.get('contact_source_authority_id')) || null,
    school_id:    text(formData.get('contact_source_school_id')) || null,
    client_name:  text(formData.get('contact_source_client_name')),
    authority:    text(formData.get('contact_source_authority')),
    school:       text(formData.get('contact_source_school')),
    contact_name: text(formData.get('contact_source_name')),
    contact_role: text(formData.get('contact_source_role')),
    phone:        text(formData.get('contact_source_phone')),
    mobile:       text(formData.get('contact_source_mobile')),
    email:        text(formData.get('contact_source_email'))
  };
  return payload;
}

function validatePayload(payload, statusOverride) {
  const targetStatus = statusOverride || payload.status || 'draft';
  const requiresCompleteProposal = targetStatus === 'sent' || targetStatus === 'pending_approval' || targetStatus === 'approved';
  const requiredFields = requiresCompleteProposal
    ? REQUIRED_FIELDS_PENDING
    : REQUIRED_FIELDS_DRAFT;
  const missing = requiredFields.filter((key) => !text(payload[key]));
  const errors = missing.map((key) => FIELD_LABELS[key] || key);

  if (!text(payload.authority_id)) {
    errors.push('יש לבחור רשות מתוך רשימת הרשויות.');
  }
  if (!text(payload.school_id)) {
    errors.push('יש לבחור בית ספר מתוך רשימת בתי הספר של הרשות.');
  }
  const hasManualContact = Boolean(text(payload.contact_name) || text(payload.phone) || text(payload.email));
  if (hasManualContact && !text(payload.contact_school_id)) {
    if (!text(payload.authority_id) || !text(payload.school_id)) {
      errors.push('ניתן להוסיף איש קשר רק לאחר בחירת רשות ובית ספר.');
    }
  }

  if (requiresCompleteProposal) {
    const grp = normalizeProposalGroup(payload.activity_type_group);
    const items = filterItemsByProposalType(Array.isArray(payload._items) ? payload._items : [], grp);
    if (!items.length) errors.push('לפחות שורת הצעה אחת רלוונטית לסוג ההצעה');
    const invalidItem = items.find((i) => !text(i.item_name));
    if (invalidItem) errors.push('שם פעילות בכל שורה');
    if (!payload.total_amount) errors.push('סה״כ כללי');
    if (isCombinedProposalGroup(grp)) {
      const missingGroup = items.find((i) => !text(i.proposal_group));
      if (missingGroup) errors.push('שיוך קבוצה בכל שורה');
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

// ─── Catalog appendix PDF planning ─────────────────────────────────────────

function buildProposalCatalogAppendixPlan(items) {
  return { entries: proposalCourseCatalogPdfEntries(items), skipped: [] };
}

function buildProposalCatalogEntryDetails(items) {
  return proposalCourseCatalogPdfEntries(items).filter((entry) => !entry.missing);
}

export function buildProposalCatalogEntries(items) {
  return proposalCourseCatalogPdfEntries(items).filter((entry) => !entry.missing).map((entry) => entry.url);
}

const CATALOG_APPENDICES_DIR = 'catalog/appendices/';
const CATALOG_PDF_FILES = Object.freeze({
  workshops: `${CATALOG_APPENDICES_DIR}workshop.pdf`,
  tours: `${CATALOG_APPENDICES_DIR}tour.pdf`
});

function cleanCourseCatalogIdentifier(value = '') {
  return text(value).replace(/^cat-/i, '').replace(/\.pdf$/i, '').replace(/^course-/i, '').trim().replace(/\/$/, '');
}

function courseCatalogPdfId(item = {}) {
  const gefen = cleanCourseCatalogIdentifier(item.gefen_number || item.catalog_gefen || item.gefen);
  return /^\d{3,}$/.test(gefen) ? gefen : '';
}

function proposalStaticCatalogPdfKinds(row = {}, items = []) {
  const kinds = new Set();
  const groupText = groupKindText(row.activity_type_group);
  const sourceItems = Array.isArray(items) ? items : [];
  if (isCombinedProposalGroup(row.activity_type_group)) {
    const groups = includedProposalGroups(row.activity_type_group);
    groups.forEach((groupKey) => {
      const kindText = groupKindText(groupKey);
      if (isWorkshopKindText(kindText) || isSummerKindText(kindText)) kinds.add('workshops');
      if (isCourseKindText(kindText)) kinds.add('courses');
      if (/סיור|tour/.test(kindText)) kinds.add('tours');
    });
  }
  if (isSummerKindText(groupText) || isWorkshopKindText(groupText)) kinds.add('workshops');
  if (isCourseKindText(groupText)) kinds.add('courses');
  if (/סיור|tour/.test(groupText)) kinds.add('tours');
  sourceItems.forEach((item) => {
    const kindText = itemKindText(item);
    const catalogKind = itemCatalogKind(item);
    if (catalogKind === 'workshop' || catalogKind === 'summer' || isWorkshopKindText(kindText) || isSummerKindText(kindText)) kinds.add('workshops');
    if (catalogKind === 'course' || isCourseKindText(kindText)) kinds.add('courses');
    if (/סיור|tour/.test(kindText)) kinds.add('tours');
  });
  return Array.from(kinds);
}

function proposalCourseCatalogPdfEntries(items = []) {
  const entries = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (isTestHoursItem(item) || text(item.proposal_display_mode) === 'bundle_child') return;
    const kindText = itemKindText(item);
    if (itemCatalogKind(item) !== 'course' && !isCourseKindText(kindText)) return;
    const label = publicActivityName(item.item_name || item.pricing_activity_name || item.activity_name || item.description) || 'קורס';
    const pdfId = courseCatalogPdfId(item);
    if (!pdfId) {
      const missingKey = `missing||${label}`;
      if (!seen.has(missingKey)) {
        seen.add(missingKey);
        entries.push({ kind: 'course', label, missing: true, reason: 'missing_course_pdf_id' });
      }
      return;
    }
    const path = `${CATALOG_APPENDICES_DIR}${pdfId}.pdf`;
    if (seen.has(path)) return;
    seen.add(path);
    entries.push({ kind: 'course', label, path, url: `${PUBLIC_BASE}${path}` });
  });
  return entries;
}

export function buildProposalCatalogPdfEntries(row = {}, items = []) {
  const staticEntries = proposalStaticCatalogPdfKinds(row, items)
    .map((kind) => ({ kind, label: kind === 'tours' ? 'סיור' : 'סדנאות', path: CATALOG_PDF_FILES[kind], url: `${PUBLIC_BASE}${CATALOG_PDF_FILES[kind]}` }))
    .filter((entry) => entry.path);
  return [...staticEntries, ...proposalCourseCatalogPdfEntries(items)];
}

async function catalogPdfExists(entry = {}) {
  if (!entry?.url || entry.missing) return false;
  if (typeof fetch !== 'function') return true;
  try {
    const response = await fetch(entry.url, { method: 'HEAD', cache: 'no-store' });
    if (response.ok) return true;
    if (response.status === 405 || response.status === 501) {
      const getResponse = await fetch(entry.url, { method: 'GET', cache: 'no-store' });
      return getResponse.ok;
    }
    return false;
  } catch (_) {
    return false;
  }
}

async function resolvePrintableCatalogPdfEntries(entries = []) {
  const printable = [];
  for (const entry of (Array.isArray(entries) ? entries : [])) {
    if (entry?.missing) {
      const courseName = text(entry.label) || 'קורס';
      const shouldContinue = window.confirm(`לא נמצא מספר גפ״ן לנספח הקורס: ${courseName}. ניתן להמשיך ללא נספח או לבטל ולעדכן את פרטי הקורס.`);
      if (!shouldContinue) return null;
      continue;
    }
    if (!entry?.url) continue;
    if (entry.kind !== 'course') {
      printable.push(entry);
      continue;
    }
    if (await catalogPdfExists(entry)) {
      printable.push(entry);
      continue;
    }
    const courseName = text(entry.label) || 'קורס';
    const shouldContinue = window.confirm(`לא נמצא קובץ נספח לקורס: ${courseName}. ניתן להמשיך ללא נספח או לבטל ולהעלות קובץ.`);
    if (!shouldContinue) return null;
  }
  return printable;
}

function catalogPdfDownloadName(entry = {}, index = 0) {
  const pathName = text(entry.path || entry.url).split(/[?#]/)[0].split('/').filter(Boolean).pop();
  const fallbackName = `catalog-appendix-${index + 1}.pdf`;
  return /\.pdf$/i.test(pathName) ? pathName : fallbackName;
}

function triggerCatalogPdfDownload(entry = {}, index = 0) {
  if (!entry?.url || typeof document === 'undefined') return;
  const link = document.createElement('a');
  link.href = entry.url;
  link.download = catalogPdfDownloadName(entry, index);
  link.target = '_blank';
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function prepareCatalogPdfDownloads(entries = []) {
  const printableEntries = await resolvePrintableCatalogPdfEntries(entries);
  if (printableEntries === null) return false;
  printableEntries.forEach((entry, index) => triggerCatalogPdfDownload(entry, index));
  return true;
}

function ensureCatalogAppendixNotice(previewArea, row = {}, items = []) {
  const doc = previewArea?.querySelector?.('.proposal-document-body');
  if (!doc || doc.querySelector('[data-pa-catalog-appendix-notice]')) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = catalogAppendixNoticeHtml({ ...row, include_catalog: true }, items);
  const notice = tmp.firstElementChild;
  if (!notice) return;
  const signature = doc.querySelector('.proposal-signature');
  if (signature) doc.insertBefore(notice, signature);
  else doc.appendChild(notice);
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
    setProposalGroupLookups(data, Array.isArray(data?.rows) ? data.rows : [], Array.isArray(data?.proposalActivityPricing) ? data.proposalActivityPricing : []);
    setProposalPricingLookup(Array.isArray(data?.proposalActivityPricing) ? data.proposalActivityPricing : []);
    const rows = displayRows(data, {});
    const proposalGroupFilterOptions = proposalGroupOptions(data, Array.isArray(data?.rows) ? data.rows : [], Array.isArray(data?.proposalActivityPricing) ? data.proposalActivityPricing : []);
    const canManage = canManageProposalsAgreements(state);
    const rawRows = Array.isArray(data?.rows) ? data.rows.map(normalizeProposalAgreementRow) : [];
    return dsScreenStack(`
      ${dsPageHeader('הצעות מחיר')}
      <section class="ds-pa-screen" data-pa-screen dir="rtl">
        <style>
          .ds-pa-screen-tab{border-radius:10px 10px 0 0;transition:background .15s,color .15s,border-color .15s}.ds-pa-screen-tab:hover{background:rgba(14,165,233,.08)}
          .ds-pa-form{max-width:1080px;margin-inline:auto}.ds-pa-form .ds-pa-form-grid{max-width:100%}.ds-pa-item-card{border:1px solid #dbe7f3;border-radius:14px;background:#fff;padding:14px;margin:10px 0;box-shadow:0 1px 3px rgba(15,23,42,.04)}
          .ds-pa-item-quick-row{display:grid;grid-template-columns:minmax(260px,1fr) 110px 130px 130px auto;gap:10px;align-items:end}.ds-pa-item-field span{display:block;font-size:.74rem;color:#64748b;margin-bottom:4px;font-weight:600}.ds-pa-line-total output{min-height:34px;display:flex;align-items:center;justify-content:center;border:1px solid #dbe7f3;border-radius:10px;background:#f8fbff;font-weight:700;color:#0f766e}.ds-pa-items-total-row{margin-top:10px;padding:10px 12px;border-radius:12px;background:#eef8ff;font-size:.9rem}.ds-pa-items-total-row strong{color:#0369a1}
          .ds-pa-bundle-prompt{margin-top:12px}.ds-pa-bundle-panel{border:1px solid #b7e0f5;background:#f8fdff;border-radius:14px;padding:12px}.ds-pa-bundle-head{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:6px}.ds-pa-bundle-head strong{font-size:.9rem;color:#0f172a}.ds-pa-bundle-head span,.ds-pa-bundle-help,.ds-pa-bundle-empty{font-size:.78rem;color:#64748b}.ds-pa-bundle-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:10px}.ds-pa-bundle-child-card{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;border:1px solid #dbe7f3;border-radius:12px;background:#fff;padding:9px 10px;cursor:pointer;min-height:42px}.ds-pa-bundle-child-card:hover{border-color:#38bdf8;background:#f0f9ff}.ds-pa-bundle-child-card:has(input:checked){border-color:#0ea5e9;background:#e0f2fe;box-shadow:0 0 0 1px #0ea5e9 inset}.ds-pa-bundle-child-name{font-size:.82rem;color:#0f172a;line-height:1.25}.ds-pa-bundle-child-price{font-size:.8rem;font-weight:700;color:#0f766e;white-space:nowrap}.ds-pa-bundle-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}.ds-pa-bundle-actions{display:flex;gap:6px}.ds-pa-bundle-selection-summary{font-size:.78rem;color:#0369a1;font-weight:700}.ds-pa-summary-bundle-list{margin:4px 0 0;padding-right:16px;font-size:.72rem}.ds-pa-items-summary-table{width:100%;border-collapse:collapse;font-size:.78rem}.ds-pa-items-summary-table th,.ds-pa-items-summary-table td{border-bottom:1px solid #e5eef6;padding:6px;text-align:right}.ds-pa-items-summary-table th{color:#64748b;font-weight:700;background:#f8fbff}
          @media (max-width:900px){.ds-pa-item-quick-row{grid-template-columns:1fr 1fr}.ds-pa-item-field--select,.ds-pa-line-total{grid-column:1/-1}.ds-pa-bundle-grid{grid-template-columns:1fr}}
        </style>
        <div class="ds-pa-screen-tabs" data-pa-screen-tabs style="display:flex;gap:4px;border-bottom:2px solid var(--ds-border,#e5e7eb);margin-bottom:12px">
          <button type="button" class="ds-pa-screen-tab is-active" data-pa-tab="records" style="padding:6px 16px;border:none;background:none;cursor:pointer;font-weight:600;border-bottom:2px solid transparent;margin-bottom:-2px;color:inherit;font-size:0.9rem">📋 רשומות</button>
          ${canManage ? '<button type="button" class="ds-pa-screen-tab" data-pa-tab="new" style="padding:6px 16px;border:none;background:none;cursor:pointer;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--ds-text-muted,#6b7280);font-size:0.9rem">+ הצעה חדשה</button>' : ''}
        </div>
        <div data-pa-tab-panel="records">
          <div class="ds-pa-toolbar">
            <label class="ds-pa-search"><span>חיפוש</span><input class="ds-input ds-input--sm" data-pa-search placeholder="חיפוש מקומי" autocomplete="off"></label>
            ${filterSelectHtml('activity_type_group', 'סוג הצעה', proposalGroupFilterOptions)}
            ${statusFilterHtml()}
          </div>
          <div class="ds-pa-local-status" aria-live="polite">מציג <strong data-pa-results-count>${rows.length}</strong> רשומות</div>
          ${dsCard({ title: 'רשומות', padded: false, body: `<div class="ds-pa-records-shell" data-pa-table-region>${tableHtml(rows, state)}</div>` })}
          ${drawerHtml(null, [], state)}
        </div>
        <div data-pa-tab-panel="new" hidden>
          <div data-pa-form-host></div>
        </div>
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
    setProposalGroupLookups(data, data.rows, proposalActivityPricing);
    setProposalPricingLookup(proposalActivityPricing);
    const proposalTemplateSections = Array.isArray(data?.proposalTemplateSections) ? data.proposalTemplateSections : [];
    const contactOptions = Array.isArray(data?.contactOptions) ? data.contactOptions : [];
    // eslint-disable-next-line no-console
    console.info('[proposal-authorities-debug]', {
      totalContactOptions: contactOptions.length,
      authoritiesCount: contactOptions.filter((c) => c._catalog_source === 'authorities').length,
      firstAuthorities: contactOptions
        .filter((c) => c._catalog_source === 'authorities')
        .slice(0, 10)
    });
    const rowWithCentralContact = (row) => {
      if (!row) return row;
      const contact = findContactForProposalRow(contactOptions, row);
      if (!contact) return row;
      return {
        ...row,
        client_name:      text(contact.client_name) || row.client_name || text(contact.school) || text(contact.authority),
        client_type:      text(contact.client_type) || row.client_type,
        client_authority: text(contact.authority) || row.client_authority,
        school_framework: text(contact.school) || row.school_framework,
        contact_name:     text(contact.contact_name) || row.contact_name,
        contact_role:     text(contact.contact_role) || row.contact_role,
        phone:            text(contact.phone || contact.mobile || '') || row.phone,
        email:            text(contact.email) || row.email
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
      const schoolDone = Boolean(text(form.querySelector('input[name="contact_source_school_id"]')?.value));
      ['client', 'proposal', 'activity', 'summary'].forEach((key) => setPanelOpen(form, key, true));
      setPanelOpen(form, 'contact', schoolDone);
    };
    const setupCatalogAttach = (container) => {
      const form = container?.closest?.('[data-pa-form]') || container?.querySelector?.('[data-pa-form]');
      const wrap = form?.querySelector('[data-pa-catalog-attach]');
      const toggleBtn = wrap?.querySelector('[data-pa-catalog-toggle]');
      if (!wrap || !toggleBtn || toggleBtn.dataset.paCatalogBound === 'yes') return;
      toggleBtn.dataset.paCatalogBound = 'yes';
      toggleBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const attached = text(wrap.querySelector('[name="include_catalog"]')?.value) !== 'yes';
        setCatalogAttachState(wrap, attached);
      }, { signal });
    };
    const setupFormStepper = (container) => {
      const form = container?.closest?.('[data-pa-form]') || container?.querySelector?.('[data-pa-form]');
      if (!form || form.dataset.paStepperBound === 'yes') return;
      form.dataset.paStepperBound = 'yes';
      form.addEventListener('input', () => { updateProposalStepper(form); calcGrandTotal(form); }, { signal });
      form.addEventListener('change', () => setTimeout(() => { updateProposalStepper(form); calcGrandTotal(form); }, 0), { signal });
      updateProposalStepper(form);
      setupCatalogAttach(form);
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
          modeEl.textContent = 'סוג ההצעה השתנה';
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
      const searchRow = form?.querySelector('[data-pa-client-search-row]');
      const results = form?.querySelector('[data-pa-client-results]');
      if (cardEl) { cardEl.innerHTML = clientLockedBannerHtml(auth, school, cName, cRole, phone, email, clientName); cardEl.hidden = false; }
      if (fieldsEl) fieldsEl.hidden = true;
      if (searchRow) searchRow.hidden = true;
      if (results) { results.hidden = true; results.innerHTML = ''; }
      const addContactRow = form?.querySelector('[data-pa-add-contact-row]');
      const roAuth = form?.querySelector('[data-pa-contact-ro-authority]');
      const roSchoolEl = form?.querySelector('[data-pa-contact-ro-school]');
      const roCtx = form?.querySelector('[data-pa-contact-ro-ctx]');
      if (roAuth) roAuth.value = auth;
      if (roSchoolEl) roSchoolEl.value = school;
      if (roCtx) roCtx.hidden = false;
      form?.querySelectorAll('[data-pa-contact-manual-fields]').forEach((el) => { el.hidden = true; });
      if (addContactRow) addContactRow.hidden = Boolean(cName);
    };

    const unlockClientFields = (form) => {
      const cardEl = form?.querySelector('[data-pa-client-card]');
      const fieldsEl = form?.querySelector('[data-pa-client-fields]');
      const searchRow = form?.querySelector('[data-pa-client-search-row]');
      if (cardEl) cardEl.hidden = true;
      if (fieldsEl) fieldsEl.hidden = true;
      if (searchRow) searchRow.hidden = false;
      form?.querySelectorAll('[data-pa-contact-manual-fields]').forEach((el) => { el.hidden = true; });
      const addContactRow = form?.querySelector('[data-pa-add-contact-row]');
      if (addContactRow) addContactRow.hidden = true;
      const roCtx = form?.querySelector('[data-pa-contact-ro-ctx]');
      if (roCtx) roCtx.hidden = true;
    };

    const applyContactSelectionAfterClient = (form, ctx = {}) => {
      if (!form) return;
      const {
        authority = '',
        school = '',
        authorityId = '',
        schoolId = '',
        clientType = 'school',
        clientName = ''
      } = ctx;
      const authInput = form.querySelector('input[name="client_authority"]');
      const schoolInput = form.querySelector('input[name="school_framework"]');
      if (authInput) authInput.value = authority;
      if (schoolInput) schoolInput.value = school;

      const contacts = filterContactsForClient(contactOptions, { authorityId, schoolId });
      const pickerHost = form.querySelector('[data-pa-contact-picker-host]');
      const addContactRow = form.querySelector('[data-pa-add-contact-row]');
      const baseSource = {
        authority_id: authorityId || null,
        school_id: schoolId || null,
        school_required: 'yes',
        client_type: clientType,
        client_name: clientName || school || authority,
        authority,
        school,
        contact_name: '',
        contact_role: '',
        phone: '',
        mobile: '',
        email: ''
      };

      setPanelOpen(form, 'contact', true);

      if (contacts.length === 1) {
        const contact = contacts[0];
        fillContactFields(form, contact);
        setContactSource(form, { ...baseSource, ...contact, id: contact.id });
        if (pickerHost) pickerHost.innerHTML = '';
        lockClientFields(
          form,
          authority,
          school,
          text(contact.contact_name),
          text(contact.contact_role),
          text(contact.phone || contact.mobile || ''),
          text(contact.email || ''),
          clientName || school || authority
        );
      } else {
        fillContactFields(form, {});
        setContactSource(form, baseSource);
        if (pickerHost) {
          pickerHost.innerHTML = contactPickerHtml(
            contactOptions,
            authority,
            school,
            '',
            authorityId,
            schoolId || null
          );
          if (pickerHost.children.length) setupContactPicker(pickerHost, form);
        }
        lockClientFields(form, authority, school, '', '', '', '', clientName || school || authority);
        if (addContactRow) addContactRow.hidden = contacts.length > 0;
      }

      const searchField = form.querySelector('[data-pa-client-search-field]');
      const schoolSearchPanel = form.querySelector('[data-pa-school-search-panel]');
      if (searchField) searchField.hidden = true;
      if (schoolSearchPanel) schoolSearchPanel.hidden = true;
      const input = form.querySelector('[data-pa-client-search-input]');
      const results = form.querySelector('[data-pa-client-results]');
      if (input) input.value = '';
      if (results) { results.hidden = true; results.innerHTML = ''; }
      setTimeout(() => {
        calcGrandTotal(form);
        updateProposalStepper(form);
      }, 0);
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
          lockClientFields(form, text(contact.authority), text(contact.school), text(contact.contact_name), text(contact.contact_role), text(contact.phone || contact.mobile || ''), text(contact.email || ''), text(contact.client_name) || text(contact.school) || text(contact.authority));
          if (form) setTimeout(() => calcGrandTotal(form), 0);
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

    const clientSearchMatches = (query, step, form) => {
      const q = normalizeSearch(query);
      if (!q || q.length < 2) return [];
      const selectedAuthorityId = form?.dataset?.paAuthorityId || '';
      const seen = new Set();
      return contactOptions.filter((c) => {
        if (step === 'authority') {
          if (c._catalog_source !== 'authorities') return false;
          const haystack = [
            c.authority_name, c.authority, c.client_name, c.long_name,
            c.authority_code, c.district, c.authority_type
          ].map(normalizeSearch).join(' ');
          if (!haystack.includes(q)) return false;
          const key = [text(c.authority_id), catalogAuthorityName(c)].join('||');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }
        if (step === 'school') {
          if (c._catalog_source !== 'schools') return false;
          if (selectedAuthorityId && !catalogIdMatch(c.authority_id, selectedAuthorityId)) return false;
          const haystack = [
            c.school_name, c.school, c.client_name, c.semel_mosad, c.city, c.district
          ].map(normalizeSearch).join(' ');
          if (!haystack.includes(q)) return false;
          const key = [text(c.school_id), catalogSchoolName(c)].join('||');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }
        return false;
      }).slice(0, 20);
    };

    const clientResultLabel = (contact, step) => {
      if (step === 'authority') {
        return catalogAuthorityName(contact);
      }
      const schoolName = catalogSchoolName(contact);
      const semel = text(contact.semel_mosad);
      return semel ? `${schoolName} (סמל: ${semel})` : schoolName;
    };

    const resetClientSearchPanels = (form) => {
      if (!form) return;
      form.dataset.paSearchStep = 'authority';
      delete form.dataset.paAuthorityId;
      delete form.dataset.paAuthorityName;
      const searchField = form.querySelector('[data-pa-client-search-field]');
      const schoolSearchPanel = form.querySelector('[data-pa-school-search-panel]');
      const results = form.querySelector('[data-pa-client-results]');
      const schoolResults = form.querySelector('[data-pa-school-results]');
      if (searchField) searchField.hidden = false;
      if (schoolSearchPanel) schoolSearchPanel.hidden = true;
      if (results) { results.hidden = true; results.innerHTML = ''; }
      if (schoolResults) { schoolResults.hidden = true; schoolResults.innerHTML = ''; }
      const searchInput = form.querySelector('[data-pa-client-search-input]');
      const schoolSearchInput = form.querySelector('[data-pa-school-search-input]');
      if (searchInput) searchInput.value = '';
      if (schoolSearchInput) schoolSearchInput.value = '';
      setPanelOpen(form, 'contact', false);
      const pickerHost = form.querySelector('[data-pa-contact-picker-host]');
      if (pickerHost) pickerHost.innerHTML = '';
      const addContactRow = form.querySelector('[data-pa-add-contact-row]');
      if (addContactRow) addContactRow.hidden = true;
      form.querySelectorAll('[data-pa-contact-manual-fields]').forEach((el) => { el.hidden = true; });
    };

    const showSchoolSearchPanel = (form, authorityName) => {
      const searchField = form.querySelector('[data-pa-client-search-field]');
      const results = form.querySelector('[data-pa-client-results]');
      const schoolSearchPanel = form.querySelector('[data-pa-school-search-panel]');
      if (searchField) searchField.hidden = true;
      if (results) { results.hidden = true; results.innerHTML = ''; }
      if (schoolSearchPanel) {
        schoolSearchPanel.hidden = false;
        const nameEl = schoolSearchPanel.querySelector('[data-pa-step-authority-name-school]');
        if (nameEl) nameEl.textContent = authorityName;
      }
      form.dataset.paSearchStep = 'school';
      const schoolSearchInput = form.querySelector('[data-pa-school-search-input]');
      if (schoolSearchInput) {
        schoolSearchInput.value = '';
        schoolSearchInput.focus();
      }
      const schoolResults = form.querySelector('[data-pa-school-results]');
      if (schoolResults) { schoolResults.hidden = true; schoolResults.innerHTML = ''; }
      setPanelOpen(form, 'contact', false);
    };

    const applyClientSearchMode = (form) => {
      if (!form) return;
      if (!form.dataset.paSearchStep) form.dataset.paSearchStep = 'authority';
      const clientFieldsEl = form?.querySelector('[data-pa-client-fields]');
      const clientCardEl = form?.querySelector('[data-pa-client-card]');
      const isLocked = clientCardEl && !clientCardEl.hidden && clientCardEl.children.length > 0;
      if (clientFieldsEl) clientFieldsEl.hidden = true;
      if (!isLocked) {
        form?.querySelectorAll('[data-pa-contact-manual-fields]').forEach((el) => { el.hidden = true; });
        const addContactRowEl = form?.querySelector('[data-pa-add-contact-row]');
        if (addContactRowEl) addContactRowEl.hidden = true;
      }
    };

    const applyAuthoritySelection = (form, contact) => {
      if (!form || !contact) return;
      const authorityName = catalogAuthorityName(contact);
      const authorityId = text(contact.authority_id) || '';
      form.dataset.paAuthorityId = authorityId;
      form.dataset.paAuthorityName = authorityName;
      form.dataset.paNewClient = 'no';

      const authInput = form.querySelector('input[name="client_authority"]');
      const schoolInput = form.querySelector('input[name="school_framework"]');
      if (authInput) authInput.value = authorityName;
      if (schoolInput) schoolInput.value = '';

      setContactSource(form, {
        authority_id: authorityId || null,
        school_id: null,
        school_required: 'yes',
        client_type: 'school',
        client_name: authorityName,
        authority: authorityName,
        school: '',
        contact_name: '',
        contact_role: '',
        phone: '',
        mobile: '',
        email: ''
      });

      showSchoolSearchPanel(form, authorityName);
      updateProposalStepper(form);
    };

    const selectExistingClient = (form, contact, step) => {
      if (!form || !contact) return;

      if (step === 'authority') {
        applyAuthoritySelection(form, contact);
        return;
      }

      if (step === 'school') {
        form.dataset.paNewClient = 'no';
        const storedAuthorityId = form.dataset.paAuthorityId || '';
        const storedAuthorityName = form.dataset.paAuthorityName || '';
        const authorityId = text(contact.authority_id) || storedAuthorityId;
        const authority = storedAuthorityName || catalogAuthorityName(contact);
        const school = catalogSchoolName(contact);
        const schoolId = text(contact.school_id);
        applyContactSelectionAfterClient(form, {
          authority,
          school,
          authorityId,
          schoolId,
          clientType: 'school',
          clientName: school
        });
      }
    };

    const renderClientResults = (form, step, input, resultsHost) => {
      if (!input || !resultsHost) return;
      const matches = clientSearchMatches(input.value, step, form);
      if (!text(input.value) || text(input.value).length < 2) {
        resultsHost.innerHTML = '<p class="ds-pa-client-results-empty">הקלידו לפחות שני תווים לחיפוש.</p>';
        resultsHost.hidden = true;
        return;
      }
      if (!matches.length) {
        const stepLabel = step === 'school' ? 'בית ספר / מסגרת' : 'רשות';
        resultsHost.innerHTML = `<p class="ds-pa-client-results-empty">לא נמצאה ${stepLabel} ברשימה. נסו שם אחר, שם מלא או קוד רשות.</p>`;
        resultsHost.hidden = false;
        return;
      }
      const isAuthorityStep = step === 'authority';
      resultsHost.innerHTML = matches.map((contact, idx) => {
        let metaParts;
        if (isAuthorityStep) {
          const authorityType = text(contact.authority_type || '');
          const authorityCode = text(contact.authority_code || '');
          const district = text(contact.district || '');
          metaParts = [authorityType, district, authorityCode ? `קוד ${authorityCode}` : ''].filter(Boolean);
        } else {
          const semel = text(contact.semel_mosad || '');
          metaParts = [semel ? `סמל ${semel}` : ''].filter(Boolean);
        }
        return `<button type="button" class="ds-pa-client-result" data-pa-client-result="${idx}">
          <strong>${escapeHtml(clientResultLabel(contact, step))}</strong>
          ${metaParts.length ? `<span class="ds-pa-client-result-meta">${escapeHtml(metaParts.join(' · '))}</span>` : ''}
        </button>`;
      }).join('');
      resultsHost.hidden = false;
      resultsHost.querySelectorAll('[data-pa-client-result]').forEach((btn) => {
        btn.addEventListener('click', () => selectExistingClient(form, matches[Number(btn.dataset.paClientResult)], step), { signal });
      });
    };

    const setupClientSelector = (container) => {
      const form = container?.querySelector?.('[data-pa-form]') || container?.closest?.('[data-pa-form]') || (container?.matches?.('[data-pa-form]') ? container : null);
      if (!form || form.dataset.paClientSearchBound === 'yes') return;
      form.dataset.paClientSearchBound = 'yes';
      applyClientSearchMode(form);
      // Init contact area for forms already locked on mount (edit mode)
      const initCard = form.querySelector('[data-pa-client-card]');
      const initIsLocked = initCard && !initCard.hidden && initCard.children.length > 0;
      if (initIsLocked) {
        const initCName = text(form.querySelector('input[name="contact_name"]')?.value || '');
        const addContactRowInit = form.querySelector('[data-pa-add-contact-row]');
        if (addContactRowInit) addContactRowInit.hidden = Boolean(initCName);
        const roAuthInit = form.querySelector('[data-pa-contact-ro-authority]');
        const roSchoolInit = form.querySelector('[data-pa-contact-ro-school]');
        const roCtxInit = form.querySelector('[data-pa-contact-ro-ctx]');
        if (roAuthInit) roAuthInit.value = text(form.querySelector('input[name="client_authority"]')?.value || '');
        if (roSchoolInit) roSchoolInit.value = text(form.querySelector('input[name="school_framework"]')?.value || '');
        if (roCtxInit) roCtxInit.hidden = false;
      }
      form.querySelector('[data-pa-client-search-input]')?.addEventListener('input', () => {
        renderClientResults(form, 'authority', form.querySelector('[data-pa-client-search-input]'), form.querySelector('[data-pa-client-results]'));
      }, { signal });
      form.querySelector('[data-pa-school-search-input]')?.addEventListener('input', () => {
        renderClientResults(form, 'school', form.querySelector('[data-pa-school-search-input]'), form.querySelector('[data-pa-school-results]'));
      }, { signal });
    };


    const updateLivePreview = (container) => {
      const form = container?.closest?.('[data-pa-form]') || (container?.matches?.('[data-pa-form]') ? container : null);
      const previewHost = form?.querySelector?.('[data-pa-live-preview]');
      if (!form || !previewHost) return;
      const payload = payloadFromForm(form);
      const row = normalizeProposalAgreementRow({
        ...payload,
        id: text(form.dataset.paId),
        proposal_date: payload.proposal_date || localDateInputValue()
      });
      const templateKey = proposalGroupTemplateKey(row.activity_type_group);
      const templateSections = proposalTemplateSections.filter((section) => text(section.template_key) === templateKey);
      previewHost.innerHTML = proposalPreviewBodyHtml(row, payload._items || [], templateSections);
    };

    // ── Items calc ────────────────────────────────────────────────────────────
    const calcItemRow = (rowEl) => {
      const qty = parseFloat(rowEl.querySelector('[data-pa-item-qty]')?.value || '0') || 0;
      const price = parseFloat(rowEl.querySelector('[data-pa-item-price]')?.value || '0') || 0;
      const totalInput = rowEl.querySelector('[data-pa-item-total]');
      const totalDisplay = rowEl.querySelector('[data-pa-item-total-display]');
      const total = qty && price ? qty * price : 0;
      if (totalInput) totalInput.value = total ? total.toFixed(2) : '';
      if (totalDisplay) totalDisplay.textContent = total ? `${formatCurrency(total)} ₪` : '';
      return total;
    };

    const calcGrandTotal = (container) => {
      let subtotal = 0;
      container.querySelectorAll('[data-pa-item-row]').forEach((rowEl) => { subtotal += calcItemRow(rowEl); });
      const discountType = text(container.querySelector('[data-pa-discount-type]')?.value) || 'amount';
      const discountValue = parseFloat(container.querySelector('[data-pa-discount-value]')?.value || '0') || 0;
      const discount = discountType === 'percent' ? subtotal * (Math.min(discountValue, 100) / 100) : Math.min(discountValue, subtotal);
      const sum = Math.max(subtotal - discount, 0);
      const el = container.querySelector('[data-pa-grand-total]');
      if (el) el.textContent = sum ? `${formatCurrency(sum)} ₪` : '0 ₪';
      const subtotalEl = container.querySelector('[data-pa-summary-subtotal]');
      if (subtotalEl) subtotalEl.textContent = subtotal ? `${formatCurrency(subtotal)} ₪` : '0 ₪';
      const discountEl = container.querySelector('[data-pa-summary-discount]');
      if (discountEl) discountEl.textContent = discount ? `-${formatCurrency(discount)} ₪` : '0 ₪';
      const summaryEl = container.querySelector('[data-pa-summary-total]');
      if (summaryEl) summaryEl.textContent = sum ? `${formatCurrency(sum)} ₪` : '0 ₪';
      // Update summary card fields
      const form = container.closest?.('[data-pa-form]') || (container.matches?.('[data-pa-form]') ? container : null);
      if (form) {
        const clientEl = form.querySelector('[data-pa-summary-client]');
        if (clientEl) clientEl.textContent = text(form.querySelector('[name="client_authority"]')?.value) || '—';
        const typeEl = form.querySelector('[data-pa-summary-type]');
        if (typeEl) typeEl.textContent = proposalGroupDisplayName(form.querySelector('[name="activity_type_group"]')?.value) || '—';
        const countEl = form.querySelector('[data-pa-summary-count]');
        if (countEl) countEl.textContent = String(form.querySelectorAll('[data-pa-item-row]').length) || '—';
        updateLivePreview(form);
      }
      return sum;
    };

    const setupItemCalc = (container) => { calcGrandTotal(container); };
    const pricingByName = proposalActivityPricing.reduce((acc, row) => {
      const rawName = text(row.activity_name);
      const publicName = publicActivityName(row.activity_name);
      if (rawName && !acc.has(rawName)) acc.set(rawName, row);
      if (publicName && !acc.has(publicName)) acc.set(publicName, row);
      return acc;
    }, new Map());
    const pricingByNo = proposalActivityPricing.reduce((acc, row) => {
      const key = text(row.activity_no);
      if (!key || acc.has(key)) return acc;
      acc.set(key, row);
      return acc;
    }, new Map());
    const pricingByOptionKey = new Map(proposalActivityPricing.map((row, idx) => [pricingOptionKey(row, idx), row]));

    const resolvePricingRow = ({ activityNo, activityName, optionKey }) => {
      const selectedOptionKey = text(optionKey);
      const no = text(activityNo);
      const name = text(activityName);
      const publicName = publicActivityName(activityName);
      if (selectedOptionKey && pricingByOptionKey.has(selectedOptionKey)) return pricingByOptionKey.get(selectedOptionKey);
      if (no && pricingByNo.has(no)) return pricingByNo.get(no);
      if (name && pricingByName.has(name)) return pricingByName.get(name);
      if (publicName && pricingByName.has(publicName)) return pricingByName.get(publicName);
      return null;
    };


    const setRowValue = (itemRow, name, value) => {
      const input = itemRow?.querySelector?.(`[name="${name}"]`);
      if (input) input.value = value == null ? '' : String(value);
    };

    const selectedBundleChildren = (itemRow) => Array.from(itemRow?.querySelectorAll?.('[data-pa-bundle-child-check]:checked') || [])
      .map((cb) => {
        try {
          const parsed = JSON.parse(cb.dataset.childJson || 'null');
          if (parsed && (parsed.activity_name || parsed.pricing_key)) {
            return {
              ...parsed,
              activity_name: publicActivityName(parsed.activity_name),
              unit_price: numberValue(parsed.unit_price)
            };
          }
        } catch { /* ignore */ }
        return null;
      })
      .filter(Boolean);

    const updateBundlePreviewSummary = (itemRow) => {
      const summary = itemRow?.querySelector?.('[data-pa-bundle-selection-summary]');
      if (!summary) return;
      const selected = selectedBundleChildren(itemRow);
      const sum = selected.reduce((acc, child) => acc + (numberValue(child.unit_price) || 0), 0);
      summary.textContent = selected.length
        ? `${selected.length} פעילויות נבחרו${sum ? ` | ${formatCurrency(sum)} ₪` : ''}`
        : 'לא נבחרו פעילויות לפירוט';
    };

    const applyBundleParentToRow = (itemRow, pickedData = {}, options = {}) => {
      if (!itemRow) return;
      const selected = options.keepGeneral ? [] : selectedBundleChildren(itemRow);
      const childrenSum = selected.reduce((acc, child) => acc + (numberValue(child.unit_price) || 0), 0);
      const parentPrice = numberValue(pickedData.unit_price);
      const unitPrice = parentPrice != null && parentPrice > 0 ? parentPrice : childrenSum;
      const description = selected.length ? selected.map((child) => `• ${publicActivityName(child.activity_name)}`).join('\n') : '';
      const parentName = publicActivityName(pickedData.activity_name);
      setRowValue(itemRow, 'item_name', parentName);
      setRowValue(itemRow, 'item_type', pickedData.item_type || '');
      setRowValue(itemRow, 'unit_price', unitPrice || '');
      setRowValue(itemRow, 'proposal_group', pickedData.proposal_group || text(itemRow.dataset.paRowGroup) || '');
      setRowValue(itemRow, 'description', description);
      setRowValue(itemRow, 'item_display_mode', 'bundle_parent');
      setRowValue(itemRow, 'item_source_pricing_key', pickedData.pricing_key || '');
      setRowValue(itemRow, 'bundle_pricing_key', pickedData.pricing_key || '');
      setRowValue(itemRow, 'item_selected_bundle_items', JSON.stringify(selected));
      const infoStrip = itemRow.querySelector('[data-pa-item-info-strip]');
      if (infoStrip && !itemRow.hasAttribute('data-pa-summer-row')) {
        infoStrip.innerHTML = buildInfoStripInnerHtml({ item_name: parentName, item_type: pickedData.item_type, unit_price: unitPrice, proposal_group: pickedData.proposal_group }, pickedData.proposal_group || '');
        infoStrip.hidden = !parentName;
      }
      const form = itemRow.closest('[data-pa-form]');
      calcItemRow(itemRow);
      if (form) { calcGrandTotal(form); updateProposalStepper(form); }
    };

    // ── Form open/close ───────────────────────────────────────────────────────
    const setFormTabLabel = (mode) => {
      const tabBtn = root.querySelector('[data-pa-tab="new"]');
      if (tabBtn) tabBtn.textContent = mode === 'edit' ? 'עריכת הצעה' : '+ הצעה חדשה';
    };

    const openForm = async (mode, row = {}, preloadedItems = []) => {
      if (!formHost) return;
      // Switch to the "new" tab panel so formHost is visible (add and edit share the
      // same full-width work area).
      setFormTabLabel(mode);
      switchTab('new');
      let items = preloadedItems;
      if (mode === 'edit' && text(row.id) && !preloadedItems.length) {
        try {
          if (typeof api.readProposalAgreementItems === 'function') {
            items = await api.readProposalAgreementItems(text(row.id));
          }
        } catch { items = []; }
      }
      formHost.hidden = false;
      formHost.innerHTML = formHtml(mode, row, activityNameOptions, contactOptions, items, proposalActivityPricing, state);
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

    const switchTab = (tabName) => {
      root.querySelectorAll('[data-pa-tab]').forEach((btn) => {
        const active = btn.dataset.paTab === tabName;
        btn.classList.toggle('is-active', active);
        btn.style.fontWeight = active ? '700' : '500';
        btn.style.color = active ? '' : 'var(--ds-text-muted,#6b7280)';
        btn.style.borderBottomColor = active ? 'var(--ds-primary,#6366f1)' : 'transparent';
      });
      root.querySelectorAll('[data-pa-tab-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.paTabPanel !== tabName;
      });
    };

    const closeForm = () => {
      if (!formHost) return;
      formHost.hidden = true;
      formHost.innerHTML = '';
      setFormTabLabel('add');
      switchTab('records');
    };

    // ── Preview ───────────────────────────────────────────────────────────────
    const openPreview = async (row, items, options = {}) => {
      if (options.form) options.form.dataset.paPreviewSeen = 'yes';
      const savedRow = data.rows.find((r) => text(r.id) === text(row.id));
      const mergedRow = savedRow ? { ...savedRow, ...row } : row;
      const freshRow = rowWithCentralContact(mergedRow);
      const templateKey = proposalGroupTemplateKey(freshRow.activity_type_group);
      const templateSections = proposalTemplateSections.filter((s) => text(s.template_key) === templateKey);
      document.getElementById('pa-preview-overlay')?.remove();
      const overlay = document.createElement('div');
      overlay.id = 'pa-preview-overlay';
      overlay.className = 'proposal-preview-overlay';
      overlay.setAttribute('dir', 'rtl');
      const clientLabel = [freshRow.client_authority, freshRow.school_framework].filter(Boolean).map(escapeHtml).join(' — ');
      const saveBtnHtml = '';
      const signingMode = options.signatureMode === true;
      const canApproveFromPreview = !signingMode && canApproveProposalsAgreements(state) && normalizeProposalStatus(freshRow.status) !== 'approved' && text(freshRow.id);
      const submitBtnHtml = options.onSubmit ? `<button type="button" class="ds-btn ds-btn--primary ds-btn--sm no-print" id="pa-preview-submit">${escapeHtml(options.submitLabel || 'שליחה לאישור')}</button>` : '';
      const approvePreviewBtnHtml = canApproveFromPreview ? '<button type="button" class="ds-btn ds-btn--primary ds-btn--sm no-print" id="pa-preview-approve-sign">אישור וחתימה</button>' : '';
      const hasCustomSections = Array.isArray(freshRow.custom_document_sections) && freshRow.custom_document_sections.length > 0;
      const missingTemplateNotice = (!templateSections.length && !hasCustomSections)
        ? '<p class="ds-pa-template-missing-notice no-print" role="alert" style="margin:6px 0 0;color:#b45309;font-size:0.85rem">לא נמצאה תבנית פעילה לסוג הצעה זה</p>'
        : '';
      // Admin-only notice (never printed) when the proposal has no saved item rows.
      const missingItemsNotice = (!Array.isArray(items) || !items.length)
        ? '<p class="ds-pa-no-items-notice no-print" role="alert" style="margin:6px 0 0;color:#b45309;font-size:0.85rem">לא נשמרו שורות פעילות להצעה זו</p>'
        : '';
      overlay.innerHTML = `
        <div class="proposal-preview-toolbar no-print">
          <button type="button" class="ds-btn ds-btn--sm no-print" id="pa-preview-close">← חזרה לעריכה</button>
          ${saveBtnHtml}
          ${submitBtnHtml}
          ${approvePreviewBtnHtml}
          ${signingMode ? '<button type="button" class="ds-btn ds-btn--primary ds-btn--sm no-print" id="pa-signature-confirm">אישור וחתימה</button><button type="button" class="ds-btn ds-btn--sm ds-btn--ghost no-print" id="pa-signature-cancel">ביטול</button>' : ''}
          <button type="button" class="ds-btn ds-btn--sm no-print" id="pa-print-btn">הדפסה / שמירה כ-PDF</button>
          <span class="ds-pa-preview-client no-print">${clientLabel}</span>
          ${missingTemplateNotice}
          ${missingItemsNotice}
        </div>
        <div class="proposal-preview-area">
          ${proposalPreviewBodyHtml(freshRow, items, templateSections, signingMode ? { showSignatureImage: true } : {})}
        </div>`;
      document.body.appendChild(overlay);
      document.body.classList.add('is-print-preview');
      const readSignatureMeta = () => defaultSignatureMeta();
      if (options.form) options.form.dataset.paPreviewSeen = 'yes';
      const printButton = overlay.querySelector('#pa-print-btn');
      printButton?.addEventListener('click', () => {
        window.print();
      });
      const closeOverlay = () => { overlay.remove(); document.body.classList.remove('is-print-preview'); };
      overlay.querySelector('#pa-preview-close')?.addEventListener('click', closeOverlay);
      overlay.querySelector('#pa-signature-cancel')?.addEventListener('click', closeOverlay);
      overlay.querySelector('#pa-signature-confirm')?.addEventListener('click', () => options.onSignatureConfirm?.(readSignatureMeta(), closeOverlay));
      overlay.querySelector('#pa-preview-approve-sign')?.addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        btn.disabled = true;
        try {
          const signatureMeta = readSignatureMeta();
          const result = await api.updateProposalAgreementStatus(text(freshRow.id), 'approved', '', signatureMeta);
          replaceLocalRow(data, result?.row || { ...freshRow, status: 'approved', approval_note: '', signature_meta: signatureMeta });
          refreshTable();
          const approvedRow = data.rows.find((item) => text(item.id) === text(freshRow.id)) || { ...freshRow, status: 'approved', signature_meta: signatureMeta };
          overlay.querySelector('.proposal-preview-area').innerHTML = proposalPreviewBodyHtml(approvedRow, items, templateSections, { showSignatureImage: true });
          btn.remove();
          showToast('ההצעה אושרה ונחתמה', 'success');
        } catch (err) {
          btn.disabled = false;
          showToast('שגיאה באישור וחתימה', 'error');
          window.alert?.(`שגיאה באישור וחתימה: ${err?.message || err}`);
        }
      });
      if (options.onSubmit) overlay.querySelector('#pa-preview-submit')?.addEventListener('click', () => { closeOverlay(); options.onSubmit(); });
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
      // Always set status explicitly — 'draft' is the safe default
      const targetStatus = statusOverride || 'draft';
      payload.status = targetStatus;
      const isPending = targetStatus === 'sent' || targetStatus === 'pending_approval';

      const validationErrors = validatePayload(payload, targetStatus);
      // No preview check here — the pending button handler manages the preview flow
      if (validationErrors.length) {
        showValidationNotice(form, validationErrors, isPending);
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
        if (existingRow && normalizeProposalStatus(text(existingRow.status)) === 'sent') {
          if (errorEl) errorEl.textContent = 'הצעה שנשלחה נעולה ולא ניתן לערוך אותה.';
          form.dataset.saving = '';
          allBtns.forEach((b) => { b.disabled = false; });
          return;
        }
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
        const items = Array.isArray(payload._items) ? payload._items : filterItemsByProposalType(extractItemsFromForm(form), payload.activity_type_group);
        if (savedId && typeof api.saveProposalAgreementItems === 'function') {
          console.debug('[PA_SAVE_ITEMS]', { savedId, activity_type_group: payload.activity_type_group, items });
          await api.saveProposalAgreementItems(savedId, items);
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

    // ── Tab switching ──────────────────────────────────────────────────────────
    root.querySelector('[data-pa-screen-tabs]')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pa-tab]');
      if (!btn) return;
      const tabName = btn.dataset.paTab;
      if (tabName === 'new' && canManage) {
        openForm('add'); // openForm calls switchTab('new') internally
      } else if (tabName === 'records') {
        // Clear the new-proposal form and switch back to records
        if (formHost) { formHost.hidden = true; formHost.innerHTML = ''; }
        switchTab('records');
      }
    }, { signal });

    // ── Input handler (items calc) ────────────────────────────────────────────
    root.addEventListener('input', (event) => {
      const target = event.target;
      const itemRow = target.closest?.('[data-pa-item-row]');
      const isItemPrice = target.matches?.('[data-pa-item-price]');
      const isItemQty = target.matches?.('[data-pa-item-qty]') || target.dataset?.paItemQty != null ||
        target.closest?.('[data-pa-item-qty]') != null;

      if (isItemPrice || isItemQty || target.matches?.('[data-pa-discount-type], [data-pa-discount-value]') ||
          target.closest?.('[data-pa-item-price]') || target.dataset?.paItemPrice != null) {
        const form = target.closest('[data-pa-form]');
        if (itemRow) calcItemRow(itemRow);
        if (form) calcGrandTotal(form);
      }

      const updateRowHourlyPrice = () => {
        if (!itemRow) return;
        const priceEl = itemRow.querySelector('[data-pa-item-price]');
        const hoursEl = itemRow.querySelector('[name="hours_count"]');
        const hourlyEl = itemRow.querySelector('[name="hourly_price"]');
        if (!hourlyEl) return;
        const hourlyPrice = recalculateHourlyPriceValue(priceEl?.value, hoursEl?.value);
        hourlyEl.value = hourlyPrice == null ? '' : String(hourlyPrice);
      };

      if ((isItemPrice || target.name === 'hours_count') && itemRow) {
        updateRowHourlyPrice();
      }

      // Update info strip on price / meetings / hours changes (annual / combined rows only)
      if ((isItemPrice || target.name === 'meetings_count' || target.name === 'hours_count') && itemRow && !itemRow.hasAttribute('data-pa-summer-row')) {
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
    root.addEventListener('change', async (event) => {

      const rowStatusSelect = event.target.closest?.('[data-pa-row-status]');
      if (rowStatusSelect) {
        if (!canManage) return;
        const id = text(rowStatusSelect.dataset.paStatusId);
        const previousStatus = text(rowStatusSelect.dataset.paPreviousStatus) || 'draft';
        const newStatus = text(rowStatusSelect.value);
        if (!id || !newStatus || newStatus === previousStatus) return;
        if (normalizeProposalStatus(previousStatus) === 'sent') {
          rowStatusSelect.value = previousStatus;
          showToast('הצעה שנשלחה נעולה ולא ניתן לשנות את סטטוסה.', 'error');
          return;
        }
        if (newStatus === 'approved' && !canApproveProposalsAgreements(state)) {
          rowStatusSelect.value = previousStatus;
          showToast('אין הרשאה לאשר ולחתום הצעות מחיר', 'error');
          return;
        }
        if (newStatus === 'approved') {
          rowStatusSelect.value = previousStatus;
          const row = data.rows.find((r) => text(r.id) === id);
          if (!row) return;
          let items = [];
          try { if (typeof api.readProposalAgreementItems === 'function') items = await api.readProposalAgreementItems(id); } catch { items = []; }
          await openPreview(row, items, {
            signatureMode: true,
            onSignatureConfirm: async (signatureMeta, closeOverlay) => {
              rowStatusSelect.disabled = true;
              try {
                const result = await api.updateProposalAgreementStatus(id, 'approved', '', signatureMeta);
                replaceLocalRow(data, result?.row || { id, status: 'approved', approval_note: '', signature_meta: signatureMeta });
                refreshTable();
                closeOverlay?.();
                showToast('ההצעה אושרה ונחתמה', 'success');
              } catch (err) {
                rowStatusSelect.disabled = false;
                showToast('שגיאה בעדכון סטטוס ההצעה', 'error');
                window.alert?.(`שגיאה בעדכון סטטוס: ${err?.message || err}`);
              }
            }
          });
          return;
        }
        rowStatusSelect.disabled = true;
        try {
          const result = await api.updateProposalAgreementStatus(id, newStatus, '');
          replaceLocalRow(data, result?.row || { id, status: newStatus, approval_note: '' });
          refreshTable();
          showToast('סטטוס ההצעה עודכן בהצלחה', 'success');
        } catch (err) {
          rowStatusSelect.value = previousStatus;
          rowStatusSelect.disabled = false;
          showToast('שגיאה בעדכון סטטוס ההצעה', 'error');
          window.alert?.(`שגיאה בעדכון סטטוס: ${err?.message || err}`);
        }
        return;
      }

      // ── Activity type filter ──────────────────────────────────────────────
      const activityTypeFilter = event.target.closest?.('[data-pa-activity-type-filter]');
      if (activityTypeFilter) {
        const form = activityTypeFilter.closest('[data-pa-form]');
        if (!form) return;
        const selectedActivityType = text(activityTypeFilter.value);
        const contractType = text(form.querySelector('[name="activity_type_group"]')?.value);
        const basePricing = filterPricingByProposalType(proposalActivityPricing, contractType);
        const filteredPricing = filterPricingByActivityType(basePricing, selectedActivityType);
        form.querySelectorAll('[data-pa-pricing-select]').forEach((sel) => {
          const currentVal = text(sel.value);
          sel.innerHTML = buildPricingSelectOptionsHtml(filteredPricing, currentVal);
        });
        return;
      }


      // ── Bundle child checkbox selection ───────────────────────────────────
      const bundleChildCheck = event.target.closest?.('[data-pa-bundle-child-check]');
      if (bundleChildCheck) {
        const itemRow = bundleChildCheck.closest('[data-pa-item-row]');
        if (!itemRow) return;
        let pickedData = {};
        try { pickedData = JSON.parse(itemRow.dataset.paBundlePicked || '{}'); } catch { pickedData = {}; }
        updateBundlePreviewSummary(itemRow);
        applyBundleParentToRow(itemRow, pickedData, { keepGeneral: false });
        return;
      }

      // ── Pricing select ────────────────────────────────────────────────────
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
      if (!itemRow) return;
      const bundlePrompt = itemRow.querySelector('[data-pa-bundle-prompt]');
      if (!picked) { if (bundlePrompt) bundlePrompt.hidden = true; return; }
      const isBundle = picked.proposal_display_mode === 'bundle_parent' || picked.is_bundle_parent;
      if (isBundle && bundlePrompt) {
        const parentName = publicActivityName(picked.activity_name);
        const pickedData = {
          pricing_key: text(picked.pricing_key),
          activity_name: parentName,
          item_type: text(picked.item_type),
          unit_price: numberValue(picked.unit_price),
          proposal_group: text(picked.proposal_group)
        };
        itemRow.dataset.paBundlePicked = JSON.stringify(pickedData);
        setRowValue(itemRow, 'pricing_option_key', selectedKey);
        setRowValue(itemRow, 'activity_no', picked.activity_no || '');
        setRowValue(itemRow, 'item_name', parentName);
        setRowValue(itemRow, 'item_type', picked.item_type || '');
        setRowValue(itemRow, 'unit_price', numberValue(picked.unit_price) || '');
        setRowValue(itemRow, 'proposal_group', picked.proposal_group || text(itemRow.dataset.paRowGroup) || '');
        setRowValue(itemRow, 'item_display_mode', 'bundle_parent');
        setRowValue(itemRow, 'item_source_pricing_key', text(picked.pricing_key) || '');
        setRowValue(itemRow, 'bundle_pricing_key', text(picked.pricing_key) || '');
        setRowValue(itemRow, 'item_selected_bundle_items', '[]');
        const contractType = text(form?.querySelector('[name="activity_type_group"]')?.value);
        const allPricingForContract = filterPricingByProposalType(proposalActivityPricing, contractType);
        const children = allPricingForContract.filter((r) =>
          text(r.proposal_display_mode) === 'bundle_child' &&
          text(r.parent_pricing_key) &&
          text(r.parent_pricing_key) === text(picked.pricing_key)
        );
        const childCheckboxesHtml = children.length
          ? children.map((child, ci) => {
              const childName = publicActivityLabelFromRow(child);
              const unitPrice = numberValue(child.unit_price);
              const childData = {
                activity_no: text(child.activity_no),
                pricing_key: text(child.pricing_key),
                activity_name: childName,
                unit_price: unitPrice,
                proposal_bundle_label: parentName
              };
              return `<label class="ds-pa-bundle-child-card">
                <input type="checkbox" name="bundle_child_sel" value="${escapeHtml(childName)}" data-pa-bundle-child-check data-bundle-child-idx="${ci}" data-child-json="${escapeHtml(JSON.stringify(childData))}">
                <span class="ds-pa-bundle-child-name">${escapeHtml(childName)}</span>
                <span class="ds-pa-bundle-child-price">${unitPrice != null && unitPrice > 0 ? `${escapeHtml(formatCurrency(unitPrice))} ₪` : '—'}</span>
              </label>`;
            }).join('')
          : '<p class="ds-pa-bundle-empty">אין פריטי פירוט מוגדרים עבור הגדרה זו</p>';
        bundlePrompt.innerHTML = `
          <div class="ds-pa-bundle-panel">
            <div class="ds-pa-bundle-head">
              <strong>${escapeHtml(parentName)}</strong>
              <span>הגדרה כוללת מתוך הקטלוג</span>
            </div>
            ${children.length ? '<div class="ds-pa-bundle-help">בחרו את הפעילויות שייכללו בהצעה. המחיר והסה״כ יתעדכנו לפי הבחירה.</div>' : ''}
            <div class="ds-pa-bundle-grid" role="group" aria-label="בחירת פעילויות">${childCheckboxesHtml}</div>
            <div class="ds-pa-bundle-footer">
              <span class="ds-pa-bundle-selection-summary" data-pa-bundle-selection-summary>לא נבחרו פעילויות לפירוט</span>
              <div class="ds-pa-bundle-actions">
                <button type="button" class="ds-btn ds-btn--xs ds-btn--primary" data-pa-bundle-confirm>✓ אישור בחירה</button>
                <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-pa-bundle-keep>השאר כללי</button>
              </div>
            </div>
          </div>`;
        bundlePrompt.hidden = false;
        applyBundleParentToRow(itemRow, pickedData, { keepGeneral: true });
        return;
      }
      if (bundlePrompt) bundlePrompt.hidden = true;
      const setValue = (name, value) => {
        const input = itemRow.querySelector(`[name="${name}"]`);
        if (input) input.value = value == null ? '' : String(value);
      };
      setValue('pricing_option_key', selectedKey);
      setValue('activity_no', picked.activity_no || '');
      setValue('item_name', publicActivityName(picked.activity_name) || '');
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
      setValue('item_display_mode', 'single');
      setValue('item_source_pricing_key', text(picked.pricing_key) || '');
      setValue('item_selected_bundle_items', '[]');
      const rowGroup = text(itemRow.dataset.paRowGroup || picked.proposal_group);
      const infoStrip = itemRow.querySelector('[data-pa-item-info-strip]');
      if (infoStrip && !itemRow.hasAttribute('data-pa-summer-row')) {
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
        infoStrip.hidden = !publicActivityName(picked.activity_name);
      }

      calcItemRow(itemRow);
      if (form) calcGrandTotal(form);
      if (form) updateProposalStepper(form);
    }, { signal });

    // ── Click handler ─────────────────────────────────────────────────────────
    root.addEventListener('click', async (event) => {
      // Discount / notes section toggle
      const discountToggle = event.target.closest?.('[data-pa-discount-toggle]');
      if (discountToggle) {
        const summary = discountToggle.closest('[data-pa-discount-details]')
          || discountToggle.closest('.ds-pa-summary')?.querySelector('[data-pa-discount-details]');
        if (summary) {
          summary.hidden = !summary.hidden;
          discountToggle.textContent = summary.hidden ? '+ הנחה / הערות' : '− סגור הנחה / הערות';
        }
        return;
      }

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
      const rowEl = !event.target.closest?.('[data-pa-preview],[data-pa-edit-row],[data-pa-print],[data-pa-delete-row],[data-pa-clone-row]')
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
        const editTargetRow = data.rows.find((item) => text(item.id) === text(editBtn.dataset.paEditRow));
        if (editTargetRow && normalizeProposalStatus(text(editTargetRow.status)) === 'sent') {
          showToast('הצעה שנשלחה נעולה ולא ניתן לערוך אותה.', 'error');
          return;
        }
        if (editTargetRow && text(editTargetRow.status) === 'approved') {
          window.alert('לא ניתן לערוך הצעה מאושרת. ניתן לשכפל אותה להצעה חדשה.');
          return;
        }
        const row = rowWithCentralContact(editTargetRow);
        if (!row) return;
        // Edit opens in the full-width work area (same experience as creating a new proposal),
        // never inside the narrow side drawer.
        setDocumentEditMode(root, false);
        await openForm('edit', row);
        return;
      }


      const editDocumentBtn = event.target.closest?.('[data-pa-edit-document]');
      if (editDocumentBtn) {
        if (!canManage) return;
        const id = text(editDocumentBtn.dataset.paEditDocument);
        const row = data.rows.find((r) => text(r.id) === id);
        if (!row || text(row.status) === 'approved') return;
        if (normalizeProposalStatus(text(row.status)) === 'sent') {
          showToast('הצעה שנשלחה נעולה ולא ניתן לערוך אותה.', 'error');
          return;
        }
        const templateKey = proposalGroupTemplateKey(row.activity_type_group);
        const loadedTemplateSections = proposalTemplateSections.filter((s) => text(s.template_key) === templateKey);
        const templateSections = loadedTemplateSections;
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
            <button type="button" class="ds-btn ds-btn--sm" data-pa-doc-reset="${escapeHtml(id)}">איפוס נוסח</button>
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
        const templateKey = proposalGroupTemplateKey(row.activity_type_group);
        const loadedTemplateSections = proposalTemplateSections.filter((s) => text(s.template_key) === templateKey);
        const templateSections = loadedTemplateSections;
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
        await openPreview(row, items);
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
        await openPreview(row, items);
        return;
      }

      const statusActionBtn = event.target.closest?.('[data-pa-status-action]');
      if (statusActionBtn) {
        if (!canManage) return;
        const newStatus = text(statusActionBtn.dataset.paStatusAction);
        const id = text(statusActionBtn.dataset.paActionId);
        if (!newStatus || !id) return;
        const currentActionRow = data.rows.find((r) => text(r.id) === id);
        if (currentActionRow && normalizeProposalStatus(text(currentActionRow.status)) === 'sent') {
          showToast('הצעה שנשלחה נעולה ולא ניתן לשנות את סטטוסה.', 'error');
          return;
        }
        if (newStatus === 'approved') {
          if (!canApproveProposalsAgreements(state)) {
            showToast('אין הרשאה לאשר ולחתום הצעות מחיר', 'error');
            return;
          }
          const row = data.rows.find((r) => text(r.id) === id);
          if (!row) return;
          let items = [];
          try { if (typeof api.readProposalAgreementItems === 'function') items = await api.readProposalAgreementItems(id); } catch { items = []; }
          await openPreview(row, items, {
            signatureMode: true,
            onSignatureConfirm: async (signatureMeta, closeOverlay) => {
              statusActionBtn.disabled = true;
              try {
                const result = await api.updateProposalAgreementStatus(id, 'approved', '', signatureMeta);
                replaceLocalRow(data, result?.row || { id, status: 'approved', approval_note: '', signature_meta: signatureMeta });
                refreshTable();
                const updated = data.rows.find((item) => text(item.id) === id);
                const drawer = root.querySelector('[data-pa-drawer]');
                if (drawer && updated) drawer.outerHTML = drawerHtml(updated, activityNameOptions, state);
                closeOverlay?.();
                showToast('ההצעה אושרה ונחתמה', 'success');
              } catch (err) {
                statusActionBtn.disabled = false;
                window.alert?.(`שגיאה באישור וחתימה: ${err?.message || err}`);
              }
            }
          });
          return;
        }
        if (newStatus === 'returned_for_changes') {
          const drawer = root.querySelector('[data-pa-drawer]');
          const inlineFormHost = drawer?.querySelector('[data-pa-inline-form]');
          if (!inlineFormHost) return;
          inlineFormHost.innerHTML = `<div class="ds-pa-return-form" data-pa-return-form>
            <h4 style="font-size:0.85rem;margin:0 0 6px;font-weight:600">החזרה לתיקון</h4>
            <label style="display:block;font-size:0.8rem;margin-bottom:4px">הערה לתיקון (אופציונלי)</label>
            <textarea class="ds-input ds-input--sm" data-pa-return-note rows="3" style="width:100%;margin-bottom:8px;box-sizing:border-box" placeholder="הסבר מה יש לתקן..."></textarea>
            <div style="display:flex;gap:6px">
              <button type="button" class="ds-btn ds-btn--sm" data-pa-return-confirm data-pa-return-id="${escapeHtml(id)}">החזר לתיקון</button>
              <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-pa-return-cancel>ביטול</button>
            </div>
            <p class="ds-pa-form-error" data-pa-return-error role="alert" style="color:#dc2626;font-size:0.8rem;margin-top:4px"></p>
          </div>`;
          inlineFormHost.querySelector('[data-pa-return-note]')?.focus();
          return;
        }
        statusActionBtn.disabled = true;
        try {
          const result = await api.updateProposalAgreementStatus(id, newStatus, '');
          replaceLocalRow(data, result?.row || { id, status: newStatus, approval_note: '' });
          refreshTable();
          const updated = data.rows.find((item) => text(item.id) === id);
          const drawer = root.querySelector('[data-pa-drawer]');
          if (drawer && updated) drawer.outerHTML = drawerHtml(updated, activityNameOptions, state);
        } catch (err) {
          statusActionBtn.disabled = false;
          const drawerErrEl = root.querySelector('[data-pa-drawer-error]');
          if (drawerErrEl) drawerErrEl.textContent = `שגיאה בעדכון סטטוס: ${err?.message || err}`;
          else window.alert(`שגיאה בעדכון סטטוס: ${err?.message || err}`);
        }
        return;
      }

      const returnConfirmBtn = event.target.closest?.('[data-pa-return-confirm]');
      if (returnConfirmBtn) {
        const id = text(returnConfirmBtn.dataset.paReturnId);
        const returnForm = returnConfirmBtn.closest('[data-pa-return-form]');
        const note = text(returnForm?.querySelector('[data-pa-return-note]')?.value) || '';
        const errorEl = returnForm?.querySelector('[data-pa-return-error]');
        returnConfirmBtn.disabled = true;
        try {
          const result = await api.updateProposalAgreementStatus(id, 'returned_for_changes', note);
          replaceLocalRow(data, result?.row || { id, status: 'returned_for_changes', approval_note: note });
          refreshTable();
          const updated = data.rows.find((item) => text(item.id) === id);
          const drawer = root.querySelector('[data-pa-drawer]');
          if (drawer && updated) drawer.outerHTML = drawerHtml(updated, activityNameOptions, state);
        } catch (err) {
          returnConfirmBtn.disabled = false;
          if (errorEl) errorEl.textContent = `שגיאה: ${err?.message || err}`;
        }
        return;
      }

      if (event.target.closest?.('[data-pa-return-cancel]')) {
        event.target.closest('[data-pa-return-form]')?.remove();
        return;
      }

      // Bundle: confirm with optional child detail
      const bundleConfirmBtn = event.target.closest?.('[data-pa-bundle-confirm]');
      if (bundleConfirmBtn) {
        const itemRow = bundleConfirmBtn.closest('[data-pa-item-row]');
        if (!itemRow) return;
        let pickedData = {};
        try { pickedData = JSON.parse(itemRow.dataset.paBundlePicked || '{}'); } catch { pickedData = {}; }
        applyBundleParentToRow(itemRow, pickedData, { keepGeneral: false });
        const bundlePrompt = itemRow.querySelector('[data-pa-bundle-prompt]');
        if (bundlePrompt) bundlePrompt.hidden = true;
        return;
      }

      // Bundle: keep as general (no detail)
      const bundleKeepBtn = event.target.closest?.('[data-pa-bundle-keep]');
      if (bundleKeepBtn) {
        const itemRow = bundleKeepBtn.closest('[data-pa-item-row]');
        if (!itemRow) return;
        let pickedData = {};
        try { pickedData = JSON.parse(itemRow.dataset.paBundlePicked || '{}'); } catch { pickedData = {}; }
        itemRow.querySelectorAll('[data-pa-bundle-child-check]').forEach((input) => { input.checked = false; });
        applyBundleParentToRow(itemRow, pickedData, { keepGeneral: true });
        const bundlePrompt = itemRow.querySelector('[data-pa-bundle-prompt]');
        if (bundlePrompt) bundlePrompt.hidden = true;
        return;
      }

      // Catalog toggle is bound directly on the form button (setupCatalogAttach).

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
        const selectedActivityType = text(form?.querySelector('[data-pa-activity-type-filter]')?.value);
        const basePricing = filterPricingByProposalType(proposalActivityPricing, rowGroup || currentType);
        const rowPricing = filterPricingByActivityType(basePricing, selectedActivityType);
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

      const savePendingBtn = event.target.closest?.('[data-pa-save-pending]');
      if (savePendingBtn) {
        const form = savePendingBtn.closest('[data-pa-form]');
        if (!form) return;
        const targetStatus = text(savePendingBtn.dataset.paTargetStatus) || 'sent';
        if (form.dataset.paPreviewSeen !== 'yes') {
          // Preview not yet seen — open it automatically with a submit button inside
          const payload = payloadFromForm(form);
          const tempRow = { ...payload, id: text(form.dataset.paId) || '' };
          const items = payload._items || [];
          form.dataset.paPreviewSeen = 'yes'; // mark immediately
          try {
            await openPreview(tempRow, items, {
              form,
              onSubmit: async () => { await saveForm(form, targetStatus); },
              submitLabel: targetStatus === 'approved' ? 'אישור והפקת הצעה' : 'שליחה לאישור'
            });
          } catch (e) {
            console.warn('[PA] openPreview error (pending flow):', e);
          }
        } else {
          await saveForm(form, targetStatus);
        }
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

      const cloneBtn = event.target.closest?.('[data-pa-clone-row]');
      if (cloneBtn) {
        if (!canManage) return;
        const id = text(cloneBtn.dataset.paCloneRow);
        const sourceRow = data.rows.find((item) => text(item.id) === id);
        if (!sourceRow) return;
        cloneBtn.disabled = true;
        try {
          let sourceItems = [];
          try {
            if (typeof api.readProposalAgreementItems === 'function') {
              sourceItems = await api.readProposalAgreementItems(id);
            }
          } catch { sourceItems = []; }
          const clonePayload = {
            authority_id: sourceRow.authority_id || null,
            school_id: sourceRow.school_id || null,
            client_authority: text(sourceRow.client_authority),
            school_framework: text(sourceRow.school_framework),
            contact_name: text(sourceRow.contact_name),
            contact_role: text(sourceRow.contact_role),
            phone: text(sourceRow.phone),
            email: text(sourceRow.email),
            contact_school_id: sourceRow.contact_school_id || null,
            document_type: text(sourceRow.document_type),
            activity_type_group: text(sourceRow.activity_type_group),
            proposal_date: text(sourceRow.proposal_date),
            activity_names: text(sourceRow.activity_names),
            notes: text(sourceRow.notes),
            custom_document_sections: Array.isArray(sourceRow.custom_document_sections) ? sourceRow.custom_document_sections : [],
            include_catalog: includeCatalogValue(sourceRow.include_catalog),
            status: 'draft',
          };
          const cloneItems = sourceItems.map(({ id: _id, ...rest }) => rest);
          const result = await api.addProposalAgreement(clonePayload);
          if (!result?.ok || !result?.row?.id) throw new Error('clone_failed');
          const newId = result.row.id;
          if (cloneItems.length) {
            await api.saveProposalAgreementItems(newId, cloneItems);
          }
          data.rows = dedupeById([result.row, ...(Array.isArray(data.rows) ? data.rows : []).map(normalizeProposalAgreementRow)]);
          refreshTable();
          cloneBtn.disabled = false;
          const newRow = rowWithCentralContact(normalizeProposalAgreementRow(result.row));
          // The cloned draft opens straight in the full-width edit form.
          setDocumentEditMode(root, false);
          if (newRow) await openForm('edit', newRow);
        } catch (err) {
          cloneBtn.disabled = false;
          const drawerErrEl = root.querySelector('[data-pa-drawer-error]');
          if (drawerErrEl) drawerErrEl.textContent = `שגיאה בשכפול: ${err?.message || err}`;
          else window.alert(`שגיאה בשכפול: ${err?.message || err}`);
        }
        return;
      }

      if (event.target.closest?.('[data-pa-unlock-client]')) {
        const form = event.target.closest('[data-pa-form]');
        form.dataset.paNewClient = 'no';
        ['client_authority', 'school_framework', 'contact_name', 'contact_role', 'phone', 'email'].forEach((name) => {
          const inp = form.querySelector(`input[name="${name}"]`);
          if (inp) inp.value = '';
        });
        setContactSource(form, {});
        const card = form.querySelector('[data-pa-client-card]');
        if (card) { card.hidden = true; card.innerHTML = ''; }
        const searchRow = form.querySelector('[data-pa-client-search-row]');
        if (searchRow) searchRow.hidden = false;
        const fields = form.querySelector('[data-pa-client-fields]');
        if (fields) fields.hidden = true;
        form.querySelectorAll('[data-pa-contact-manual-fields]').forEach((el) => { el.hidden = true; });
        const addContactRowUnlock = form.querySelector('[data-pa-add-contact-row]');
        if (addContactRowUnlock) addContactRowUnlock.hidden = true;
        const roCtxUnlock = form.querySelector('[data-pa-contact-ro-ctx]');
        if (roCtxUnlock) roCtxUnlock.hidden = true;
        const pickerHost = form.querySelector('[data-pa-contact-picker-host]');
        if (pickerHost) pickerHost.innerHTML = '';
        resetClientSearchPanels(form);
        applyClientSearchMode(form);
        updateProposalStepper(form);
        form.querySelector('[data-pa-client-search-input]')?.focus();
        return;
      }

      if (event.target.closest?.('[data-pa-change-authority-step]')) {
        const form = event.target.closest('[data-pa-form]');
        if (!form) return;
        resetClientSearchPanels(form);
        applyClientSearchMode(form);
        updateProposalStepper(form);
        form.querySelector('[data-pa-client-search-input]')?.focus();
        return;
      }

      if (event.target.closest?.('[data-pa-clear-client]')) {
        const form = event.target.closest('[data-pa-form]');
        if (!form) return;
        form.dataset.paNewClient = 'no';
        ['client_authority', 'school_framework', 'contact_name', 'contact_role', 'phone', 'email'].forEach((name) => {
          const inp = form.querySelector(`input[name="${name}"]`);
          if (inp) inp.value = '';
        });
        setContactSource(form, {});
        const card = form.querySelector('[data-pa-client-card]');
        if (card) { card.hidden = true; card.innerHTML = ''; }
        const searchRow = form.querySelector('[data-pa-client-search-row]');
        if (searchRow) searchRow.hidden = false;
        const fields = form.querySelector('[data-pa-client-fields]');
        if (fields) fields.hidden = true;
        form.querySelectorAll('[data-pa-contact-manual-fields]').forEach((el) => { el.hidden = true; });
        const addContactRowClear = form.querySelector('[data-pa-add-contact-row]');
        if (addContactRowClear) addContactRowClear.hidden = true;
        const roCtxClear = form.querySelector('[data-pa-contact-ro-ctx]');
        if (roCtxClear) roCtxClear.hidden = true;
        const pickerHost = form.querySelector('[data-pa-contact-picker-host]');
        if (pickerHost) pickerHost.innerHTML = '';
        resetClientSearchPanels(form);
        applyClientSearchMode(form);
        updateProposalStepper(form);
        form.querySelector('[data-pa-client-search-input]')?.focus();
        return;
      }

      if (event.target.closest?.('[data-pa-add-contact-toggle]')) {
        const form = event.target.closest('[data-pa-form]');
        if (!form) return;
        const addContactRow = form.querySelector('[data-pa-add-contact-row]');
        if (addContactRow) addContactRow.hidden = true;
        form.querySelectorAll('[data-pa-contact-manual-fields]').forEach((el) => { el.hidden = false; });
        const roCtx = form.querySelector('[data-pa-contact-ro-ctx]');
        if (roCtx) roCtx.hidden = false;
        form.querySelector('input[name="contact_name"]')?.focus();
        return;
      }

      const previewFormBtn = event.target.closest?.('[data-pa-preview-form]');
      if (previewFormBtn) {
        const form = previewFormBtn.closest('[data-pa-form]');
        if (!form) return;
        // Mark immediately — before any await — so paPreviewSeen is always set
        form.dataset.paPreviewSeen = 'yes';
        const payload = payloadFromForm(form);
        const tempRow = { ...payload, id: text(form.dataset.paId) || '' };
        const items = payload._items || [];
        try {
          await openPreview(tempRow, items, { form });
        } catch (e) {
          console.warn('[PA] openPreview error:', e);
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
      await saveForm(form, null);
    }, { signal });
  }
};
