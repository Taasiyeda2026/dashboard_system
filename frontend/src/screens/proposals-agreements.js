import { escapeHtml } from './shared/html.js';
import { dsCard, dsEmptyState, dsPageHeader, dsScreenStack, dsTableWrap } from './shared/layout.js';
import { showToast } from './shared/toast.js';
import { countPendingApprovedProposals, isProposalApprovedPendingSend } from './shared/proposals-pending-count.js';

export { countPendingApprovedProposals, isProposalApprovedPendingSend };

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

const COURSE_SHORT_NAMES_BY_GEFEN = Object.freeze({
  '6089': 'ביומימיקרי',
  '57651': 'טכנולוגיות החלל',
  '67867': 'מנהיגות ירוקה',
  '27342': 'משחקי קופסה',
  '53828': 'ביומימיקרי לחטיבה',
  '9545': 'בינה מלאכותית',
  '57646': 'השמיים אינם הגבול',
  '53819': 'יישומי הבינה המלאכותית',
  '3604': 'פורצות דרך',
  '960': 'יזמות פרימיום',
  '46091': 'רוקחים עולם',
  '52279': 'אופק לתעשייה'
});
const OLD_CANCELLATION_SENTENCE = 'במקרה של הפסקת הקורס ביוזמת בית הספר, ייגבה תשלום מלא עבור המפגשים שהתקיימו בפועל וכן 10% מעלות יתרת המפגשים שלא התקיימו.';
const NEW_CANCELLATION_SENTENCE = 'ביטול הקורס ביוזמת המזמין, ייגבה תשלום מלא על מפגשים שהתקיימו ו-10% מעלות יתרת המפגשים שלא התקיימו.';
const OLD_PAYMENT_SENTENCE = 'התשלום עבור הקורס יחולק לשני חלקים: חשבונית ראשונה תונפק עם תחילת הקורס. חשבונית שנייה תונפק לאחר השלמת מחצית מהיקף הקורס.';
const NEW_PAYMENT_SENTENCE = 'התשלום עבור הקורס יחולק לשתי חשבוניות: הראשונה תונפק עם תחילת הקורס והשנייה לאחר השלמת מחצית מהיקפו.';
const OLD_SUMMER_PAYMENT_TERMS = 'חשבונית לתשלום תונפק עם תחילת הסדנה.\nתנאי התשלום: שוטף + 30 ממועד הנפקת החשבונית.';
const OLD_SUMMER_PAYMENT_TERMS_INLINE = 'חשבונית לתשלום תונפק עם תחילת הסדנה. תנאי התשלום: שוטף + 30 ממועד הנפקת החשבונית.';
const OLD_SUMMER_PAYMENT_TERMS_INVOICE_ONLY = 'חשבונית לתשלום תונפק עם תחילת הסדנה.';
const NEW_SUMMER_PAYMENT_TERMS = 'התמורה נקבעה בהתאם למספר המשתתפים הנקוב בהצעת המחיר. כל משתתף נוסף מעבר למספר זה יחויב בתוספת של 25 ש״ח.\nחשבונית לתשלום תונפק עם תחילת הפעילות. תנאי התשלום: שוטף + 30 ממועד הנפקת החשבונית.';
const OLD_SUMMER_SPACE_REQUIREMENT_SENTENCE = 'העמדת מרחב מתאים לסדנה, הכולל מקרן, לוח וחיבור תקין לאינטרנט, ככל שנדרש לפי אופי הסדנה';
const NEW_SUMMER_SPACE_REQUIREMENT_SENTENCE = 'העמדת מרחב מתאים לסדנה, הכולל מקרן, לוח וחיבור תקין לאינטרנט.';

export const STATUS_OPTIONS = ['draft', 'pending_approval', 'returned_for_changes', 'approved', 'sent', 'cancelled'];
export const STATUS_LABELS = {
  draft:                'טיוטה',
  sent:                 'נשלח',
  pending_approval:     'ממתין לאישור',
  returned_for_changes: 'הוחזר לתיקון',
  approved:             'מאושר',
  cancelled:            'בוטל'
};
function normalizeProposalStatus(status) {
  const raw = text(status);
  const aliases = {
    draft: 'draft',
    'טיוטה': 'draft',
    cancelled: 'cancelled',
    canceled: 'cancelled',
    'בוטל': 'cancelled',
    'מבוטל': 'cancelled',
    sent: 'sent',
    'נשלח': 'sent',
    pending_approval: 'pending_approval',
    'ממתין לאישור': 'pending_approval',
    returned_for_changes: 'returned_for_changes',
    'הוחזר לתיקון': 'returned_for_changes',
    approved: 'approved',
    'מאושר': 'approved',
    'מאושר וחתום': 'approved',
  };
  return aliases[raw] ?? raw;
}

function notifyPendingProposalsNav(rows) {
  if (typeof document === 'undefined') return;
  try {
    document.dispatchEvent(new CustomEvent('app:proposals-pending-updated', {
      detail: { rows: Array.isArray(rows) ? rows : [] }
    }));
  } catch { /* ignore */ }
}

const FIELD_LABELS = {
  client_authority:    'רשות / מועצה / עירייה',
  school_framework:    'בית ספר',
  activity_type_group: 'סוג הצעה',
  proposal_date:       'תאריך הצעה',
  activity_names:      'שם הפעילויות',
  contact_name:        'איש קשר',
  contact_role:        'תפקיד',
  phone:               'נייד',
  email:               'דוא״ל',
  notes:               'הערות',
  status:              'סטטוס',
  approval_note:       'הערת אישור',
  proposal_domain:     'תחום'
};

const REQUIRED_FIELDS_DRAFT = ['client_authority', 'activity_type_group'];
const REQUIRED_FIELDS_PENDING = ['client_authority', 'activity_type_group', 'proposal_date'];
const FORM_FIELDS = [
  'client_authority', 'school_framework', 'document_type', 'activity_type_group', 'proposal_domain',
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

function normalizeHebrewQuoteVariants(value) {
  return text(value)
    .replace(/[״"]/g, '\'')
    .replace(/[׳`]/g, '\'');
}

function normalizeContactRoleDisplay(value) {
  const role = text(value);
  return role === 'מנהל/ת' ? 'מנהל/ת בית הספר' : role;
}

function courseShortNameForItem(item = {}) {
  const gefen = text(proposalTextField(item, 'gefen_number', 'gefenNumber') || item.activity_no).replace(/\D/g, '');
  return COURSE_SHORT_NAMES_BY_GEFEN[gefen] || publicActivityName(proposalField(item, 'item_name', 'itemName'));
}

function applyFocusedProposalTextUpdates(body, templateKey = '') {
  const key = proposalGroupTemplateKey(templateKey || normalizeProposalGroup(templateKey)) || normalizeProposalGroup(templateKey);
  const normalizedBody = normalizeMultilineText(body);
  if (key === 'summer') {
    return normalizedBody
      .replaceAll(OLD_SUMMER_PAYMENT_TERMS, NEW_SUMMER_PAYMENT_TERMS)
      .replaceAll(OLD_SUMMER_PAYMENT_TERMS_INLINE, NEW_SUMMER_PAYMENT_TERMS)
      .replaceAll(OLD_SUMMER_PAYMENT_TERMS_INVOICE_ONLY, NEW_SUMMER_PAYMENT_TERMS)
      .replaceAll(OLD_SUMMER_SPACE_REQUIREMENT_SENTENCE, NEW_SUMMER_SPACE_REQUIREMENT_SENTENCE);
  }
  if (key !== 'next_year' && key !== 'combined') return normalizedBody;
  return normalizedBody
    .replaceAll(OLD_CANCELLATION_SENTENCE, NEW_CANCELLATION_SENTENCE)
    .replaceAll(OLD_PAYMENT_SENTENCE, NEW_PAYMENT_SENTENCE);
}


const EMPTY_PROPOSAL_GROUP_LOOKUPS = Object.freeze({
  groups: [],
  groupByKey: new Map(),
  aliasToKey: new Map()
});
let proposalGroupLookups = EMPTY_PROPOSAL_GROUP_LOOKUPS;
const COMBINED_TEMPLATE_GROUP_KEYS = Object.freeze(['summer', 'next_year']);

const PROPOSAL_GROUP_DISPLAY_FALLBACKS = Object.freeze({
  summer: 'קיץ',
  next_year: 'תשפ״ז',
  combined: 'הצעה משולבת',
  tour: 'סיור'
});
const PROPOSAL_GROUP_LEGACY_ALIASES = Object.freeze({
  'קיץ תשפ״ו': 'summer',
  'פעילויות קיץ': 'summer',
  'שנת הלימודים תשפ״ז': 'next_year',
  'תוכניות תשפ״ז': 'next_year',
  'שנה הבאה': 'next_year',
  'תשפ״ז': 'next_year',
  'הצעה משולבת': 'combined',
  'סיור': 'tour',
  'סיורים': 'tour',
  'סיור לימודי': 'tour',
  'סיור לימודי חווייתי': 'tour',
  'התנסות בתעשייה – סיור לימודי חווייתי': 'tour',
  'קיץ תשפ״ו ושנת הלימודים תשפ״ז': 'combined',
  'קיץ תשפ״ו ותוכניות תשפ״ז': 'combined',
  'קיץ תשפ״ו + תשפ״ז': 'combined'
});

function userFacingProposalGroupLabel(value = '') {
  return text(value)
    .replace(/פעילויות קיץ/g, PROPOSAL_GROUP_DISPLAY_FALLBACKS.summer)
    .replace(/שנה הבאה/g, PROPOSAL_GROUP_DISPLAY_FALLBACKS.next_year);
}

function proposalGroupSafeDisplayName(groupKey = '', displayName = '') {
  const key = text(groupKey);
  const label = userFacingProposalGroupLabel(displayName);
  // Keep internal / Supabase values intact, but force the user-facing annual proposal label.
  if (key === 'next_year') return PROPOSAL_GROUP_DISPLAY_FALLBACKS.next_year;
  if (label && label !== key) return label;
  return userFacingProposalGroupLabel(PROPOSAL_GROUP_DISPLAY_FALLBACKS[key] || label || key);
}
let proposalTemplateSectionsLookup = [];

const TOUR_TEMPLATE_KEY = 'tour';
const TOUR_ACTIVITY_NAME = 'התנסות בתעשייה – סיור לימודי חווייתי';
const TOUR_GEFEN_NUMBER = '13990';
const TOUR_ACTIVITY_LINE = `${TOUR_ACTIVITY_NAME} – גפ״ן ${TOUR_GEFEN_NUMBER}`;
const TOUR_INTRO_BODY = `תעשיידע היא עמותה חינוכית-טכנולוגית הפועלת לחיבור בין מערכת החינוך לבין התעשייה, החדשנות ועולמות התעסוקה. במסגרת פעילותה מובילה העמותה סיורים לימודיים-חווייתיים המאפשרים לתלמידים חשיפה לסביבות עבודה אמיתיות, לטכנולוגיות מתקדמות ולבעלי תפקידים מגוונים.

הסיור מחבר בין הלמידה בבית הספר לבין היישום המעשי בשטח, מעודד סקרנות וחשיבה יזמית ומסייע לתלמידות ולתלמידים להיחשף לאפשרויות עתידיות בלימודים ובעולם העבודה. הסיור מותאם לשכבת הגיל, למגמות הלימוד, למטרות החינוכיות של בית הספר ולאופי הגוף המארח.`;
const TOUR_ACTIVITY_INTRO_BODY = TOUR_ACTIVITY_LINE;
const TOUR_CANCELLATION_TERMS_BODY = `ביטול סיור בהתראה של פחות משני ימי עבודה יחויב כסיור שהתקיים בפועל.

שינוי מועד הסיור בשל הנחיות, מצב חירום או אילוצי הגוף המארח יתואם למועד חלופי מוסכם בין הצדדים.

ככל שהסיור לא יתקיים במועדו, תעשיידע תפעל לתיאום מועד חלופי בהתאם לזמינות הצדדים.`;

function isTourProposalGroup(value = '') {
  const normalized = normalizeProposalGroup(value);
  const key = proposalGroupTemplateKey(normalized) || normalized;
  return key === TOUR_TEMPLATE_KEY || normalized === TOUR_TEMPLATE_KEY || text(value) === TOUR_TEMPLATE_KEY;
}



function proposalField(object = {}, snakeKey = '', camelKey = '') {
  return object?.[camelKey] ?? object?.[snakeKey];
}

function proposalTextField(object = {}, snakeKey = '', camelKey = '') {
  return text(proposalField(object, snakeKey, camelKey));
}

function normalizeTemplateSection(section = {}) {
  const templateKey = proposalTextField(section, 'template_key', 'templateKey');
  const templateName = proposalTextField(section, 'template_name', 'templateName');
  const activityTypeGroup = proposalTextField(section, 'activity_type_group', 'activityTypeGroup');
  const sectionKey = proposalTextField(section, 'section_key', 'sectionKey');
  const sectionTitle = proposalTextField(section, 'section_title', 'sectionTitle');
  const sectionBody = normalizeMultilineText(proposalField(section, 'section_body', 'sectionBody'));
  const sortOrder = Number(proposalField(section, 'sort_order', 'sortOrder')) || 0;
  const isActive = proposalField(section, 'is_active', 'isActive');
  return {
    ...section,
    templateKey,
    templateName,
    activityTypeGroup,
    sectionKey,
    sectionTitle,
    sectionBody,
    sortOrder,
    isActive: isActive !== false,
    template_key: templateKey,
    template_name: templateName,
    activity_type_group: activityTypeGroup,
    section_key: sectionKey,
    section_title: sectionTitle,
    section_body: sectionBody,
    sort_order: sortOrder,
    is_active: isActive !== false
  };
}

function normalizeTemplateSections(sections = []) {
  return (Array.isArray(sections) ? sections : []).map(normalizeTemplateSection);
}

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
  const groupKey = text(record.group_key || record.groupKey || record.key || record.value || record.id);
  if (!groupKey) return null;
  const displayName = proposalGroupSafeDisplayName(groupKey, record.display_name || record.displayName || record.name || record.label || record.title);
  const templateKey = text(record.template_key || record.templateKey || record.template || record.document_template_key || groupKey);
  const aliases = toArray(record.aliases || record.alias_names || record.legacy_names || record.old_names);
  const includedGroupKeys = toArray(record.included_group_keys || record.includedGroupKeys || record.child_group_keys || record.child_groups || record.includes)
    .map(text).filter(Boolean);
  const sortOrder = Number(record.sort_order ?? record.sortOrder ?? record.order ?? fallbackIndex + 1) || fallbackIndex + 1;
  const isActive = record.is_active ?? record.isActive;
  return {
    ...record,
    group_key: groupKey,
    groupKey,
    display_name: displayName,
    displayName,
    template_key: templateKey,
    templateKey,
    sort_order: sortOrder,
    sortOrder,
    is_active: isActive !== false,
    isActive: isActive !== false,
    is_combined: record.is_combined === true || record.allows_multiple_groups === true || includedGroupKeys.length > 0,
    show_gefen: record.show_gefen !== false,
    included_group_keys: includedGroupKeys,
    includedGroupKeys,
    aliases: aliases.filter(Boolean)
  };
}

function dataGroupAliasRows(data = {}) {
  return Array.isArray(data.proposalGroupAliases)
    ? data.proposalGroupAliases
    : Array.isArray(data.proposal_group_aliases) ? data.proposal_group_aliases : [];
}

function collectTemplateSectionGroupHints(sections = []) {
  const hints = [];
  const seen = new Set();
  (Array.isArray(sections) ? sections : []).forEach((section) => {
    const templateKey = proposalTextField(section, 'template_key', 'templateKey');
    const activityGroup = proposalTextField(section, 'activity_type_group', 'activityTypeGroup');
    const templateName = proposalTextField(section, 'template_name', 'templateName');
    if (!templateKey || seen.has(templateKey)) return;
    seen.add(templateKey);
    hints.push({
      group_key: templateKey,
      display_name: templateName || activityGroup || templateKey,
      template_key: templateKey,
      included_group_keys: templateKey === 'combined' ? [...COMBINED_TEMPLATE_GROUP_KEYS] : [],
      is_combined: templateKey === 'combined',
      is_active: true
    });
  });
  return hints;
}

function collectGroupRecords(data = {}, rows = [], pricingOptions = []) {
  const canonicalActivityGroups = [data.proposalActivityGroups, data.proposal_activity_groups].filter(Array.isArray).flat();
  const directGroups = canonicalActivityGroups.length
    ? canonicalActivityGroups
    : [data.proposalGroups, data.activityTypeGroups, collectTemplateSectionGroupHints(data.proposalTemplateSections || data.proposal_template_sections)].filter(Array.isArray).flat();
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

  if (!canonicalActivityGroups.length) {
    (Array.isArray(rows) ? rows : []).forEach((row) => addRawGroup(row.activity_type_group || row.proposal_group));
    (Array.isArray(pricingOptions) ? pricingOptions : []).forEach((row) => addRawGroup(row.proposal_group || row.activity_type_group));
  }

  return groups.filter((group) => group.is_active).sort((a, b) => a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name, 'he'));
}

function setProposalGroupLookups(data = {}, rows = [], pricingOptions = []) {
  proposalTemplateSectionsLookup = normalizeTemplateSections(Array.isArray(data?.proposalTemplateSections)
    ? data.proposalTemplateSections
    : Array.isArray(data?.proposal_template_sections) ? data.proposal_template_sections : []);
  const canonicalActivityGroups = [data.proposalActivityGroups, data.proposal_activity_groups].filter(Array.isArray).flat();
  const groups = collectGroupRecords({ ...data, proposalTemplateSections: proposalTemplateSectionsLookup }, rows, pricingOptions);
  const groupByKey = new Map();
  const aliasToKey = new Map();
  groups.forEach((group) => {
    groupByKey.set(group.group_key, group);
    aliasToKey.set(group.group_key, group.group_key);
    aliasToKey.set(normalizeHebrewQuoteVariants(group.group_key), group.group_key);
    aliasToKey.set(group.display_name, group.group_key);
    aliasToKey.set(normalizeHebrewQuoteVariants(group.display_name), group.group_key);
    if (group.template_key) { aliasToKey.set(group.template_key, group.group_key); aliasToKey.set(normalizeHebrewQuoteVariants(group.template_key), group.group_key); }
    group.aliases.forEach((alias) => { aliasToKey.set(alias, group.group_key); aliasToKey.set(normalizeHebrewQuoteVariants(alias), group.group_key); });
  });
  dataGroupAliasRows(data)
    .forEach((aliasRow) => {
      const alias = text(aliasRow.alias_name || aliasRow.alias || aliasRow.name || aliasRow.value);
      const groupKey = text(aliasRow.group_key || aliasRow.target_group_key || aliasRow.proposal_group_key);
      if (alias && groupKey) { aliasToKey.set(alias, groupKey); aliasToKey.set(normalizeHebrewQuoteVariants(alias), groupKey); }
    });
  proposalTemplateSectionsLookup.forEach((section) => {
    const templateKey = proposalTextField(section, 'template_key', 'templateKey');
    const activityGroup = proposalTextField(section, 'activity_type_group', 'activityTypeGroup');
    const templateName = proposalTextField(section, 'template_name', 'templateName');
    if (!templateKey) return;
    if (!canonicalActivityGroups.length && !groupByKey.has(templateKey)) {
      const normalized = normalizeProposalGroupRecord({
        group_key: templateKey,
        display_name: templateName || activityGroup || templateKey,
        template_key: templateKey,
        included_group_keys: templateKey === 'combined' ? [...COMBINED_TEMPLATE_GROUP_KEYS] : [],
        is_combined: templateKey === 'combined',
        is_active: true
      });
      if (normalized) {
        groupByKey.set(templateKey, normalized);
        groups.push(normalized);
        aliasToKey.set(templateKey, templateKey);
      }
    }
    if (activityGroup) { aliasToKey.set(activityGroup, templateKey); aliasToKey.set(normalizeHebrewQuoteVariants(activityGroup), templateKey); }
    if (templateName) { aliasToKey.set(templateName, templateKey); aliasToKey.set(normalizeHebrewQuoteVariants(templateName), templateKey); }
  });
  proposalGroupLookups = { groups, groupByKey, aliasToKey };
  return proposalGroupLookups;
}

export function resolveProposalGroupKey(value, proposalActivityGroups = proposalGroupLookups.groups, proposalGroupAliases = []) {
  const raw = text(value);
  if (!raw) return '';
  if (Object.prototype.hasOwnProperty.call(PROPOSAL_GROUP_DISPLAY_FALLBACKS, raw)) return raw;
  const normalizedRaw = normalizeHebrewQuoteVariants(raw);
  const groups = Array.isArray(proposalActivityGroups) ? proposalActivityGroups : [];
  const aliases = Array.isArray(proposalGroupAliases) ? proposalGroupAliases : [];
  const direct = new Map();
  groups.forEach((record, idx) => {
    const group = record?.group_key ? normalizeProposalGroupRecord(record, idx) : record;
    const groupKey = text(group?.group_key || group?.groupKey);
    if (!groupKey) return;
    [groupKey, group?.display_name, group?.displayName, group?.template_key, group?.templateKey, ...(Array.isArray(group?.aliases) ? group.aliases : [])]
      .map(text).filter(Boolean).forEach((alias) => {
        direct.set(alias, groupKey);
        direct.set(normalizeHebrewQuoteVariants(alias), groupKey);
      });
  });
  aliases.forEach((aliasRow) => {
    const alias = text(aliasRow.alias_name || aliasRow.alias || aliasRow.name || aliasRow.value);
    const groupKey = text(aliasRow.group_key || aliasRow.target_group_key || aliasRow.proposal_group_key);
    if (!alias || !groupKey) return;
    direct.set(alias, groupKey);
    direct.set(normalizeHebrewQuoteVariants(alias), groupKey);
  });
  Object.entries(PROPOSAL_GROUP_LEGACY_ALIASES).forEach(([alias, groupKey]) => {
    direct.set(alias, groupKey);
    direct.set(normalizeHebrewQuoteVariants(alias), groupKey);
  });
  return direct.get(raw) || direct.get(normalizedRaw) || raw;
}

function normalizeProposalGroup(value) {
  const raw = text(value);
  if (!raw) return '';
  const legacyResolved = resolveProposalGroupKey(raw, proposalGroupLookups.groups, []);
  return legacyResolved !== raw
    ? legacyResolved
    : proposalGroupLookups.aliasToKey.get(raw)
      || proposalGroupLookups.aliasToKey.get(normalizeHebrewQuoteVariants(raw))
      || raw;
}

function proposalGroupMeta(value) {
  const key = normalizeProposalGroup(value);
  return proposalGroupLookups.groupByKey.get(key)
    || (PROPOSAL_GROUP_DISPLAY_FALLBACKS[key] ? normalizeProposalGroupRecord({
      group_key: key,
      display_name: PROPOSAL_GROUP_DISPLAY_FALLBACKS[key],
      template_key: key,
      included_group_keys: key === 'combined' ? [...COMBINED_TEMPLATE_GROUP_KEYS] : [],
      is_active: true
    }) : null);
}

function normalizeProposalDomain(raw) {
  const v = text(raw).toUpperCase();
  return (v === 'N' || v === 'E') ? 'E' : 'Y';
}

function proposalGroupDisplayName(value) {
  const raw = text(value);
  if (!raw) return '';
  const key = normalizeProposalGroup(raw);
  if (key === 'next_year') return PROPOSAL_GROUP_DISPLAY_FALLBACKS.next_year;
  const meta = proposalGroupMeta(raw);
  return userFacingProposalGroupLabel(meta?.display_name || raw);
}

function resolveProposalTemplateKey(value) {
  const raw = text(value);
  const sections = proposalTemplateSectionsLookup;
  if (raw && sections.some((section) => proposalTextField(section, 'template_key', 'templateKey') === raw)) return raw;
  const meta = proposalGroupMeta(value);
  const normalized = normalizeProposalGroup(value);
  if (normalized && sections.some((section) => proposalTextField(section, 'template_key', 'templateKey') === normalized)) return normalized;
  const resolved = text(meta?.template_key || normalized || value);
  if (sections.some((section) => proposalTextField(section, 'template_key', 'templateKey') === resolved)) return resolved;
  const match = sections.find((section) => {
    const templateKey = proposalTextField(section, 'template_key', 'templateKey');
    const activityGroup = proposalTextField(section, 'activity_type_group', 'activityTypeGroup');
    return activityGroup && (activityGroup === raw || activityGroup === normalized)
      || templateKey && (templateKey === raw || templateKey === normalized);
  });
  return match ? proposalTextField(match, 'template_key', 'templateKey') : resolved;
}

function proposalGroupTemplateKey(value) {
  return resolveProposalTemplateKey(value);
}

function filterTemplateSectionsForGroup(templateSections = [], activityTypeGroup = '') {
  const selectedGroupKey = normalizeProposalGroup(activityTypeGroup);
  const resolvedTemplateKey = resolveProposalTemplateKey(activityTypeGroup);
  const templateKey = resolvedTemplateKey || selectedGroupKey;
  return (Array.isArray(templateSections) ? templateSections : [])
    .filter((section) => proposalTextField(section, 'template_key', 'templateKey') === templateKey)
    .sort((a, b) => Number(proposalField(a, 'sort_order', 'sortOrder') || 0) - Number(proposalField(b, 'sort_order', 'sortOrder') || 0));
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

export function proposalGroupOptions(data = {}, rows = [], pricingOptions = []) {
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
  const sectionKey = proposalTextField(section, 'section_key', 'sectionKey');
  const sectionTitle = proposalTextField(section, 'section_title', 'sectionTitle');
  const sectionBody = normalizeMultilineText(proposalField(section, 'section_body', 'sectionBody'));
  return {
    ...section,
    sectionKey,
    sectionTitle,
    sectionBody,
    section_key: sectionKey,
    section_title: sectionTitle,
    section_body: sectionBody
  };
}

function normalizeSearch(value) {
  return text(value).toLowerCase().normalize('NFKC');
}

export function buildProposalsAgreementsSearchText(row = {}) {
  return [
    row.id, row.client_name, row.client_authority, row.school_framework, row.authority_code, row.semel_mosad,
    row.document_type,
    row.proposal_domain,
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
  let rawStatus = text(row.status);
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
    principal_name:      text(row.principal_name),
    school_phone:        text(row.school_phone),
    school_address:      text(row.school_address || row.institution_address),
    city:                text(row.city),
    document_type:       text(row.document_type) || 'הצעת מחיר',
    activity_type_group: normalizeProposalGroup(rawGroup),
    proposal_domain:     normalizeProposalDomain(row.proposal_domain),
    proposal_date:       text(row.proposal_date),
    activity_names:      normalizeActivityNames(row.activity_names),
    contact_name:        text(row.contact_name),
    contact_role:        text(row.contact_role),
    phone:               text(row.phone),
    email:               text(row.email),
    notes:               text(row.notes),
    status:              (new Set(['draft', 'sent', 'pending_approval', 'returned_for_changes', 'approved', 'cancelled'])).has(rawStatus) ? rawStatus : 'draft',
    approval_note:       text(row.approval_note),
    total_amount:        row.total_amount != null ? Number(row.total_amount) || null : null,
    custom_document_sections: Array.isArray(row.custom_document_sections) ? row.custom_document_sections.map(normalizeDocumentSection) : [],
    include_catalog:     false,
    // Kept raw (not normalizeSignatureMeta's display fallback) so proposalHasSavedApprovalSignature
    // can tell a real saved signature apart from an approved row that never actually got signed.
    signature_meta:      (row.signature_meta && typeof row.signature_meta === 'object' ? row.signature_meta : (row.approval_meta && typeof row.approval_meta === 'object' ? row.approval_meta : null)),
    created_at:          text(row.created_at),
    approved_by:         text(row.approved_by),
    approved_at:         text(row.approved_at),
    sent_by:             text(row.sent_by),
    sent_at:             text(row.sent_at),
    locked_at:           text(row.locked_at),
    locked_by:           text(row.locked_by),
    locked_reason:       text(row.locked_reason),
    final_pdf_path:      text(row.final_pdf_path),
    final_pdf_file_name: text(row.final_pdf_file_name),
    final_pdf_created_at: text(row.final_pdf_created_at),
    final_pdf_created_by: text(row.final_pdf_created_by),
    document_snapshot:   (row.document_snapshot && typeof row.document_snapshot === 'object' && !Array.isArray(row.document_snapshot)) ? row.document_snapshot : null,
    document_html_snapshot: text(row.document_html_snapshot),
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
  const status = normalizeProposalStatus(row.status);
  const meta = normalizeSignatureMeta(row.signature_meta || row.approval_meta);
  const hasSavedSignature = Boolean(text(meta?.signature?.image));
  const showSignatureImage = (status === 'approved' || status === 'sent') && (hasSavedSignature || options.showSignatureImage === true);
  const img = text(meta?.signature?.image) || PROPOSAL_SIGNATURE_IMAGE;
  const imageHtml = showSignatureImage
    ? `<img class="pa-signature-image" src="${PUBLIC_BASE}${escapeHtml(img)}" alt="חתימת עידן נחום" loading="eager" decoding="async" onerror="this.style.display='none';">`
    : '';

  return `<div class="pa-footer-signature" aria-label="חתימה">
    <div class="pa-blessing">בברכה,</div>
    <div class="pa-signature-spacer" aria-hidden="true"></div>
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

function proposalHasSavedApprovalSignature(row = {}) {
  // approved_by is an audit field only — a missing value must never block the sent transition.
  // Checks the raw meta directly (mirroring api.js's hasProposalAgreementSignature) instead of
  // normalizeSignatureMeta, which falls back to the default signature image for display purposes
  // and would otherwise report an empty/never-signed signature_meta as a valid saved signature.
  const meta = row.signature_meta || row.approval_meta;
  const hasImage = Boolean(text(meta?.signature?.image || meta?.image));
  return normalizeProposalStatus(row.status) === 'approved'
    && hasImage
    && Boolean(text(row.approved_at));
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
  const display = `₪\u00a0${prefix}${formatted}`;
  return `<span class="pa-currency-amount money-amount" dir="ltr">${escapeHtml(display)}</span>`;
}

function proposalStatusSortPriority(row = {}) {
  const status = normalizeProposalStatus(row?.status || 'draft');
  if (status === 'pending_approval') return 0;
  if (status === 'approved') return 1;
  if (status === 'returned_for_changes') return 2;
  if (status === 'draft') return 3;
  if (status === 'sent') return 4;
  if (status === 'cancelled') return 5;
  return 9;
}

function proposalSortDate(row = {}) {
  return new Date(text(row.updated_at) || text(row.created_at) || text(row.proposal_date) || 0).getTime() || 0;
}

function sortRows(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const priorityDiff = proposalStatusSortPriority(a) - proposalStatusSortPriority(b);
    if (priorityDiff !== 0) return priorityDiff;
    return proposalSortDate(b) - proposalSortDate(a);
  });
}

function rowMatches(row, filters) {
  const q = normalizeSearch(filters.q);
  if (q && !normalizeSearch(row._searchText).includes(q)) return false;
  if (filters.activity_type_group && normalizeProposalGroup(row.activity_type_group) !== normalizeProposalGroup(filters.activity_type_group)) return false;
  if (filters.status && normalizeProposalStatus(row.status) !== filters.status) return false;
  if (filters.proposal_domain && (row.proposal_domain || 'Y') !== filters.proposal_domain) return false;
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
  const displayLabel = normalizedStatus === 'sent' ? `✓ ${label}` : label;
  return `<span class="ds-pa-status-text ds-pa-status-text--${escapeHtml(normalizedStatus || 'unknown')}">${escapeHtml(displayLabel)}</span>`;
}


function canTransitionProposalStatus(row, nextStatus, state) {
  const currentStatus = normalizeProposalStatus(row?.status || 'draft');
  const targetStatus = normalizeProposalStatus(nextStatus);
  const canManage = canManageProposalsAgreements(state);
  const canApprove = canApproveProposalsAgreements(state);
  if (!canManage || !STATUS_OPTIONS.includes(targetStatus)) return false;
  if (currentStatus === 'sent' || currentStatus === 'cancelled') return false;
  if (targetStatus === currentStatus) return true;
  if (targetStatus === 'approved') {
    const needsResign = currentStatus === 'approved' && (!proposalHasSavedApprovalSignature(row) || !text(row?.approved_at));
    return canApprove && (currentStatus === 'pending_approval' || needsResign);
  }
  if (targetStatus === 'returned_for_changes') return canApprove && currentStatus === 'pending_approval';
  if (targetStatus === 'sent') return currentStatus === 'approved' && proposalHasSavedApprovalSignature(row) && Boolean(text(row?.approved_at));
  if (targetStatus === 'cancelled') return canApprove && ['draft', 'pending_approval', 'returned_for_changes'].includes(currentStatus);
  if (targetStatus === 'pending_approval') return ['draft', 'returned_for_changes'].includes(currentStatus);
  if (targetStatus === 'draft') return currentStatus === 'returned_for_changes';
  return false;
}

function isProposalEditable(row, state) {
  return canManageProposalsAgreements(state) && ['draft', 'returned_for_changes'].includes(normalizeProposalStatus(row?.status || 'draft'));
}

function canDeleteProposal(row, state) {
  return canManageProposalsAgreements(state) && ['draft', 'cancelled'].includes(normalizeProposalStatus(row?.status || 'draft'));
}

function canGenerateProposalPdf(row, state) {
  return canManageProposalsAgreements(state) && normalizeProposalStatus(row?.status || 'draft') === 'approved';
}

export function proposalHasFinalPdf(row = {}) {
  return Boolean(text(row.final_pdf_path));
}

export function isProposalSentLocked(row = {}) {
  return normalizeProposalStatus(row?.status) === 'sent';
}

export function isProposalLegacySentWithoutPdf(row = {}) {
  return isProposalSentLocked(row) && !proposalHasFinalPdf(row);
}

function canViewSentProposalPdf(row, state) {
  return canManageProposalsAgreements(state) && isProposalSentLocked(row) && proposalHasFinalPdf(row);
}

function canUploadLegacyProposalPdf(row, state) {
  const status = normalizeProposalStatus(row?.status || 'draft');
  return canManageProposalsAgreements(state) && ['sent', 'approved'].includes(status) && !proposalHasFinalPdf(row);
}

function serializeProposalSnapshotSection(section = {}) {
  return {
    section_key: proposalTextField(section, 'section_key', 'sectionKey'),
    section_title: proposalTextField(section, 'section_title', 'sectionTitle'),
    section_body: normalizeMultilineText(proposalField(section, 'section_body', 'sectionBody'))
  };
}

export function buildProposalDocumentSnapshot(row = {}, items = [], templateSections = []) {
  const activityTypeGroup = normalizeProposalGroup(row.activity_type_group);
  const templateKey = proposalGroupTemplateKey(activityTypeGroup);
  const filteredSections = filterTemplateSectionsForGroup(templateSections, activityTypeGroup);
  const sectionsSource = resolveDocumentSections(row, filteredSections);
  const normalizedRow = {
    id: text(row.id),
    client_authority: text(row.client_authority),
    school_framework: text(row.school_framework),
    document_type: text(row.document_type),
    activity_type_group: activityTypeGroup,
    proposal_domain: normalizeProposalDomain(row.proposal_domain),
    proposal_date: text(row.proposal_date),
    activity_names: normalizeActivityNames(row.activity_names),
    contact_name: text(row.contact_name),
    contact_role: text(row.contact_role),
    phone: text(row.phone),
    email: text(row.email),
    notes: text(row.notes),
    status: normalizeProposalStatus(row.status),
    total_amount: row.total_amount != null ? Number(row.total_amount) || null : null,
    include_catalog: includeCatalogValue(row.include_catalog),
    signature_meta: row.signature_meta && typeof row.signature_meta === 'object' ? row.signature_meta : {},
    approved_by: text(row.approved_by),
    approved_at: text(row.approved_at),
    custom_document_sections: Array.isArray(row.custom_document_sections)
      ? row.custom_document_sections.map(serializeProposalSnapshotSection)
      : []
  };
  const serializedItems = (Array.isArray(items) ? items : []).map((item) => ({
    item_name: text(item.item_name ?? item.itemName),
    item_type: text(item.item_type ?? item.itemType),
    proposal_group: text(item.proposal_group ?? item.proposalGroup),
    quantity: Number(item.quantity) || 1,
    unit_price: item.unit_price != null ? Number(item.unit_price) : null,
    total_price: item.total_price != null ? Number(item.total_price) : null,
    meetings_count: item.meetings_count != null ? Number(item.meetings_count) : null,
    hours_count: item.hours_count != null ? Number(item.hours_count) : null,
    hourly_price: item.hourly_price != null ? Number(item.hourly_price) : null,
    gefen_number: text(item.gefen_number ?? item.gefenNumber),
    description: text(item.description),
    course_note: text(item.course_note ?? item.courseNote),
    activity_no: text(item.activity_no ?? item.activityNo),
    unit_duration: text(item.unit_duration ?? item.unitDuration),
    proposal_display_mode: text(item.proposal_display_mode ?? item.proposalDisplayMode),
    selected_bundle_items: Array.isArray(item.selected_bundle_items) ? item.selected_bundle_items : []
  }));
  return {
    version: 1,
    template_key: templateKey,
    activity_type_group: activityTypeGroup,
    row: normalizedRow,
    items: serializedItems,
    template_sections: sectionsSource.map(serializeProposalSnapshotSection),
    built_at: new Date().toISOString()
  };
}

export function proposalPreviewHtmlFromSnapshot(snapshot = null) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const row = snapshot.row && typeof snapshot.row === 'object' ? snapshot.row : {};
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const sections = Array.isArray(snapshot.template_sections) ? snapshot.template_sections : [];
  return proposalPreviewBodyHtml({ ...row, status: row.status || 'sent' }, items, sections, { showSignatureImage: true });
}

export function proposalLockedPreviewHtml(row = {}) {
  const htmlSnapshot = text(row.document_html_snapshot);
  if (htmlSnapshot) return htmlSnapshot;
  const snapshot = row.document_snapshot && typeof row.document_snapshot === 'object' ? row.document_snapshot : null;
  if (snapshot) return proposalPreviewHtmlFromSnapshot(snapshot);
  return '';
}

function statusSelectHtml(row, enabled, canApprove = false, state = null) {
  const currentStatus = STATUS_OPTIONS.includes(normalizeProposalStatus(row?.status)) ? normalizeProposalStatus(row.status) : 'draft';
  const visibleStatus = statusBadgeHtml(currentStatus);
  if (!enabled || currentStatus === 'sent' || currentStatus === 'cancelled') {
    return visibleStatus;
  }
  const effectiveState = state || { user: { role: canApprove ? 'admin' : 'operation_manager', manage_proposals_agreements: enabled, approve_proposals_agreements: canApprove } };
  const selectableStatuses = currentStatus === 'approved' && !canApprove
    ? STATUS_OPTIONS.filter((status) => status !== currentStatus && canTransitionProposalStatus(row, status, effectiveState))
    : STATUS_OPTIONS.filter((status) => status === currentStatus || canTransitionProposalStatus(row, status, effectiveState));
  if (selectableStatuses.length <= 1 && !(currentStatus === 'approved' && selectableStatuses[0] === 'sent')) return visibleStatus;
  // Status changes are exposed through the compact actions menu; table cells remain plain text only.
  return visibleStatus;
}

function detailRowsHtml(row) {
  return FORM_FIELDS.map((key) => {
    if (['contact_name', 'contact_role', 'phone', 'email', 'document_type', 'proposal_domain'].includes(key)) return '';
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
    return `<tr class="ds-pa-empty-row"><td colspan="8">אין רשומות להצגה</td></tr>`;
  }
  const canManage = canManageProposalsAgreements(state);
  const isAdmin = canApproveProposalsAgreements(state);
  const iconSvg = {
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    clone: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    approve: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    return: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
    cancel: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    print: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    delete: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'
  };
  const rowAction = (attrs, title, icon, danger = false) => `<button type="button" class="ds-pa-more-action${danger ? ' ds-pa-more-action--danger' : ''}" ${attrs}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg><span>${escapeHtml(title)}</span></button>`;
  const quickAction = (attrs, title, icon) => `<button type="button" class="ds-btn ds-btn--xs ds-btn--ghost ds-pa-row-action ds-pa-row-action--icon" ${attrs} title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg></button>`;
  return rows.map((row) => {
    const status = normalizeProposalStatus(row.status || 'draft');
    const isSent = status === 'sent';
    const moreActions = [];
    const showQuickClone = canManage && (status === 'approved' || isSent);
    const showQuickPrint = canGenerateProposalPdf(row, state);
    const showViewSentPdf = canViewSentProposalPdf(row, state);
    const quickActions = [
      isSent
        ? (showViewSentPdf
          ? quickAction(`data-pa-view-final-pdf="${escapeHtml(row.id)}"`, 'צפייה ב־PDF שנשלח', iconSvg.eye)
          : quickAction(`data-pa-preview="${escapeHtml(row.id)}"`, 'צפייה במסמך שנשלח', iconSvg.eye))
        : quickAction(`data-pa-preview="${escapeHtml(row.id)}"`, 'תצוגה מקדימה', iconSvg.eye),
      showQuickPrint ? quickAction(`data-pa-print="${escapeHtml(row.id)}"`, 'PDF', iconSvg.print) : '',
      showQuickClone ? quickAction(`data-pa-clone-row="${escapeHtml(row.id)}"`, 'שכפול להצעה חדשה', iconSvg.clone) : ''
    ].filter(Boolean).join('');
    if (isProposalEditable(row, state)) moreActions.push(rowAction(`data-pa-edit-row="${escapeHtml(row.id)}"`, 'עריכה', iconSvg.edit));
    if (isAdmin && status === 'pending_approval') {
      moreActions.push(rowAction(`data-pa-status-action="approved" data-pa-action-id="${escapeHtml(row.id)}"`, 'חתום ואשר', iconSvg.approve));
      moreActions.push(rowAction(`data-pa-status-action="returned_for_changes" data-pa-action-id="${escapeHtml(row.id)}"`, 'החזרה לתיקון', iconSvg.return));
      moreActions.push(rowAction(`data-pa-status-action="cancelled" data-pa-action-id="${escapeHtml(row.id)}"`, 'ביטול', iconSvg.cancel, true));
    }
    if (isAdmin && status === 'approved' && !proposalHasSavedApprovalSignature(row)) moreActions.push(rowAction(`data-pa-status-action="approved" data-pa-action-id="${escapeHtml(row.id)}"`, 'אשר וחתום מחדש', iconSvg.approve));
    if (canTransitionProposalStatus(row, 'sent', state)) moreActions.push(rowAction(`data-pa-status-action="sent" data-pa-action-id="${escapeHtml(row.id)}"`, 'סימון כנשלח', iconSvg.send));
    if (canDeleteProposal(row, state)) moreActions.push(rowAction(`data-pa-delete-row="${escapeHtml(row.id)}"`, 'מחיקה', iconSvg.delete, true));
    const moreMenu = moreActions.length
      ? `<details class="ds-pa-row-more"><summary aria-label="פעולות נוספות">⋯</summary><div class="ds-pa-row-more-menu">${moreActions.join('')}</div></details>`
      : '';
    return `
    <tr data-pa-row-id="${escapeHtml(row.id)}" tabindex="0">
      <td class="ds-pa-domain-col">${escapeHtml(row.proposal_domain || 'Y')}</td>
      <td>${escapeHtml(row.client_name || row.client_authority || row.school_framework || '—')}</td>
      <td>${inferProposalClientType(row) === 'other' ? '' : escapeHtml(row.school_framework || '—')}</td>
      <td>${escapeHtml(proposalGroupDisplayName(row.activity_type_group) || '—')}</td>
      <td class="ds-pa-col-center">${escapeHtml(formatDateDisplay(row.proposal_date) || '')}</td>
      <td class="ds-pa-col-center">${statusSelectHtml(row, canManage, isAdmin, state)}</td>
      <td class="ds-pa-col-money">${row.total_amount != null ? `₪ ${escapeHtml(formatCurrency(row.total_amount))}` : ''}</td>
      <td class="ds-pa-actions-cell"><div class="ds-pa-actions-inner ds-pa-actions-inner--clean">${quickActions}${moreMenu}</div></td>
    </tr>`;
  }).join('');
}

function tableHtml(rows, state) {
  return dsTableWrap(`
    <table class="ds-table ds-pa-table" data-pa-table>
      <colgroup><col style="width:48px"><col style="width:160px"><col style="width:160px"><col style="width:120px"><col style="width:112px"><col style="width:120px"><col style="width:112px"><col style="width:124px"></colgroup>
      <thead><tr><th class="ds-pa-domain-col">תחום</th><th>רשות</th><th>בית הספר</th><th class="ds-pa-col-center">סוג הצעה</th><th class="ds-pa-col-center">תאריך הצעה</th><th class="ds-pa-col-center">סטטוס</th><th class="ds-pa-col-center">סה״כ</th><th class="ds-pa-actions-col ds-pa-col-center">פעולות</th></tr></thead>
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

function activityPickerHtml(value, activityNameOptions, activityTypeGroup = '') {
  const selectedValues = Array.isArray(value) ? value.map(text).filter(Boolean) : text(value).split(',').map(text).filter(Boolean);
  const hasProposalType = Boolean(normalizeProposalGroup(activityTypeGroup));
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
      <button type="button" class="ds-input ds-input--sm ds-pa-activity-trigger" data-pa-activity-toggle aria-expanded="false"${hasProposalType ? '' : ' disabled aria-disabled="true"'}>${hasProposalType ? 'בחרו פעילויות' : 'יש לבחור קודם סוג הצעה'}</button>
      <p class="ds-muted ds-pa-activity-lock-note" data-pa-activity-lock-note${hasProposalType ? ' hidden' : ''} style="font-size:0.8rem;margin:2px 0">יש לבחור קודם סוג הצעה</p>
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

function filterContactsForClient(contactOptions, { authorityId, schoolId, authorityOnly = false } = {}) {
  if (!authorityId) return [];
  if (!authorityOnly && !schoolId) return [];
  return (Array.isArray(contactOptions) ? contactOptions : []).filter((contact) => {
    if (!text(contact.contact_name) || isCatalogContactRow(contact)) return false;
    if (!catalogIdMatch(contact.authority_id, authorityId)) return false;
    if (authorityOnly) return !contact.school_id;
    return catalogIdMatch(contact.school_id, schoolId);
  });
}

function catalogAuthorityName(row = {}) {
  return text(row.authority_name || row.authority || row.client_name);
}

function catalogSchoolName(row = {}) {
  return text(row.school_name || row.school || row.client_name);
}


function inferProposalClientType(row = {}) {
  if (text(row.school_id)) return 'school';
  if (text(row.authority_id) && !text(row.school_id)) return 'authority';
  if (text(row.client_type) === 'other') return 'other';
  if (text(row.client_name) && !text(row.authority_id) && !text(row.school_id) && !text(row.client_authority)) return 'other';
  if (!text(row.authority_id) && !text(row.school_id) && !text(row.client_authority) && text(row.school_framework)) return 'other';
  return 'school';
}

function selectedRecipientType(form) {
  return text(form?.querySelector('input[name="client_type_selector"]:checked')?.value) || 'school';
}

function hideSchoolSearchPanel(form) {
  if (!form) return;
  const schoolSearchPanel = form.querySelector('[data-pa-school-search-panel]');
  if (schoolSearchPanel) schoolSearchPanel.hidden = true;
  const schoolResults = form.querySelector('[data-pa-school-results]');
  if (schoolResults) { schoolResults.hidden = true; schoolResults.innerHTML = ''; }
  const schoolSearchInput = form.querySelector('[data-pa-school-search-input]');
  if (schoolSearchInput) schoolSearchInput.value = '';
  if (text(form.dataset.paSearchStep) === 'school') form.dataset.paSearchStep = 'authority';
}

function syncOtherRecipientSchoolFieldVisibility(form) {
  if (!form) return;
  const hideSchool = selectedRecipientType(form) === 'other';
  const roSchoolField = form.querySelector('[data-pa-contact-ro-school]')?.closest('label');
  if (roSchoolField) roSchoolField.hidden = hideSchool;
}

function clientTypeSelectorHtml(selected = 'school') {
  const value = ['school', 'authority', 'other'].includes(text(selected)) ? text(selected) : 'school';
  const options = [
    ['school', 'בית ספר'],
    ['authority', 'רשות'],
    ['other', 'אחר']
  ];
  return `<span class="ds-pa-recipient-type-label">למי מיועדת ההצעה?</span>
  <div class="ds-pa-recipient-type" data-pa-recipient-type role="radiogroup" aria-label="למי מיועדת ההצעה?">
    ${options.map(([key, label]) => `<label class="ds-pa-recipient-type-option"><input type="radio" name="client_type_selector" value="${key}"${value === key ? ' checked' : ''}> <span>${escapeHtml(label)}</span></label>`).join('')}
  </div>`;
}

function clientSearchHtml(_contactOptions, row = {}) {
  const existingAuthority = text(row.client_authority);
  const existingSchool = text(row.school_framework);
  const hasSchool = existingSchool && existingSchool !== existingAuthority;
  return `<div class="ds-pa-client-search" data-pa-client-search-wrap>
    <div class="ds-pa-client-search-field-wrap" data-pa-client-search-field-wrap>
      <label class="ds-pa-form-field ds-pa-form-field--client-search" data-pa-client-search-field>
        <span data-pa-client-search-label>רשות</span>
        <input class="ds-input ds-input--sm" type="search" data-pa-client-search-input value="${escapeHtml(existingAuthority)}" placeholder="חיפוש לפי שם רשות, קוד רשות או מחוז" autocomplete="off" aria-autocomplete="list">
      </label>
      <div class="ds-pa-client-results" data-pa-client-results hidden></div>
    </div>
    <div class="ds-pa-school-search-panel" data-pa-school-search-panel hidden>
      <p class="ds-pa-school-step-text">רשות נבחרה: <strong data-pa-step-authority-name-school></strong>
        <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-pa-change-authority-step>שנה רשות</button>
      </p>
      <div class="ds-pa-client-search-field-wrap" data-pa-school-search-field-wrap>
        <label class="ds-pa-form-field ds-pa-form-field--client-search" data-pa-school-search-field>
          <span>בית ספר</span>
          <input class="ds-input ds-input--sm" type="search" data-pa-school-search-input value="${escapeHtml(hasSchool ? existingSchool : '')}" placeholder="חיפוש לפי שם בית ספר או סמל מוסד" autocomplete="off" aria-autocomplete="list">
        </label>
        <div class="ds-pa-client-results" data-pa-school-results hidden></div>
      </div>
    </div>
  </div>`;
}


const CONTACT_OPTIONS_LOAD_ERROR_MESSAGE = 'לא ניתן לטעון אנשי קשר. יש לרענן את הדף או להתחבר מחדש. אם הבעיה נמשכת, יש לבדוק הרשאות Supabase.';

function contactOptionsLoadErrorHtml(contactOptionsError) {
  if (!text(contactOptionsError)) return '';
  return `<div class="ds-pa-inline-alert ds-pa-inline-alert--warning" data-pa-contact-options-error role="alert" style="margin:8px 0;padding:8px 10px;border:1px solid #f59e0b;border-radius:10px;background:#fffbeb;color:#92400e;font-size:0.82rem;line-height:1.45">${escapeHtml(CONTACT_OPTIONS_LOAD_ERROR_MESSAGE)}</div>`;
}

function dedupeContactPickerOptions(contacts = []) {
  const seen = new Set();
  const result = [];
  contacts.forEach((contact) => {
    const contactName = text(contact?.contact_name);
    if (!contactName) return;
    const key = [
      normalizeHebrewQuoteVariants(contactName),
      normalizeHebrewQuoteVariants(text(contact?.contact_role)),
      text(contact?.email).toLowerCase(),
      text(contact?.phone || contact?.mobile || '')
    ].join('||');
    if (seen.has(key)) return;
    seen.add(key);
    result.push(contact);
  });
  return result;
}

function contactPickerHtml(contactOptions, authority, school, selectedContactName, authorityId = null, schoolId = null, authorityOnly = false, schoolMeta = null) {
  const contacts = filterContactsForClient(contactOptions, { authorityId, schoolId, authorityOnly });
  if (!authorityId) return '';
  if (!authorityOnly && !schoolId) return '';
  const resolvedSchoolMeta = schoolMeta || findSchoolCatalogContact(contactOptions, {
    authorityId,
    schoolId,
    authority,
    school
  }) || {};
  const defaultContact = authorityOnly ? null : defaultContactFromSchoolMeta(resolvedSchoolMeta);
  const selectedName = text(selectedContactName);
  const pickerContacts = dedupeContactPickerOptions([
    ...contacts,
    ...(defaultContact ? [defaultContact] : [])
  ]);
  const optionsHtml = ['<option value="">— בחרו איש קשר —</option>',
    ...pickerContacts.map((c) => {
      const val = contactOptionKey(c);
      const contactName = text(c.contact_name);
      const label = c.contact_role ? `${contactName} (${text(c.contact_role)})` : contactName;
      // Do not preselect a contact automatically when a school/authority is chosen.
      const contactPayload = encodeURIComponent(JSON.stringify(c));
      return `<option value="${escapeHtml(val)}" data-pa-contact-option="${escapeHtml(contactPayload)}"${selectedName && (contactName === selectedName || val === selectedName) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }),
    '<option value="__pa_other_contact__">אחר</option>'
  ].join('');
  const noContacts = pickerContacts.length === 0;
  return `
    <div class="ds-pa-form-field ds-pa-contact-select-field">
      <select class="ds-input ds-input--sm" data-pa-contact-select aria-label="איש קשר">${optionsHtml}</select>
    </div>
    <span data-pa-contact-picker-state data-pa-no-contacts="${noContacts ? 'yes' : 'no'}" hidden></span>`;
}

const CONTACT_CHANNELS_HINT_MESSAGE = 'מומלץ להשלים מייל ונייד להמשך טיפול';

function contactChannelsStatusHtml(hasEmail, hasMobile, fieldsOpen = false) {
  const chip = (label, ok) => `<span class="ds-pa-contact-channel-chip${ok ? '' : ' is-missing'}">${escapeHtml(label)}: ${ok ? 'קיים' : 'חסר'}</span>`;
  const missing = !hasEmail || !hasMobile;
  return `<div class="ds-pa-contact-channels-row">
      ${chip('דוא״ל', hasEmail)}
      ${chip('נייד', hasMobile)}
      ${fieldsOpen ? '' : '<button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-pa-contact-channels-toggle>עדכון פרטי קשר</button>'}
    </div>
    ${missing ? `<p class="ds-pa-contact-channels-hint">${escapeHtml(CONTACT_CHANNELS_HINT_MESSAGE)}</p>` : ''}`;
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

const SUMMER_GENERAL_DEFINITION_ORDER = [
  'סדנאות תכלס',
  'סדנאות STEM',
  'חדרי בריחה'
];

function summerGeneralDefinitionIndex(row = {}) {
  const normalizedName = normalizedKindText(publicActivityLabelFromRow(row) || row.activity_name || row.item_name);
  return SUMMER_GENERAL_DEFINITION_ORDER.findIndex((name) => normalizedName === normalizedKindText(name));
}

function isNextYearProposalGroup(value = '') {
  return proposalGroupTemplateKey(value) === 'next_year';
}

const MANUAL_COURSE_OPTION_KEY = '__manual_course__';
const MANUAL_COURSE_OPTION_LABEL = 'קורס אחר / טקסט חופשי';

function isProposalManualCourseItem(item = {}, options = {}) {
  if (!options.allowManualCourse || !isNextYearProposalGroup(options.groupKey || item.proposal_group || item.proposalGroup)) return false;
  if (text(item.pricing_option_key || item.pricingOptionKey) === MANUAL_COURSE_OPTION_KEY) return true;
  return isManualCourseWithoutGefen(item);
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
  return Boolean(proposalTextField(item, 'gefen_number', 'gefenNumber')) && shouldShowGefenForGroup(group);
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
  const gefenNumber = showGefen ? proposalTextField(item, 'gefen_number', 'gefenNumber') : '';
  if (gefenNumber) parts.push(`גפ״ן ${escapeHtml(gefenNumber)}`);

  // Meetings / hours (always show if present)
  const meetings = numVal(item.meetings_count);
  const hours = numVal(item.hours_count);
  if (meetings != null) parts.push(`${meetings} מפגשים`);
  if (hours != null) parts.push(`${hours} שעות`);

  // Hourly price (annual / combined only)
  if (showGefen) {
    const hourlyPrice = numVal(item.hourly_price);
    if (hourlyPrice != null && hourlyPrice > 0) parts.push(`₪ ${formatCurrency(hourlyPrice)} לשעה`);
  }

  // Unit price
  const unitPrice = numVal(item.unit_price);
  if (unitPrice != null && unitPrice > 0) {
    parts.push(showGefen
      ? `מחיר לקבוצה ₪ ${formatCurrency(unitPrice)}`
      : `₪ ${formatCurrency(unitPrice)}`);
  }

  if (!parts.length) return '';
  return `<span class="ds-pa-info-summary">${parts.join(' | ')}</span>`;
}

function isSummerItemRowContext(contextGroup = '') {
  return isSummerProposalGroup(contextGroup);
}

function sortSummerPricingOptions(pricingOptions = []) {
  return [...(Array.isArray(pricingOptions) ? pricingOptions : [])].sort((a, b) => {
    const aGeneralIndex = summerGeneralDefinitionIndex(a);
    const bGeneralIndex = summerGeneralDefinitionIndex(b);
    if (aGeneralIndex !== -1 || bGeneralIndex !== -1) {
      if (aGeneralIndex === -1) return 1;
      if (bGeneralIndex === -1) return -1;
      return aGeneralIndex - bGeneralIndex;
    }
    const sortDiff = numberValue(a.sort_order) - numberValue(b.sort_order);
    if (Number.isFinite(sortDiff) && sortDiff !== 0) return sortDiff;
    return text(publicActivityLabelFromRow(a) || a.activity_name).localeCompare(text(publicActivityLabelFromRow(b) || b.activity_name), 'he');
  });
}

function itemRowHtml(item = {}, idx = 0, pricingOptions = [], options = {}) {
  item = normalizeProposalItemRow(item, options.groupKey || '');
  const n = (v) => (v != null && v !== '' && !isNaN(Number(v))) ? escapeHtml(String(v)) : '';
  const calcTotal = (Number(proposalField(item, 'quantity', 'quantity')) || 0) && (Number(proposalField(item, 'unit_price', 'unitPrice')) || 0)
    ? String(((Number(proposalField(item, 'quantity', 'quantity')) || 0) * (Number(proposalField(item, 'unit_price', 'unitPrice')) || 0)).toFixed(2))
    : n(item.total_price);
  const contextGroup = text(options.groupKey || item.proposal_group || '');
  const isManualCourseRow = isProposalManualCourseItem(item, { allowManualCourse: options.allowManualCourse, groupKey: contextGroup });
  const selectedPricingKey = isManualCourseRow
    ? MANUAL_COURSE_OPTION_KEY
    : text(item.pricing_option_key || item.pricing_activity_no || item.activity_no || item.pricing_activity_name || item.item_name);
  const pricingSelectOptionsHtml = buildPricingSelectOptionsHtml(pricingOptions, selectedPricingKey, {
    allowManualCourse: options.allowManualCourse,
    groupKey: contextGroup
  });
  const isSummerRow = isSummerItemRowContext(contextGroup);
  const gefenValue = proposalTextField(item, 'gefen_number', 'gefenNumber');
  const isNextYearRow = !isSummerRow && isNextYearProposalGroup(contextGroup);
  const hasExistingNote = isNextYearRow && Boolean(text(item.course_note || item.manual_note || ''));
  const meetingsHoursFieldsHtml = isSummerRow
    ? `<input type="hidden" name="meetings_count" value="${n(item.meetings_count)}">
    <input type="hidden" name="hours_count" value="${n(item.hours_count)}">`
    : `<label class="ds-pa-item-field"><span>מפגשים</span><input class="ds-input ds-input--sm" type="number" name="meetings_count" value="${n(item.meetings_count)}" min="0" step="1" placeholder="—"></label>
          <label class="ds-pa-item-field"><span>שעות</span><input class="ds-input ds-input--sm" type="number" name="hours_count" value="${n(item.hours_count)}" min="0" step="0.5" placeholder="—"></label>`;
  const nextYearNoteHtml = isNextYearRow ? `
    <details class="ds-pa-note-details"${hasExistingNote ? ' open' : ''} data-pa-note-details>
      <summary class="ds-pa-note-summary" title="הערה לתוכנית">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        <span class="ds-pa-note-label">הערה לתוכנית</span>${hasExistingNote ? '<span class="ds-pa-note-dot" aria-hidden="true"></span>' : ''}
      </summary>
      <textarea class="ds-input ds-input--sm ds-pa-note-textarea" name="course_note" rows="2" placeholder="הערה לתוכנית">${escapeHtml(item.course_note || item.manual_note || '')}</textarea>
    </details>` : '';
  const manualNameRowHtml = isNextYearRow && options.allowManualCourse
    ? `<div class="ds-pa-item-manual-name" data-pa-manual-name-row${isManualCourseRow ? '' : ' hidden'}>
      <label class="ds-pa-item-field ds-pa-item-field--manual-name"><span>שם הקורס</span><input class="ds-input ds-input--sm"${isManualCourseRow ? ' name="item_name"' : ''} data-pa-manual-item-name value="${escapeHtml(item.item_name || '')}" placeholder="הזינו שם קורס ידני"></label>
    </div>`
    : '';
  return `<article class="ds-pa-item-card ds-pa-item-row${isSummerRow ? ' ds-pa-item-row--summer' : ''}${isManualCourseRow ? ' ds-pa-item-row--manual' : ''}" data-pa-item-row data-pa-item-idx="${idx}" data-pa-row-group="${escapeHtml(contextGroup)}"${isSummerRow ? ' data-pa-summer-row' : ''}${isManualCourseRow ? ' data-pa-manual-course="yes"' : ''}>
    <div class="ds-pa-item-quick-row" style="display:grid;grid-template-columns:minmax(0,1fr) 96px 34px;gap:8px;align-items:end">
      <label class="ds-pa-item-field ds-pa-item-field--select ds-pa-item-field--select-no-label"><select class="ds-input ds-input--sm" name="pricing_activity_name" data-pa-pricing-select>${pricingSelectOptionsHtml}</select></label>
      <label class="ds-pa-item-field ds-pa-item-field--qty"><input class="ds-input ds-input--sm" type="number" name="quantity" value="${n(item.quantity) || '1'}" min="0" step="any" data-pa-item-qty aria-label="כמות"></label>
      <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost ds-pa-item-remove ds-pa-item-remove--quick" data-pa-remove-item aria-label="הסר שורה" title="מחיקת שורה"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
    </div>
    ${manualNameRowHtml}
    ${nextYearNoteHtml}
    <div class="ds-pa-bundle-prompt" data-pa-bundle-prompt hidden></div>
    <details class="ds-pa-item-extra" data-pa-item-details${isManualCourseRow ? ' open' : ''}>
      <summary class="ds-pa-item-extra-toggle">${isManualCourseRow ? 'פרטי קורס' : 'עריכה'}</summary>
      <div class="ds-pa-item-extra-body">
        <div class="ds-pa-item-grid ds-pa-item-grid--extras">
          <label class="ds-pa-item-field ds-pa-item-field--name" data-pa-details-item-name${isManualCourseRow ? ' hidden' : ''}><span>שם פעילות / תוכנית</span><input class="ds-input ds-input--sm"${isManualCourseRow ? '' : ' name="item_name"'} data-pa-details-item-name-input value="${escapeHtml(item.item_name || '')}" placeholder="שם פעילות"></label>
          ${meetingsHoursFieldsHtml}
          <label class="ds-pa-item-field ds-pa-item-field--price"><span>מחיר יחידה</span><input class="ds-input ds-input--sm" type="number" name="unit_price" value="${n(item.unit_price)}" min="0" step="any" data-pa-item-price></label>
          <label class="ds-pa-item-field ds-pa-item-field--total ds-pa-line-total"><span>סה״כ שורה</span><output data-pa-item-total-display>${calcTotal ? `₪ ${formatCurrency(calcTotal)}` : '₪ 0'}</output><input type="hidden" name="total_price" value="${calcTotal}" data-pa-item-total></label>
        </div>
        ${isNextYearRow ? '' : `<label class="ds-pa-item-field ds-pa-item-field--full"><span>הערות או התאמות</span><textarea class="ds-input ds-input--sm" name="description" rows="2" placeholder="תיאור קצר, אם נדרש">${escapeHtml(item.description || '')}</textarea></label>`}
        
      </div>
    </details>
    <input type="hidden" name="item_type" value="${escapeHtml(proposalField(item, 'item_type', 'itemType') || '')}">
    <input type="hidden" name="activity_no" value="${escapeHtml(item.activity_no || item.pricing_activity_no || '')}">
    <input type="hidden" name="pricing_option_key" value="${escapeHtml(item.pricing_option_key || '')}">
    <input type="hidden" name="bundle_pricing_key" value="${escapeHtml(item.bundle_pricing_key || item.pricing_key || item.source_pricing_key || '')}">
    <input type="hidden" name="item_display_mode" value="${escapeHtml(item.proposal_display_mode || 'single')}">
    <input type="hidden" name="item_source_pricing_key" value="${escapeHtml(item.source_pricing_key || item.pricing_key || '')}">
    <input type="hidden" name="list_id" value="${escapeHtml(item.list_id || item.listId || '')}">
    <input type="hidden" name="item_selected_bundle_items" value="${escapeHtml(Array.isArray(item.selected_bundle_items) ? JSON.stringify(item.selected_bundle_items) : (item.selected_bundle_items || '[]'))}">
    <input type="hidden" name="gefen_number" value="${escapeHtml(gefenValue)}">
    <input type="hidden" name="gefen_number_display" value="${escapeHtml(gefenValue)}">
    <input type="hidden" name="unit_duration" value="${escapeHtml(item.unit_duration || '')}">
    <input type="hidden" name="hourly_price" value="${n(item.hourly_price)}">
    <input type="hidden" name="proposal_group" value="${escapeHtml(item.proposal_group || contextGroup || '')}">
  </article>`;
}

function combinedItemsSectionHtml(label, groupKey, items, pricingOptions, idxOffset, editorOptions = {}) {
  const startItems = Array.isArray(items) ? items : [];
  const rowOptions = { groupKey, allowManualCourse: editorOptions.allowManualCourse };
  const rowsHtml = startItems.map((item, i) => itemRowHtml({ ...item, proposal_group: item.proposal_group || groupKey }, idxOffset + i, pricingOptions, rowOptions)).join('');
  return `<div class="ds-pa-items-section ds-pa-items-section--group" data-pa-items-group="${escapeHtml(groupKey)}">
    <div class="ds-pa-items-header">
      <span class="ds-pa-items-section-label">${escapeHtml(label)}</span>
      <button type="button" class="ds-btn ds-btn--xs" data-pa-add-item data-pa-add-item-group="${escapeHtml(groupKey)}">+ הוסף שורה</button>
    </div>
    <div class="ds-pa-items-list" data-pa-items-body data-pa-items-group-body="${escapeHtml(groupKey)}">${rowsHtml}</div>
  </div>`;
}


function parseTourDetails(item = {}) {
  const raw = proposalField(item, 'description', 'description');
  if (raw && typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && (parsed.kind === 'tour_table' || parsed.kind === 'tour_table_v2')) return parsed;
    } catch {}
  }
  return {};
}

const TOUR_COST_COMPONENT_OPTIONS = [
  { component_type: 'class', label: 'כיתה / קבוצה' },
  { component_type: 'guide', label: 'מדריך' },
  { component_type: 'minibus', label: 'הסעה מיניבוס' },
  { component_type: 'bus', label: 'הסעה אוטובוס' }
];
const TOUR_COST_COMPONENT_LABELS = new Map(TOUR_COST_COMPONENT_OPTIONS.map((entry) => [entry.component_type, entry.label]));
const TOUR_COST_COMPONENT_DISPLAY_LABELS = new Map([
  ['class', null],
  ['guide', 'מדריך מלווה'],
  ['minibus', 'הסעה-מיניבוס'],
  ['bus', 'הסעה-אוטובוס']
]);

function normalizeTourCostComponent(component = {}) {
  const componentType = text(component.component_type ?? component.componentType) || 'custom';
  const fallbackLabel = componentType === 'class' ? 'כיתה / קבוצה' : (TOUR_COST_COMPONENT_LABELS.get(componentType) || 'רכיב עלות');
  const label = text(component.label) || fallbackLabel;
  const unitPrice = numberValue(component.unit_price ?? component.unitPrice ?? component.amount ?? component.price) ?? 0;
  const quantity = numberValue(component.quantity) ?? 1;
  const totalPrice = numberValue(component.total_price ?? component.totalPrice) ?? (unitPrice * quantity);
  return { component_type: componentType, label, unit_price: unitPrice, quantity, total_price: totalPrice };
}

function tourCostComponentsFromDetails(details = {}) {
  const existing = Array.isArray(details.cost_components ?? details.costComponents)
    ? (details.cost_components ?? details.costComponents).map(normalizeTourCostComponent)
    : [];
  // Backward compat: convert old class/students structure to a 'class' component
  const isStructuredTourV2 = text(details.kind) === 'tour_table_v2' || details.students_total != null || details.studentsTotal != null;
  if (!isStructuredTourV2 && !existing.some((c) => c.component_type === 'class')) {
    const className = text(details.class_name ?? details.className);
    const students = numberValue(details.students_count ?? details.studentsCount);
    const unitPrice = numberValue(details.price_per_student ?? details.pricePerStudent);
    const oldQuantity = numberValue(details.quantity) ?? 1;
    if (students != null || unitPrice != null || className) {
      const newQuantity = (students != null ? students : 1) * oldQuantity;
      const newUnitPrice = unitPrice ?? 0;
      const newTotal = newQuantity * newUnitPrice;
      existing.unshift(normalizeTourCostComponent({
        component_type: 'class',
        label: className || 'כיתה / קבוצה',
        unit_price: newUnitPrice,
        quantity: newQuantity,
        total_price: newTotal
      }));
    }
  }
  // Backward compat: convert old guide_cost / transport_cost fields
  const guide = numberValue(details.guide_cost ?? details.guideCost);
  const transport = numberValue(details.transport_cost ?? details.transportCost);
  if (guide > 0 && !existing.some((c) => c.component_type === 'guide')) {
    existing.push(normalizeTourCostComponent({ component_type: 'guide', label: 'מדריך', unit_price: guide, quantity: 1 }));
  }
  if (transport > 0 && !existing.some((c) => c.component_type === 'bus')) {
    existing.push(normalizeTourCostComponent({ component_type: 'bus', label: 'הסעה', unit_price: transport, quantity: 1 }));
  }
  return existing.filter((c) => c.unit_price > 0 || c.quantity > 0 || text(c.label));
}

function calculateTourTotal({ costComponents, components, students, studentPrice, quantity, guide, transport } = {}) {
  const componentList = Array.isArray(costComponents) ? costComponents : (Array.isArray(components) ? components : null);
  if (componentList) {
    return componentList.reduce((sum, component) => sum + (normalizeTourCostComponent(component).total_price || 0), 0);
  }
  // Legacy fallback (no cost_components array)
  const studentsNum = Number(students) || 0;
  const priceNum = Number(studentPrice) || 0;
  const quantityNum = Number(quantity) || 1;
  return (studentsNum * priceNum * quantityNum) + (Number(guide) || 0) + (Number(transport) || 0);
}

function tourItemFromDetails(details = {}, fallback = {}) {
  const students = numberValue(details.students_count ?? details.studentsCount);
  const unitPrice = numberValue(details.price_per_student ?? details.pricePerStudent);
  const quantity = numberValue(details.quantity) ?? 1;
  const studentsTotal = numberValue(details.students_total ?? details.studentsTotal)
    ?? ((students != null && unitPrice != null) ? students * unitPrice * quantity : 0);
  const costComponents = tourCostComponentsFromDetails(details);
  const autoTotal = calculateTourTotal({ students, studentPrice: unitPrice, quantity, costComponents });
  const total = numberValue(details.total_price ?? details.totalPrice) ?? autoTotal;
  const payload = {
    kind: 'tour_table_v2',
    class_name: text(details.class_name ?? details.className),
    students_count: students,
    price_per_student: unitPrice,
    quantity,
    students_total: studentsTotal,
    cost_components: costComponents,
    total_price: total
  };
  const tourItemType = text(fallback.item_type || fallback.itemType) || 'סיור';
  return normalizeProposalItemRow({
    ...fallback,
    item_name: TOUR_ACTIVITY_NAME,
    item_type: tourItemType,
    itemType: tourItemType,
    gefen_number: TOUR_GEFEN_NUMBER,
    quantity: quantity || 1,
    unit_price: unitPrice,
    total_price: total,
    description: JSON.stringify(payload),
    course_note: payload.class_name,
    activity_no: text(fallback.activity_no),
    proposal_group: TOUR_TEMPLATE_KEY,
    proposal_display_mode: 'single'
  }, TOUR_TEMPLATE_KEY);
}

function tourDetailsFromItem(item = {}) {
  const parsed = Object.keys(parseTourDetails(item)).length ? parseTourDetails(item) : (item.details || {});
  const students = numberValue(parsed.students_count ?? parsed.studentsCount);
  const unitPrice = numberValue(parsed.price_per_student ?? parsed.pricePerStudent ?? item.unit_price);
  const quantity = numberValue(parsed.quantity ?? item.quantity) ?? 1;
  const costComponents = tourCostComponentsFromDetails(parsed);
  const studentsTotal = numberValue(parsed.students_total ?? parsed.studentsTotal)
    ?? ((students != null && unitPrice != null) ? students * unitPrice * quantity : 0);
  const total = numberValue(parsed.total_price ?? parsed.totalPrice ?? item.total_price)
    ?? calculateTourTotal({ students, studentPrice: unitPrice, quantity, costComponents });
  return {
    class_name: text(parsed.class_name ?? parsed.className ?? item.course_note ?? item.manual_note),
    students_count: students,
    price_per_student: unitPrice,
    quantity,
    students_total: studentsTotal,
    cost_components: costComponents,
    total_price: total
  };
}

function tourCostComponentEditorRowHtml(component = {}, idx = 0) {
  const c = normalizeTourCostComponent(component);
  const val = (v) => v != null && v !== '' && Number.isFinite(Number(v)) ? escapeHtml(String(v)) : '';
  const isClass = c.component_type === 'class';
  const options = TOUR_COST_COMPONENT_OPTIONS.map((option) => `<option value="${escapeHtml(option.component_type)}"${option.component_type === c.component_type ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('');
  const classNameValue = isClass && c.label !== 'כיתה / קבוצה' ? c.label : '';
  return `<div class="ds-pa-tour-component-row" data-pa-tour-component-row>
    <label class="ds-pa-item-field ds-pa-tour-component-type-field"><span>רכיב</span><select class="ds-input ds-input--sm" name="tour_component_type_${idx}" data-pa-tour-component-type>${options}</select></label>
    <input type="hidden" name="tour_component_label_${idx}" value="${escapeHtml(c.label)}" data-pa-tour-component-label>
    <label class="ds-pa-item-field ds-pa-tour-class-name-field" data-pa-tour-class-name-field${isClass ? '' : ' hidden'}>
      <span>שם כיתה / קבוצה</span>
      <input class="ds-input ds-input--sm" type="text" name="tour_component_class_name_${idx}" value="${escapeHtml(classNameValue)}" placeholder="שם הכיתה או הקבוצה" data-pa-tour-component-class-name>
    </label>
    <label class="ds-pa-item-field ds-pa-tour-component-price-field"><span>מחיר יחידה</span><input class="ds-input ds-input--sm" type="number" min="0" step="any" name="tour_component_unit_price_${idx}" value="${val(c.unit_price)}" data-pa-tour-component-price></label>
    <label class="ds-pa-item-field ds-pa-tour-component-quantity-field"><span>כמות</span><input class="ds-input ds-input--sm" type="number" min="0" step="any" name="tour_component_quantity_${idx}" value="${val(c.quantity) || '1'}" data-pa-tour-component-quantity></label>
    <label class="ds-pa-item-field"><span>סה״כ</span><input class="ds-input ds-input--sm" type="number" min="0" step="any" name="tour_component_total_${idx}" value="${val(c.total_price)}" data-pa-tour-component-total readonly aria-readonly="true"></label>
    <div class="ds-pa-tour-component-delete-cell"><button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-pa-remove-tour-component>מחיקה</button></div>
    <span></span>
  </div>`;
}

function tourDetailsEditorHtml(items = []) {
  const source = (Array.isArray(items) ? items : []).find((item) => text(item.item_name) || text(item.description)) || {};
  const d = tourDetailsFromItem(source);
  const val = (v) => v != null && v !== '' && Number.isFinite(Number(v)) ? escapeHtml(String(v)) : '';
  const total = val(d.total_price);
  return `<div class="ds-pa-items-section ds-pa-tour-details" data-pa-tour-details>
    <div class="ds-pa-items-header"><span class="ds-pa-items-section-label">פרטי טבלת הסיור</span></div>
    <p class="ds-muted" style="font-size:0.8rem;margin:0 0 8px">${escapeHtml(TOUR_ACTIVITY_LINE)}</p>
    <div class="ds-pa-tour-summary-row" style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
      <div class="ds-pa-item-field ds-pa-tour-grand-total-field"><span>סה״כ כללי</span><strong class="ds-pa-tour-grand-total-display" data-pa-grand-total>${total ? `₪ ${formatCurrency(total)}` : '₪ 0'}</strong></div>
    </div>
    <input type="hidden" name="tour_total_price" value="${total}" data-pa-tour-total>
    <div class="ds-pa-tour-components" data-pa-tour-components>
      <div class="ds-pa-items-header"><span class="ds-pa-items-section-label">שורות עלות</span><button type="button" class="ds-btn ds-btn--xs" data-pa-add-tour-component>+ הוסף שורה</button></div>
      <div data-pa-tour-components-body>${d.cost_components.map((component, idx) => tourCostComponentEditorRowHtml(component, idx)).join('')}</div>
    </div>
  </div>`;
}

function itemsEditorHtml(items = [], pricingOptions = [], activityTypeGroup = '', editorOptions = {}) {
  const hasProposalType = Boolean(normalizeProposalGroup(activityTypeGroup));
  if (!hasProposalType) {
    return `<div class="ds-pa-items-section ds-pa-items-section--locked" data-pa-items-locked>
      <p class="ds-muted" style="font-size:0.85rem;margin:0">יש לבחור קודם סוג הצעה</p>
      <button type="button" class="ds-btn ds-btn--xs" data-pa-add-item disabled aria-disabled="true">+ הוסף שורה</button>
    </div>`;
  }
  items = (Array.isArray(items) ? items : []).map((item) => normalizeProposalItemRow(item, activityTypeGroup));
  const normalizedGroup = normalizeProposalGroup(activityTypeGroup);
  if (isTourProposalGroup(normalizedGroup)) return tourDetailsEditorHtml(items);
  const footer = `<datalist id="pa-item-type-list">${itemTypeOptions(pricingOptions).map((v) => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
    <div class="ds-pa-items-total-row">סה״כ כללי: <strong data-pa-grand-total></strong></div>`;

  const childGroups = isCombinedProposalGroup(normalizedGroup) ? includedProposalGroups(normalizedGroup) : [];
  if (childGroups.length) {
    let idxOffset = 0;
    const sections = childGroups.map((groupKey) => {
      const groupItems = (Array.isArray(items) ? items : []).filter((item) => itemBelongsToGroup(item, groupKey));
      const groupPricing = filterPricingByProposalType(pricingOptions, groupKey);
      const sectionHtml = combinedItemsSectionHtml(proposalGroupDisplayName(groupKey), groupKey, groupItems, groupPricing, idxOffset, editorOptions);
      idxOffset += groupItems.length || 1;
      return sectionHtml;
    }).join('');
    return `<div class="ds-pa-items-section ds-pa-items-combined">
      ${sections}
      ${footer}
    </div>`;
  }

  const editableItems = (Array.isArray(items) && items.length) ? items : (pricingOptions.length ? [{ proposal_group: normalizedGroup, quantity: 1 }] : []);
  const rowsHtml = editableItems.map((item, idx) => itemRowHtml({ ...item, proposal_group: item.proposal_group || normalizedGroup }, idx, pricingOptions, { groupKey: normalizedGroup, allowManualCourse: editorOptions.allowManualCourse })).join('');
  return `<div class="ds-pa-items-section">
    <div class="ds-pa-items-header">
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
    <span style="display:none" data-pa-summary-count></span>
    <span style="display:none" data-pa-summary-subtotal></span>
    <span style="display:none" data-pa-summary-discount></span>
    <div class="ds-pa-summary-bar ds-pa-summary-bar--compact">
      <div class="ds-pa-summary-pill ds-pa-summary-pill--total">
        <span class="ds-pa-summary-label">סה״כ לתשלום</span>
        <strong class="ds-pa-summary-value ds-pa-summary-total-val" data-pa-summary-total>${initialTotal ? `₪ ${formatCurrency(initialTotal)}` : '₪ 0'}</strong>
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
  if (isTourProposalGroup(formGroup)) {
    const get = (name) => form.querySelector(`[name="${name}"]`)?.value;
    const cost_components = Array.from(form.querySelectorAll('[data-pa-tour-component-row]')).map((row) => {
      const component_type = text(row.querySelector('[data-pa-tour-component-type]')?.value);
      const classNameInput = row.querySelector('[data-pa-tour-component-class-name]');
      const customLabel = component_type === 'class' ? text(classNameInput?.value) : null;
      const label = customLabel || TOUR_COST_COMPONENT_LABELS.get(component_type) || text(row.querySelector('[data-pa-tour-component-label]')?.value);
      const unit_price = numberValue(row.querySelector('[data-pa-tour-component-price]')?.value) ?? 0;
      const quantity = numberValue(row.querySelector('[data-pa-tour-component-quantity]')?.value) ?? 1;
      return normalizeTourCostComponent({ component_type, label, unit_price, quantity });
    }).filter((component) => component.unit_price > 0 || component.total_price > 0);
    const details = {
      class_name: text(get('tour_class_name')),
      students_count: numberValue(get('tour_students_count')),
      price_per_student: numberValue(get('tour_price_per_student')),
      quantity: numberValue(get('tour_quantity')) ?? 1,
      students_total: numberValue(get('tour_students_total')),
      cost_components,
      total_price: numberValue(get('tour_total_price'))
    };
    return [tourItemFromDetails(details, { item_type: 'סיור', itemType: 'סיור' })]
      .map((item) => ({ ...item, item_type: text(item.item_type || item.itemType) || 'סיור', itemType: text(item.item_type || item.itemType) || 'סיור' }))
      .filter(hasMeaningfulProposalItemValue);
  }
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

    const pricingSelectVal = text(row.querySelector('[data-pa-pricing-select]')?.value);
    const rawGroup = fieldText('proposal_group')
      || text(row.dataset.paRowGroup)
      || formGroup;
    const normalizedRowGroup = normalizeProposalGroup(rawGroup);
    const editedName = fieldText('item_name');
    const isManualCourseRow = pricingSelectVal === MANUAL_COURSE_OPTION_KEY
      || text(row.dataset.paManualCourse) === 'yes'
      || (isNextYearProposalGroup(normalizedRowGroup) && isManualCourseWithoutGefen({
        item_name: editedName,
        gefen_number: fieldText('gefen_number'),
        source_pricing_key: fieldText('item_source_pricing_key'),
        pricing_option_key: fieldText('pricing_option_key'),
        activity_no: fieldText('activity_no'),
        list_id: fieldText('list_id')
      }));

    // Resolve the pricing row picked in the select so saved items always carry
    // the catalog item_name / pricing_key / unit_price instead of relying on free text.
    const optionKey = isManualCourseRow ? '' : (fieldText('pricing_option_key') || pricingSelectVal);
    const pricingRow = isManualCourseRow ? null : lookupPricingRow({ optionKey, activityNo: fieldText('activity_no'), itemName: editedName });
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

    const extracted = {
      activity_no:            isManualCourseRow ? '' : (fieldText('activity_no') || text(pricingRow?.activity_no)),
      pricing_activity_no:    isManualCourseRow ? '' : (fieldText('activity_no') || text(pricingRow?.activity_no)),
      pricing_option_key:     isManualCourseRow ? '' : text(optionKey),
      item_name:              itemName,
      item_type:              isManualCourseRow ? '' : (fieldText('item_type') || text(pricingRow?.item_type)),
      gefen_number:           isManualCourseRow ? '' : (fieldText('gefen_number') || text(pricingRow?.gefen_number)),
      meetings_count:         fieldNumber('meetings_count') ?? (isManualCourseRow ? null : numberValue(pricingRow?.meetings_count)),
      hours_count:            hoursCount,
      quantity:               quantity || 1,
      unit_duration:          isManualCourseRow ? '' : (fieldText('unit_duration') || text(pricingRow?.unit_duration)),
      unit_price:             unitPrice,
      hourly_price:           hourlyPrice,
      total_price:            totalPrice,
      description:            fieldText('description') || '',
      course_note:            fieldText('course_note') || '',
      proposal_group:         normalizedRowGroup,
      sort_order:             rowIdx,
      proposal_display_mode:  isManualCourseRow ? 'single' : displayMode,
      source_pricing_key:     isManualCourseRow ? '' : (fieldText('item_source_pricing_key') || text(pricingRow?.pricing_key)),
      list_id:                isManualCourseRow ? '' : (fieldText('list_id') || text(pricingRow?.list_id)),
      selected_bundle_items:  isManualCourseRow ? [] : selectedBundleItems
    };
    return {
      ...extracted,
      activityNo: extracted.activity_no,
      itemName: extracted.item_name,
      itemType: extracted.item_type,
      gefenNumber: extracted.gefen_number,
      meetingsCount: extracted.meetings_count,
      hoursCount: extracted.hours_count,
      unitDuration: extracted.unit_duration,
      unitPrice: extracted.unit_price,
      hourlyPrice: extracted.hourly_price,
      totalPrice: extracted.total_price,
      proposalGroup: extracted.proposal_group,
      sortOrder: extracted.sort_order,
      proposalDisplayMode: extracted.proposal_display_mode,
      sourcePricingKey: extracted.source_pricing_key,
      listId: extracted.list_id,
      selectedBundleItems: extracted.selected_bundle_items
    };
  }).filter((item) => hasMeaningfulProposalItemValue(item) && !isTestHoursItem(item));
}

function normalizeProposalItemRow(item = {}, fallbackGroup = '') {
  let selectedBundleItems = proposalField(item, 'selected_bundle_items', 'selectedBundleItems');
  if (typeof selectedBundleItems === 'string') {
    try { selectedBundleItems = JSON.parse(selectedBundleItems); } catch { selectedBundleItems = []; }
  }
  if (!Array.isArray(selectedBundleItems)) selectedBundleItems = [];
  const proposalGroup = normalizeProposalGroup(proposalField(item, 'proposal_group', 'proposalGroup') || proposalField(item, 'group_key', 'groupKey') || fallbackGroup);
  const normalized = {
    ...item,
    proposal_agreement_id: proposalField(item, 'proposal_agreement_id', 'proposalAgreementId') || '',
    item_name: proposalField(item, 'item_name', 'itemName') || '',
    item_type: proposalField(item, 'item_type', 'itemType') || '',
    gefen_number: proposalField(item, 'gefen_number', 'gefenNumber') || '',
    meetings_count: proposalField(item, 'meetings_count', 'meetingsCount'),
    hours_count: proposalField(item, 'hours_count', 'hoursCount'),
    quantity: proposalField(item, 'quantity', 'quantity'),
    unit_price: proposalField(item, 'unit_price', 'unitPrice'),
    total_price: proposalField(item, 'total_price', 'totalPrice'),
    description: proposalField(item, 'description', 'description') || '',
    course_note: proposalField(item, 'course_note', 'courseNote') || proposalField(item, 'manual_note', 'manualNote') || '',
    manual_note: proposalField(item, 'manual_note', 'manualNote') || proposalField(item, 'course_note', 'courseNote') || '',
    hourly_price: proposalField(item, 'hourly_price', 'hourlyPrice'),
    source_pricing_key: proposalField(item, 'source_pricing_key', 'sourcePricingKey') || '',
    list_id: proposalField(item, 'list_id', 'listId') || '',
    proposal_display_mode: proposalField(item, 'proposal_display_mode', 'proposalDisplayMode') || 'single',
    selected_bundle_items: selectedBundleItems,
    activity_no: proposalField(item, 'activity_no', 'activityNo') || '',
    unit_duration: proposalField(item, 'unit_duration', 'unitDuration') || '',
    proposal_group: proposalGroup,
    group_key: proposalGroup,
    sort_order: proposalField(item, 'sort_order', 'sortOrder') ?? 0
  };
  return {
    ...normalized,
    proposalAgreementId: normalized.proposal_agreement_id,
    itemName: normalized.item_name,
    itemType: normalized.item_type,
    gefenNumber: normalized.gefen_number,
    meetingsCount: normalized.meetings_count,
    hoursCount: normalized.hours_count,
    unitPrice: normalized.unit_price,
    totalPrice: normalized.total_price,
    courseNote: normalized.course_note,
    manualNote: normalized.manual_note,
    hourlyPrice: normalized.hourly_price,
    sourcePricingKey: normalized.source_pricing_key,
    listId: normalized.list_id,
    proposalDisplayMode: normalized.proposal_display_mode,
    selectedBundleItems: normalized.selected_bundle_items,
    activityNo: normalized.activity_no,
    unitDuration: normalized.unit_duration,
    proposalGroup: normalized.proposal_group,
    sortOrder: normalized.sort_order
  };
}

function parseProposalItemsJsonFallback(row = {}) {
  const raw = row.items_json ?? row.itemsJson;
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return (Array.isArray(parsed) ? parsed : []).map((item) => normalizeProposalItemRow(item, row.activity_type_group));
  } catch { return []; }
}

function proposalItemsWithFallback(items = [], row = {}) {
  const normalizedItems = (Array.isArray(items) ? items : []).map((item) => normalizeProposalItemRow(item, row.activity_type_group));
  return normalizedItems.length ? normalizedItems : parseProposalItemsJsonFallback(row);
}

function hasMeaningfulProposalItemValue(item = {}) {
  return Boolean(
    proposalTextField(item, 'item_name', 'itemName') ||
    proposalTextField(item, 'source_pricing_key', 'sourcePricingKey') ||
    proposalTextField(item, 'pricing_key', 'pricingKey') ||
    proposalTextField(item, 'activity_no', 'activityNo') ||
    proposalTextField(item, 'proposal_group', 'proposalGroup') ||
    proposalTextField(item, 'group_key', 'groupKey') ||
    Number(proposalField(item, 'quantity', 'quantity')) ||
    Number(proposalField(item, 'unit_price', 'unitPrice')) ||
    Number(proposalField(item, 'total_price', 'totalPrice'))
  );
}

// ─── Items summary (drawer read-only) ────────────────────────────────────────

function itemsSummaryHtml(items = []) {
  items = (Array.isArray(items) ? items : []).map((item) => normalizeProposalItemRow(item));
  const activeItems = (Array.isArray(items) ? items : []).filter(hasMeaningfulProposalItemValue);
  if (!activeItems.length) {
    return '<p class="ds-pa-no-items-alert" role="alert" style="font-size:0.8rem;margin:4px 0;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:6px 10px">לא נשמרו שורות פעילות להצעה זו</p>';
  }
  const visibleSummaryItems = activeItems.filter((item) => !isTestHoursItem(item));
  const itemFieldHtml = (label, value) => value != null && value !== ''
    ? `<span class="ds-pa-item-summary-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></span>`
    : '';
  const itemPriceHtml = (label, amount) => amount
    ? `<span class="ds-pa-item-summary-field"><span>${escapeHtml(label)}</span><strong>₪ ${escapeHtml(formatCurrency(amount))}</strong></span>`
    : '';
  const cards = visibleSummaryItems.map((item) => {
    const t = Number(proposalField(item, 'total_price', 'totalPrice')) || ((Number(proposalField(item, 'quantity', 'quantity')) || 1) * (Number(proposalField(item, 'unit_price', 'unitPrice')) || 0));
    const manualNote = cleanCustomerText(text(item.course_note || item.manual_note || ''));
    const noteHtml = manualNote ? `<div class="ds-muted" style="font-size:0.72rem;margin-top:2px">${escapeHtml(manualNote)}</div>` : '';
    const meta = [
      itemFieldHtml('כמות', proposalField(item, 'quantity', 'quantity') != null ? proposalField(item, 'quantity', 'quantity') : null),
      itemPriceHtml('מחיר יחידה', proposalField(item, 'unit_price', 'unitPrice') != null ? Number(proposalField(item, 'unit_price', 'unitPrice')) : 0),
      itemPriceHtml('סה״כ', t)
    ].filter(Boolean).join('');
    return `<div class="ds-pa-item-card">
      <div class="ds-pa-item-card-name"><strong>${escapeHtml(publicActivityName(proposalField(item, 'item_name', 'itemName')) || '—')}</strong>${noteHtml}</div>
      ${meta ? `<div class="ds-pa-item-card-meta">${meta}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="ds-pa-items-summary">
    <h4 class="ds-pa-card-title" style="margin-bottom:8px">שורות הצעה</h4>
    <div class="ds-pa-item-cards">${cards}</div>
  </div>`;
}

// ─── Preview document ─────────────────────────────────────────────────────────

function templateBodyText(section) {
  return normalizeMultilineText(proposalField(section, 'section_body', 'sectionBody'));
}

// Document title must come from Supabase data (template_name on proposal_template_sections),
// never from a generic hardcoded fallback.
function focusedProposalTitle(title, templateKey = '') {
  const normalizedTitle = text(title);
  const key = proposalGroupTemplateKey(templateKey || normalizeProposalGroup(templateKey)) || normalizeProposalGroup(templateKey);
  if (key !== 'next_year') return normalizedTitle;
  return normalizedTitle
    .replace('הצעת מחיר לקורסי תעשיידע | שנת הלימודים תשפ״ז', 'הצעת מחיר לתוכניות תעשיידע | תשפ״ז')
    .replace('הצעת מחיר לתוכניות תעשיידע | שנת הלימודים תשפ״ז', 'הצעת מחיר לתוכניות תעשיידע | תשפ״ז');
}

function proposalTitle(row, templateSections = []) {
  const templateKey = proposalGroupTemplateKey(normalizeProposalGroup(row.activity_type_group));
  const fromRow = text(row.proposal_title || row.document_title || row.title);
  if (fromRow) return focusedProposalTitle(fromRow, templateKey);
  const fromTemplate = (Array.isArray(templateSections) ? templateSections : [])
    .map((section) => text(section?.template_name))
    .find(Boolean);
  if (fromTemplate) return focusedProposalTitle(fromTemplate, templateKey);
  const meta = proposalGroupMeta(row.activity_type_group);
  // Last resort is the row's own document_type column (a DB value), never a hardcoded literal.
  return focusedProposalTitle(text(meta?.document_title || meta?.proposal_title || meta?.title) || text(row.document_type) || '', templateKey);
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
  const itemName = publicActivityName(proposalField(item, 'item_name', 'itemName'));
  if (!itemName) return '';

  const bundleItems = Array.isArray(proposalField(item, 'selected_bundle_items', 'selectedBundleItems')) ? proposalField(item, 'selected_bundle_items', 'selectedBundleItems') : [];
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
  return text(item.item_name) === 'הנחה' || Number(proposalField(item, 'total_price', 'totalPrice')) < 0 || Number(proposalField(item, 'unit_price', 'unitPrice')) < 0;
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
  const bundleItems = Array.isArray(proposalField(item, 'selected_bundle_items', 'selectedBundleItems')) ? proposalField(item, 'selected_bundle_items', 'selectedBundleItems') : [];
  const displayMode = text(item.proposal_display_mode);
  const isBundleParent = displayMode === 'bundle_parent' || item.is_bundle_parent;

  if (isBundleParent && bundleItems.length) {
    const parentQuantity = Number(proposalField(item, 'quantity', 'quantity')) || 1;
    const childRows = bundleItems.map((bundleItem) => {
      const name = publicActivityName(typeof bundleItem === 'object' ? bundleItem.activity_name : bundleItem);
      const unitPrice = numberValue(typeof bundleItem === 'object' ? bundleItem.unit_price : null);
      const quantity = parentQuantity;
      const total = unitPrice != null ? quantity * unitPrice : null;
      return costTableRowData(name, quantity, unitPrice, total);
    }).filter(Boolean);
    if (childRows.length) return childRows;
  }

  const name = publicActivityName(proposalField(item, 'item_name', 'itemName'));
  const quantity = Number(proposalField(item, 'quantity', 'quantity')) || 1;
  const unitPrice = numberValue(item.unit_price);
  const total = numberValue(item.total_price) ?? (unitPrice != null ? quantity * unitPrice : null);
  const row = costTableRowData(name, quantity, unitPrice, total);
  return row ? [row] : [];
}


function tourCostTableHtml(items = []) {
  const item = (Array.isArray(items) ? items : []).find((entry) => text(entry.item_name) || text(entry.description) || entry.details) || {};
  const d = tourDetailsFromItem(item);
  const fmt = (value, money = false) => {
    if (value == null || value === '') return '';
    return money ? currencyAmountHtml(value) : escapeHtml(formatCurrency(value));
  };
  const total = numberValue(d.total_price)
    ?? calculateTourTotal({ costComponents: d.cost_components })
    ?? numberValue(item.total_price);
  const getTourDisplayLabel = (c) => {
    if (TOUR_COST_COMPONENT_DISPLAY_LABELS.has(c.component_type)) {
      const fixed = TOUR_COST_COMPONENT_DISPLAY_LABELS.get(c.component_type);
      return fixed ?? (text(c.label) || 'כיתה / קבוצה');
    }
    return text(c.label) || 'רכיב עלות';
  };
  const componentRows = (d.cost_components || []).map((component) => {
    const c = normalizeTourCostComponent(component);
    const displayLabel = getTourDisplayLabel(c);
    return `<tr>
      <td class="pa-tour-col--component">${escapeHtml(displayLabel)}</td>
      <td class="pa-tour-col--quantity">${fmt(c.quantity)}</td>
      <td class="pa-tour-col--price">${fmt(c.unit_price, true)}</td>
      <td class="pa-tour-col--total">${fmt(c.total_price, true)}</td>
    </tr>`;
  }).join('');
  return `<div class="pa-tour-payment-block">
    ${sectionBodyHtml('התשלום עבור הסיור יבוצע בהתאם לטבלה שלהלן:', { alwaysBullet: true })}
    <table class="pa-cost-table pa-activities-table pa-tour-cost-table">
      <colgroup>
        <col class="pa-tour-col--component">
        <col class="pa-tour-col--quantity">
        <col class="pa-tour-col--price">
        <col class="pa-tour-col--total">
      </colgroup>
      <thead><tr>
        <th class="pa-tour-col--component">רכיב</th>
        <th class="pa-tour-col--quantity">כמות</th>
        <th class="pa-tour-col--price">מחיר</th>
        <th class="pa-tour-col--total">סה״כ</th>
      </tr></thead>
      <tbody>${componentRows}</tbody>
      <tfoot><tr><td colspan="3">סה״כ</td><td class="pa-tour-col--total">${fmt(total, true)}</td></tr></tfoot>
    </table>
    ${sectionBodyHtml('חשבונית לתשלום תונפק במעמד ביצוע הסיור. תנאי התשלום: שוטף + 15 ממועד הנפקתה.', { alwaysBullet: true })}
  </div>`;
}

// Customer-facing price breakdown, built only from saved proposal_agreement_items.
// Rows without a real price are never shown. Selected bundle children become billed
// rows; the parent row is omitted when children carry the actual prices.
function proposalCostTableHtml(items = [], options = {}) {
  const allBilledItems = (Array.isArray(items) ? items : []).filter((item) =>
    !isTestHoursItem(item) && text(item.proposal_display_mode) !== 'bundle_child');
  const regularItems = allBilledItems.filter((item) => !isDiscountItem(item));
  const rows = regularItems.flatMap((item) => costTableRowsFromItem(item));
  if (!rows.length) return '';
  const subtotal = rows.reduce((sum, row) => sum + row.total, 0);
  const discount = Math.abs(allBilledItems.filter(isDiscountItem).reduce((sum, item) => {
    const quantity = Number(proposalField(item, 'quantity', 'quantity')) || 1;
    const unitPrice = numberValue(item.unit_price);
    const total = numberValue(item.total_price) ?? (unitPrice != null ? quantity * unitPrice : null);
    return sum + (Number(total) || 0);
  }, 0));
  const grandTotal = Math.max(subtotal - discount, 0);
  const discountFooter = discount > 0
    ? `<tr><td colspan="3">סה״כ לפני הנחה</td><td>${currencyAmountHtml(subtotal)}</td></tr>
       <tr><td colspan="3">הנחה</td><td>${currencyAmountHtml(-discount)}</td></tr>`
    : '';
  const tableClass = `pa-cost-table pa-activities-table${options.isSummer ? ' pa-summer-cost-table' : ''}`;
  const totalHeader = options.isSummer ? 'סה״כ' : 'סה״כ שורה';
  const colgroupHtml = options.isSummer ? '<colgroup><col class="pa-activity-col"><col class="pa-quantity-col"><col class="pa-unit-price-col"><col class="pa-total-col"></colgroup>' : '';
  return `<table class="${tableClass}">
    ${colgroupHtml}
    <thead><tr><th>פעילות</th><th>כמות</th><th>מחיר יחידה</th><th>${totalHeader}</th></tr></thead>
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
  const discount = Math.abs(allItems.filter(isDiscountItem).reduce((sum, item) => sum + (Number(proposalField(item, 'total_price', 'totalPrice')) || Number(proposalField(item, 'unit_price', 'unitPrice')) || 0), 0));
  if (!discount) return '';
  const subtotal = allItems.filter((item) => !isDiscountItem(item)).reduce((sum, item) => {
    const quantity = Number(proposalField(item, 'quantity', 'quantity')) || 1;
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
  return Number(proposalField(item, 'quantity', 'quantity')) || 1;
}

function itemQuantityTotal(item = {}) {
  const quantity = itemQuantity(item);
  const unitPrice = numberValue(item.unit_price);
  const total = numberValue(item.total_price) ?? (unitPrice != null ? quantity * unitPrice : null);
  return total != null && total > 0 ? total : null;
}

function proposalItemDetailsTableHtml(items = [], contextGroup = '') {
  if (!isCourseKindText(groupKindText(contextGroup))) return '';
  const isNextYearTable = isNextYearProposalGroup(contextGroup);
  const tableClass = `pa-item-details-table pa-activities-table${isNextYearTable ? ' pa-next-year-course-table' : ''}`;
  const allVisibleItems = (Array.isArray(items) ? items : []).filter((item) =>
    !isTestHoursItem(item) && text(item.proposal_display_mode) !== 'bundle_child');
  const visibleItems = allVisibleItems.filter((item) => !isDiscountItem(item));
  const discountAmount = Math.abs(allVisibleItems.filter(isDiscountItem).reduce((sum, item) => {
    const quantity = Number(proposalField(item, 'quantity', 'quantity')) || 1;
    const unitPrice = numberValue(item.unit_price);
    const total = numberValue(item.total_price) ?? (unitPrice != null ? quantity * unitPrice : null);
    return sum + (Number(total) || 0);
  }, 0));
  let totalMeetings = 0;
  let hasMeetings = false;
  let totalQuantity = 0;
  let hasQuantity = false;
  let totalHours = 0;
  let hasHours = false;
  let totalPrice = 0;
  let hasTotalPrice = false;
  const rows = visibleItems.map((item) => {
    const hasCourseRowData = Boolean(
      text(item.item_name)
      || proposalTextField(item, 'gefen_number', 'gefenNumber')
      || item.meetings_count != null
      || item.hours_count != null
      || item.hourly_price != null
      || item.unit_price != null
      || item.total_price != null
    );
    if (!hasCourseRowData) return '';
    const quantity = itemQuantity(item);
    const quantityTotal = itemQuantityTotal(item);
    if (item.meetings_count != null) {
      hasMeetings = true;
      totalMeetings += Number(item.meetings_count) || 0;
    }
    if (quantity) {
      hasQuantity = true;
      totalQuantity += quantity;
    }
    if (item.hours_count != null) {
      hasHours = true;
      totalHours += Number(item.hours_count) || 0;
    }
    if (quantityTotal != null) {
      hasTotalPrice = true;
      totalPrice += quantityTotal;
    }
    const courseName = courseShortNameForItem(item);
    const courseNote = isNextYearTable ? cleanCustomerText(text(item.course_note || item.manual_note || '')) : '';
    const courseCellHtml = courseNote
      ? `<div class="pa-course-name">${escapeHtml(courseName)}</div><div class="pa-course-note">${escapeHtml(courseNote)}</div>`
      : escapeHtml(courseName);
    const cells = [
      { value: courseCellHtml, html: true },
      { value: shouldShowGefenForItem(item, contextGroup) ? proposalTextField(item, 'gefen_number', 'gefenNumber') : '' },
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
  const payablePrice = discountAmount > 0 ? Math.max(totalPrice - discountAmount, 0) : null;
  const footerRow = isNextYearTable
    ? (discountAmount > 0
        ? `<tr class="pa-course-total-row"><td colspan="6">סה״כ לפני הנחה</td><td>${hasTotalPrice ? currencyAmountHtml(totalPrice) : ''}</td></tr>
           <tr class="pa-course-total-row"><td colspan="6">הנחה</td><td>${currencyAmountHtml(-discountAmount)}</td></tr>
           <tr class="pa-course-total-row"><td colspan="6">סה״כ לתשלום</td><td>${hasTotalPrice ? currencyAmountHtml(payablePrice) : ''}</td></tr>`
        : `<tr class="pa-course-total-row"><td colspan="6">סה״כ לתשלום</td><td>${hasTotalPrice ? currencyAmountHtml(totalPrice) : ''}</td></tr>`)
    : (() => {
        const totalLabel = discountAmount > 0 ? 'סה״כ לפני הנחה' : 'סה״כ';
        const footerCells = [
          { value: totalLabel },
          { value: '' },
          { value: hasMeetings ? formatCurrency(totalMeetings) : '' },
          { value: hasQuantity ? formatCurrency(totalQuantity) : '' },
          { value: hasHours ? formatCurrency(totalHours) : '' },
          { value: '' },
          { value: hasTotalPrice ? currencyAmountHtml(totalPrice) : '', html: true }
        ];
        const summaryRow = `<tr>${footerCells.map((cell) => `<td>${cell.html ? (cell.value || '') : escapeHtml(cell.value || '')}</td>`).join('')}</tr>`;
        if (discountAmount > 0) {
          return summaryRow
            + `<tr><td>הנחה</td><td></td><td></td><td></td><td></td><td></td><td>${currencyAmountHtml(-discountAmount)}</td></tr>`
            + `<tr><td>סה״כ לתשלום</td><td></td><td></td><td></td><td></td><td></td><td>${hasTotalPrice ? currencyAmountHtml(payablePrice) : ''}</td></tr>`;
        }
        return summaryRow;
      })();
  const nextYearTableStyle = isNextYearTable
    ? ' style="width:85%;margin-inline:auto;table-layout:fixed;"'
    : '';
  const nextYearFirstColStyle = isNextYearTable ? ' style="width:20%"' : '';
  const nextYearOtherColStyle = isNextYearTable ? ' style="width:12%"' : '';
  const nextYearHourlyColStyle = isNextYearTable ? ' style="width:16%"' : '';
  const nextYearTotalColStyle = isNextYearTable ? ' style="width:16%"' : '';
  return `<table class="${tableClass}"${nextYearTableStyle}>
    <colgroup>
      <col class="pa-course-col"${nextYearFirstColStyle}>
      <col class="pa-gefen-col"${nextYearOtherColStyle}>
      <col class="pa-meetings-col"${nextYearOtherColStyle}>
      <col class="pa-groups-col"${nextYearOtherColStyle}>
      <col class="pa-hours-col"${nextYearOtherColStyle}>
      <col class="pa-hourly-price-col"${nextYearHourlyColStyle}>
      <col class="pa-total-price-col"${nextYearTotalColStyle}>
    </colgroup>
    <thead><tr><th>קורס / תוכנית</th><th>מס׳ גפ״ן</th><th>מפגשים</th><th>קבוצות</th><th>שעות</th><th>מחיר לשעה</th><th>סה״כ</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
    <tfoot>${footerRow}</tfoot>
  </table>`;
}

function summerActivityProposalBody() {
  return 'ההצעה כוללת פעילויות מותאמות להפעלה בין התאריכים 1.7.26–30.7.26.\nכל פעילות נמשכת 45 דקות ומיועדת לקבוצה של עד 25 משתתפים.\nבסדנאות כל משתתף מכין תוצר אישי ולוקח אותו איתו בסיום הפעילות.';
}

const SUMMER_COST_TABLE_INTRO = 'פירוט הפעילויות והעלויות:';

function stripTableIntroFromPaymentTermsBody(body, templateKey = '') {
  const key = proposalGroupTemplateKey(templateKey) || normalizeProposalGroup(templateKey);
  if (key !== 'summer' && key !== 'next_year') return body;
  const raw = normalizeMultilineText(body);
  if (!raw) return body;
  const filtered = raw.split('\n').filter((line) => {
    const cleaned = line.replace(/^\s*(?:-|•|·|)\s+/, '').trim();
    if (!cleaned) return true;
    if (/^להלן\s+פירוט\s+העלויות:?$/u.test(cleaned)) return false;
    if (/^להלן\s+פירוט\s+הפעילויות\s+והעלויות:?$/u.test(cleaned)) return false;
    if (/^פירוט\s+הפעילויות\s+והעלויות\s+מוצג/u.test(cleaned)) return false;
    return true;
  });
  return filtered.join('\n').trim();
}

function costsIntroBody(row = {}, items = []) {
  const templateKey = proposalGroupTemplateKey(row.activity_type_group);
  const groupText = groupKindText(row.activity_type_group);
  const visibleCount = (Array.isArray(items) ? items : []).filter((item) =>
    !isTestHoursItem(item) && text(item.proposal_display_mode) !== 'bundle_child' && text(item.item_name)
  ).length;
  if (templateKey === 'next_year' || isNextYearProposalGroup(row.activity_type_group)) {
    return '';
  }
  if (templateKey === 'summer' || isSummerProposalGroup(row.activity_type_group)) {
    return '';
  }
  if (isTourProposalGroup(row.activity_type_group)) {
    return '';
  }
  if (isCourseKindText(groupText)) {
    return visibleCount === 1
      ? 'להלן פירוט הקורס והעלות הכלולה בהצעה.'
      : 'להלן פירוט הקורסים והעלויות הכלולות בהצעה.';
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

function proposalRecipientLines(row = {}) {
  const safeVal = (v) => {
    const s = text(v);
    if (!s || s === 'undefined' || s === 'null') return '';
    if (s.includes('ללא בית ספר') || s.includes('הצעה לרשות')) return '';
    return s;
  };
  const recipientLine = (...values) => {
    const parts = [];
    values.map(safeVal).forEach((value) => {
      if (value && !parts.includes(value)) parts.push(value);
    });
    return parts.join(', ');
  };
  const clientType = ['school', 'authority', 'other'].includes(safeVal(row.client_type))
    ? safeVal(row.client_type)
    : inferProposalClientType(row);
  const schoolName = safeVal(row.school_framework) || safeVal(row.school_name);
  const authorityName = safeVal(row.client_authority) || safeVal(row.authority_name);
  const otherName = safeVal(row.client_name);

  // Authority-only: no real school name → keep existing authority-only display.
  if (clientType === 'authority' && !schoolName) {
    return [authorityName].filter(Boolean);
  }

  // "Other" recipient: prefer school/mframework label, then saved client name.
  if (clientType === 'other') {
    const primary = schoolName || otherName;
    return [primary].filter(Boolean);
  }

  // School proposals and authority proposals that include a school name — show school + authority (deduped).
  return [recipientLine(schoolName, authorityName)].filter(Boolean);
}

function recipientBlockHtml(row = {}) {
  const safeVal = (v) => { const s = text(v); return (!s || s === 'undefined' || s === 'null') ? '' : s; };
  const contactName = safeVal(row.contact_name);
  const contactRole = normalizeContactRoleDisplay(safeVal(row.contact_role));
  const phone = safeVal(row.phone);
  const email = safeVal(row.email);
  const contactParts = [];
  if (contactName) contactParts.push(`<strong>${escapeHtml(contactName)}</strong>`);
  if (contactRole && contactRole !== contactName) contactParts.push(escapeHtml(contactRole));
  const contactLine = contactParts.length ? `<p>${contactParts.join(', ')}</p>` : '';
  const contactDetailParts = [];
  if (phone) contactDetailParts.push(`טלפון: ${escapeHtml(phone)}`);
  if (email) contactDetailParts.push(`דוא״ל: ${escapeHtml(email)}`);
  const contactDetailsLine = contactDetailParts.length ? `<p class="pa-contact-details pa-print-hidden-contact-details">${contactDetailParts.join(' | ')}</p>` : '';
  const orgLines = proposalRecipientLines(row).map((line) => recipientLineHtml(line));
  const lines = [contactLine, contactDetailsLine, ...orgLines].filter(Boolean);
  const recipientLinesHtml = lines.join('\n    ');
  return `<div class="pa-doc-address pa-to-block" style="margin:0 0 6mm 0;">
  <p class="pa-label-to" style="margin:0;"><strong>לכבוד:</strong></p>
  ${recipientLinesHtml ? `<div class="pa-recipient-lines" style="margin-top:0.2em;">${recipientLinesHtml}</div>` : ''}
</div>`;
}

function proposalRecipientFileLabel(row = {}) {
  const safeVal = (v) => { const s = text(v); return (s === 'undefined' || s === 'null') ? '' : s; };
  return safeVal(row.school_framework)
    || safeVal(row.school_name)
    || safeVal(row.client_authority)
    || safeVal(row.authority_name);
}

function sanitizeProposalPdfFileLabel(value = '') {
  return String(value || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function proposalPdfDocumentTitle(row = {}) {
  const label = sanitizeProposalPdfFileLabel(proposalRecipientFileLabel(row));
  return label ? `הצעת מחיר - ${label}` : 'הצעת מחיר';
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


function selectedCourseNamesList(items = [], row = {}, contextGroup = '') {
  const proposalGroup = normalizeProposalGroup(contextGroup || row.activity_type_group);
  if (!isNextYearProposalGroup(proposalGroup) && !isNextYearProposalGroup(row.activity_type_group)) return [];
  const sourceItems = (Array.isArray(items) ? items : []).filter((item) => {
    if (isTestHoursItem(item) || text(item.proposal_display_mode) === 'bundle_child') return false;
    if (!publicActivityName(proposalField(item, 'item_name', 'itemName'))) return false;
    if (isCombinedProposalGroup(row.activity_type_group) && contextGroup) {
      if (!itemBelongsToGroup(item, contextGroup)) return false;
      const itemGroup = normalizeProposalGroup(item.proposal_group || item.activity_type_group);
      const itemKind = itemKindText(item);
      if (isSummerKindText(itemKind) || isWorkshopKindText(itemKind)) return false;
      return isCourseKindText(groupKindText(itemGroup)) || isCourseKindText(itemKind) || itemCatalogKind(item) === 'course';
    }
    return true;
  });
  const seen = new Set();
  const names = [];
  for (const item of sourceItems) {
    const name = publicActivityName(proposalField(item, 'item_name', 'itemName'));
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

const NEXT_YEAR_COURSES_INTRO_RE = /להלן הקורסים המוצעים לשנת הלימודים תשפ[״"']?ז\s*[.:]/u;

function nextYearActivityIntroWithCourseNames(body, row = {}, items = [], contextGroup = '') {
  const group = normalizeProposalGroup(contextGroup || row.activity_type_group);
  if (!isNextYearProposalGroup(group)) return body;
  const courseNames = selectedCourseNamesList(items, row, contextGroup || group);
  const raw = normalizeMultilineText(body);
  if (!raw || !NEXT_YEAR_COURSES_INTRO_RE.test(raw)) return body;
  const replacement = courseNames.length
    ? `להלן הקורסים המוצעים לשנת הלימודים תשפ״ז:\n${courseNames.join('\n')}`
    : 'להלן הקורסים המוצעים לשנת הלימודים תשפ״ז:';
  return raw.replace(NEXT_YEAR_COURSES_INTRO_RE, replacement);
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
    const customKeys = new Set(custom.map((section) => proposalTextField(section, 'section_key', 'sectionKey')));
    if (!customKeys.has('signature')) {
      const templateSignature = fromSupabase.find((section) =>
        proposalTextField(section, 'section_key', 'sectionKey') === 'signature' && text(section.section_body));
      if (templateSignature) source = [...source, templateSignature];
    }
  }
  return source
    .map(normalizeDocumentSection)
    .filter((section) => proposalTextField(section, 'section_key', 'sectionKey') || proposalTextField(section, 'section_title', 'sectionTitle') || text(section.section_body));
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
      <span>${escapeHtml(proposalTextField(section, 'section_title', 'sectionTitle') || proposalTextField(section, 'section_key', 'sectionKey') || `סעיף ${idx + 1}`)}</span>
      <textarea class="ds-input ds-input--sm" rows="4" data-pa-doc-body="${escapeHtml(proposalTextField(section, 'section_key', 'sectionKey'))}">${escapeHtml(String(proposalField(section, 'section_body', 'sectionBody') || ''))}</textarea>
    </label>`).join('');
  return `<div class="ds-pa-doc-editor" data-pa-doc-editor>${indicator}${rows}</div>`;
}

function buildProposalDocumentHtml({ dateDisplay, documentTitle, row, introText, sections, orgResponsibility, schoolResponsibility, paymentTerms, changesCancellation, remarks, signatureHtml, sectionLinesHtml: sectionLines }) {
  const title = text(documentTitle);
  const isNextYear = isNextYearProposalGroup(row?.activity_type_group);
  const isSummerDocument = isSummerProposalGroup(row?.activity_type_group);
  const documentModifierClass = `${isNextYear ? ' pa-document--next-year' : ''}${isSummerDocument ? ' pa-document--summer' : ''}`;
  return `
    <div class="proposal-document pa-document pa-a4-page${documentModifierClass}" data-build="20260704a" dir="rtl" style="position:relative;box-sizing:border-box;">
      <style>
        .pa-org-intro {
          padding-inline: 4mm !important;
          box-sizing: border-box !important;
        }

        .pa-tour-cost-table {
          width: 60%;
          min-width: 0;
          max-width: 60%;
          margin-inline: auto;
          table-layout: fixed;
          border-collapse: collapse;
          direction: rtl;
        }
        .pa-tour-cost-table th,
        .pa-tour-cost-table td {
          box-sizing: border-box;
          text-align: center;
          vertical-align: middle;
          white-space: normal;
          overflow-wrap: anywhere;
        }
        .pa-tour-cost-table .pa-tour-col--component,
        .pa-tour-cost-table th:first-child,
        .pa-tour-cost-table td:first-child {
          text-align: right;
        }
        .pa-tour-cost-table .pa-currency-amount,
        .pa-tour-cost-table .money-amount {
          display: inline-block;
          max-width: 100%;
          white-space: nowrap;
        }
        .pa-tour-col--component { width: 125px; min-width: 125px; max-width: 125px; }
        .pa-tour-col--quantity  { width: 75px;  min-width: 75px;  max-width: 75px;  text-align: center; }
        .pa-tour-col--price     { width: 85px;  min-width: 85px;  max-width: 85px;  text-align: center; }
        .pa-tour-col--total     { width: 85px;  min-width: 85px;  max-width: 85px;  text-align: center; }
        @media print {
          .pa-org-intro {
            padding-inline: 4mm !important;
            box-sizing: border-box !important;
          }
          .pa-tour-cost-table {
            width: 60% !important;
            min-width: 0 !important;
            max-width: 60% !important;
            margin-inline: auto !important;
            table-layout: fixed !important;
          }
          .pa-tour-cost-table th,
          .pa-tour-cost-table td {
            padding: 2mm 1.5mm !important;
            font-size: 8.5pt !important;
            line-height: 1.25 !important;
            white-space: normal !important;
            overflow: hidden !important;
            text-overflow: clip !important;
          }
          .pa-tour-cost-table .pa-currency-amount,
          .pa-tour-cost-table .money-amount {
            white-space: nowrap !important;
          }
        }
      </style>
      <img
        src="${PUBLIC_BASE}proposals/proposal-header-logo.png"
        alt=""
        class="pa-print-fixed-logo"
        aria-hidden="true"
        onerror="this.style.display='none';"
      >
      <div class="proposal-document-header pa-page-header"${isSummerDocument ? ' style="margin-bottom:1mm;"' : ''}>
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
      <div class="pa-proposal-body-footer-shell">
      <div class="proposal-document-body">
        <div class="proposal-document-content">
          ${title ? `<h1 class="pa-doc-subject pa-doc-title">${escapeHtml(title)}</h1>` : ''}
          ${introText ? sectionLines(introText, { className: 'pa-doc-intro pa-intro-text pa-org-intro' }) : ''}
          ${sections.join('')}
          ${orgResponsibility}
          ${schoolResponsibility}
          ${paymentTerms}
          ${changesCancellation}
          ${remarks}
          ${signatureHtml}
        </div>
      </div>
      <div class="pa-page-footer-area">
        <div class="pa-page-footer-gap" aria-hidden="true"></div>
        <div class="pa-page-footer">
          <span>תעשיידע — תעשייה למען חינוך מתקדם (ע״ר) | <span dir="ltr">www.think.org.il</span></span>
        </div>
      </div>
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

function proposalLegacySentNoticeHtml() {
  return `<div class="ds-pa-legacy-sent-notice" data-pa-legacy-sent-notice role="status">
    <p>הצעה זו נשלחה לפני מנגנון שמירת PDF סופי. ניתן להעלות PDF ידנית כדי לנעול צפייה עתידית.</p>
  </div>`;
}

function proposalLegacyPdfUploadHtml(rowId) {
  return `<div class="ds-pa-legacy-pdf-upload" data-pa-legacy-pdf-upload>
    <label class="ds-pa-form-field ds-pa-form-field--wide">
      <span>העלאת PDF סופי להצעה ישנה</span>
      <input class="ds-input ds-input--sm" type="file" accept="application/pdf,.pdf" data-pa-legacy-pdf-input>
    </label>
    <button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-pa-legacy-pdf-upload-btn data-pa-legacy-pdf-id="${escapeHtml(rowId)}">שמור PDF סופי</button>
    <p class="ds-pa-form-error" data-pa-legacy-pdf-error role="alert"></p>
  </div>`;
}

export function proposalPreviewBodyHtml(row, items = [], templateSections = [], renderOptions = {}) {
  const activityTypeGroup = normalizeProposalGroup(row.activity_type_group);
  const templateKey = proposalGroupTemplateKey(activityTypeGroup);
  // Date comes only from the proposal row — no "today" fallback in customer documents.
  const dateDisplay = formatDateDisplay(row.proposal_date);
  const sourceTemplateSections = filterTemplateSectionsForGroup(templateSections, templateKey);
  const sectionsSource = resolveDocumentSections(row, sourceTemplateSections);
  const byKey = new Map(sectionsSource.map((section) => [proposalTextField(section, 'section_key', 'sectionKey'), section]));
  const sectionBody = (key) => applyProposalTemplatePlaceholders(applyFocusedProposalTextUpdates(templateBodyText(byKey.get(key)), templateKey), row, items);
  const sectionTitle = (key) => text(byKey.get(key)?.section_title);

  const includeCatalog = false;
  const introText = isTourProposalGroup(activityTypeGroup) ? TOUR_INTRO_BODY : sectionBody('intro');
  const remarks = sectionBody('notes');
  const templateActivityIntro = filterCatalogContentFromBody(sectionBody('activity_intro'), false);
  const activityIntro = isTourProposalGroup(activityTypeGroup)
    ? TOUR_ACTIVITY_INTRO_BODY
    : isSummerProposalGroup(activityTypeGroup)
      ? summerActivityProposalBody()
      : isNextYearProposalGroup(activityTypeGroup)
        ? nextYearActivityIntroWithCourseNames(templateActivityIntro, row, items)
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
      const introBody = isNextYearProposalGroup(groupKey)
        ? nextYearActivityIntroWithCourseNames(body, row, items, groupKey)
        : body;
      const heading = sectionTitle(key) || proposalGroupDisplayName(groupKey);
      const section = renderActivitySection(heading, introBody);
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
    const { className = '', ...bodyOptions } = options;
    return sectionHtml(sectionTitle(key) || '', body, className, bodyOptions);
  };

  // Payment section: general terms text comes from Supabase, while the price
  // breakdown is always built dynamically from proposal_agreement_items.
  const paymentTermsBody = isTourProposalGroup(activityTypeGroup) ? '' : stripTableIntroFromPaymentTermsBody(sectionBody('payment_terms'), templateKey);
  const proposalKind = proposalActivityKind(row, items);
  const costTableHtml = isTourProposalGroup(activityTypeGroup)
    ? tourCostTableHtml(items)
    : proposalKind === 'course'
      ? proposalItemDetailsTableHtml(items, activityTypeGroup)
      : proposalCostTableHtml(items, { isSummer: isSummerProposalGroup(activityTypeGroup) });
  const costsIntro = costsIntroBody(row, items);
  const costTableBlock = costTableHtml
    ? `<div class="pa-cost-table-block">${costsIntro ? `<p class="pa-costs-intro-heading">${escapeHtml(costsIntro)}</p>` : ''}${costTableHtml}</div>`
    : '';
  const paymentTerms = (paymentTermsBody || costTableBlock)
    ? `<section class="pa-section pa-cost-section">${sectionTitle('payment_terms') ? `<h3 class="pa-section-heading">${escapeHtml(sectionHeadingText(sectionTitle('payment_terms')))}</h3>` : ''}${paymentTermsBody ? sectionBodyHtml(paymentTermsBody, { alwaysBullet: true }) : ''}${costTableBlock}</section>`
    : '';

  const signatureHtml = signatureSectionHtml(sectionBody('signature'), row, renderOptions);
  const cancellationClass = isNextYearProposalGroup(activityTypeGroup)
    ? 'pa-next-year-cancellation-terms'
    : isSummerProposalGroup(activityTypeGroup)
      ? 'pa-summer-cancellation-terms'
      : '';

  return buildProposalDocumentHtml({
    dateDisplay,
    documentTitle: proposalTitle(row, sourceTemplateSections),
    row,
    introText,
    sections,
    orgResponsibility: renderSectionFromSupabase('taasiyeda_responsibility', { alwaysBullet: true, className: 'pa-responsibility-org' }),
    schoolResponsibility: renderSectionFromSupabase('school_responsibility', { alwaysBullet: true, className: 'pa-responsibility-school' }),
    paymentTerms,
    changesCancellation: isTourProposalGroup(activityTypeGroup)
      ? sectionHtml(sectionTitle('cancellation_terms') || 'שינויים, ביטולים והתאמות', TOUR_CANCELLATION_TERMS_BODY, 'pa-cancellations-section', { alwaysBullet: true })
      : renderSectionFromSupabase('cancellation_terms', { alwaysBullet: true, className: [cancellationClass, 'pa-cancellations-section'].filter(Boolean).join(' ') }),
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
  if (isSummerProposalGroup(normalizedGroup)) {
    return itemBelongsToGroup(row, normalizedGroup) || isSummerKindText(itemKindText(row));
  }
  if (isCombinedProposalGroup(normalizedGroup)) {
    const children = includedProposalGroups(normalizedGroup);
    if (!children.length) return true;
    return children.some((groupKey) => itemBelongsToGroup(row, groupKey));
  }
  if (itemBelongsToGroup(row, normalizedGroup)) return true;
  const rowGroup = text(row.proposal_group || row.activity_type_group);
  const rowGroupNormalized = normalizeProposalGroup(rowGroup);
  return rowGroupNormalized === normalizedGroup
    || rowGroup === activityTypeGroup
    || normalizeHebrewQuoteVariants(rowGroup) === normalizeHebrewQuoteVariants(activityTypeGroup);
}

function filterPricingByProposalType(pricingOptions, activityTypeGroup) {
  const filtered = (Array.isArray(pricingOptions) ? pricingOptions : []).filter((row) => pricingMatchesGroup(row, activityTypeGroup));
  return isSummerProposalGroup(activityTypeGroup) ? sortSummerPricingOptions(filtered) : filtered;
}

function filterPricingByActivityType(pricing, activityType) {
  if (!activityType) return pricing;
  return pricing.filter((row) => text(row.item_type) === activityType);
}

function buildPricingSelectOptionsHtml(pricingOptions, selectedPricingKey, options = {}) {
  const visibleRows = pricingOptions.filter((row) =>
    !isTestHoursItem(row) &&
    text(row.proposal_display_mode) !== 'bundle_child' &&
    !/^תמיר/i.test(text(row.activity_name))
  );
  const manualOptionHtml = options.allowManualCourse && isNextYearProposalGroup(options.groupKey)
    ? `<option value="${MANUAL_COURSE_OPTION_KEY}"${selectedPricingKey === MANUAL_COURSE_OPTION_KEY ? ' selected' : ''}>${escapeHtml(MANUAL_COURSE_OPTION_LABEL)}</option>`
    : '';
  return ['<option value="">— בחר פעילות מהרשימה —</option>', manualOptionHtml, ...visibleRows.map((row, optionIdx) => {
    const value = pricingOptionKey(row, optionIdx);
    const legacySelected = selectedPricingKey && [value, text(row.activity_no), text(row.activity_name), publicActivityName(row.activity_name)].includes(selectedPricingKey);
    const isBundleParent = row.proposal_display_mode === 'bundle_parent' || row.is_bundle_parent;
    const name = publicActivityLabelFromRow(row) || value;
    const price = numberValue(row.unit_price);
    const labelParts = [
      name,
      isBundleParent ? 'הגדרה כוללת' : text(row.item_type),
      price != null && price > 0 ? `₪ ${formatCurrency(price)}` : ''
    ].filter(Boolean);
    return `<option value="${escapeHtml(value)}"${legacySelected ? ' selected' : ''}${isBundleParent ? ' data-bundle-parent="1"' : ''}>${escapeHtml(labelParts.join(' — '))}</option>`;
  })].filter(Boolean).join('');
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

function findSchoolCatalogContact(contactOptions = [], { authorityId = null, schoolId = null, authority = '', school = '' } = {}) {
  const options = Array.isArray(contactOptions) ? contactOptions : [];
  const byId = options.find((contact) => contact._catalog_source === 'schools'
    && catalogIdMatch(contact.school_id, schoolId)
    && (!authorityId || catalogIdMatch(contact.authority_id, authorityId)));
  if (byId) return byId;
  const schoolName = catalogSchoolName({ school, school_name: school });
  const authorityName = catalogAuthorityName({ authority, authority_name: authority });
  return options.find((contact) => contact._catalog_source === 'schools'
    && catalogSchoolName(contact) === schoolName
    && (!authorityName || catalogAuthorityName(contact) === authorityName)) || null;
}


function defaultContactFromSchoolMeta(schoolMeta = {}) {
  const principalName = text(schoolMeta.principal_name || schoolMeta.contact_name);
  if (!principalName) return null;
  return {
    ...schoolMeta,
    id: '',
    contact_name: principalName,
    contact_role: 'מנהל/ת בית הספר',
    phone: text(schoolMeta.phone) || text(schoolMeta.school_phone || schoolMeta.mobile || ''),
    mobile: text(schoolMeta.mobile),
    email: text(schoolMeta.email)
  };
}

function schoolDetailsLines(contact = {}) {
  return [
    catalogSchoolName(contact) ? ['בית ספר', catalogSchoolName(contact)] : null,
    catalogAuthorityName(contact) ? ['רשות', catalogAuthorityName(contact)] : null,
    text(contact.semel_mosad) ? ['סמל מוסד', text(contact.semel_mosad)] : null,
    text(contact.principal_name || contact.contact_name) ? ['מנהל/ת', text(contact.principal_name || contact.contact_name)] : null,
    text(contact.school_phone || contact.phone || contact.mobile) ? ['טלפון', text(contact.school_phone || contact.phone || contact.mobile)] : null,
    text(contact.school_address || contact.address || contact.institution_address) ? ['כתובת', text(contact.school_address || contact.address || contact.institution_address)] : null,
    text(contact.city) ? ['עיר', text(contact.city)] : null
  ].filter(Boolean);
}

function schoolDetailsPanelHtml(contact = {}) {
  const lines = schoolDetailsLines(contact);
  if (!lines.length) return '';
  return `<div class="ds-pa-school-details" data-pa-school-details>
    ${lines.map(([label, value]) => `<span class="ds-pa-client-locked-detail"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</span>`).join('')}
  </div>`;
}

function enrichProposalRowFromContactOptions(row = {}, contactOptions = []) {
  if (!row || typeof row !== 'object') return row;
  const authorityName = text(row.client_authority);
  const schoolName = text(row.school_framework);
  const schoolContact = findSchoolCatalogContact(contactOptions, {
    authorityId: row.authority_id,
    schoolId: row.school_id,
    authority: authorityName,
    school: schoolName
  });
  if (!schoolContact) return row;
  return {
    ...row,
    client_type: text(row.client_type) || 'school',
    authority_id: row.authority_id ?? schoolContact.authority_id ?? null,
    school_id: row.school_id ?? schoolContact.school_id ?? null,
    semel_mosad: text(row.semel_mosad) || text(schoolContact.semel_mosad),
    principal_name: text(row.principal_name) || text(schoolContact.principal_name || schoolContact.contact_name),
    school_phone: text(row.school_phone) || text(schoolContact.school_phone || schoolContact.phone || schoolContact.mobile),
    school_address: text(row.school_address) || text(schoolContact.school_address || schoolContact.address || schoolContact.institution_address),
    city: text(row.city) || text(schoolContact.city)
  };
}

function clientLockedBannerHtml(auth, school, contactName, contactRole, phone, email, clientName = '', schoolMeta = null) {
  if (!auth && !clientName) return '';
  const displayName = clientName || school || auth;
  const city = text(schoolMeta?.city);
  const secondaryParts = [
    auth && auth !== displayName ? auth : '',
    city && city !== auth && city !== displayName ? city : ''
  ].filter(Boolean);
  return `<div class="ds-pa-client-locked">
    <div class="ds-pa-client-locked-body">
      <p class="ds-pa-client-locked-name">נבחר: ${escapeHtml(displayName)}</p>
      ${secondaryParts.length ? `<p class="ds-pa-client-locked-state">${escapeHtml(secondaryParts.join(' / '))}</p>` : ''}
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
  // Name must match; email/phone/authority+school provide additional confirmation.
  // Never match solely by email or phone when names differ — prevents wrong-contact substitution.
  return Boolean(nameMatch && (emailMatch || phoneMatch || (authorityMatch && schoolMatch)));
}

function findContactForProposalRow(contactOptions = [], row = {}) {
  return (Array.isArray(contactOptions) ? contactOptions : []).find((contact) => contactMatchesProposalRow(contact, row)) || null;
}

function buildContactSourceFromRow(row = {}) {
  const inferredClientType = inferProposalClientType(row);
  if (inferredClientType === 'other') {
    return {
      id: null, authority_id: row.authority_id || null, school_id: null, semel_mosad: null, school_required: 'no',
      client_type: 'other', client_name: text(row.client_name || row.school_framework), authority: text(row.client_authority), school: '',
      contact_name: text(row.contact_name), contact_role: text(row.contact_role), phone: text(row.phone), email: text(row.email), mobile: ''
    };
  }
  if (!row.authority_id) return null;
  const school = text(row.school_framework) !== text(row.client_authority) ? text(row.school_framework) : '';
  return {
    id:           text(row.contact_school_id) || null,
    authority_id: row.authority_id,
    school_id:    row.school_id || null,
    semel_mosad:  text(row.semel_mosad),
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

function emptyContactSourceForRecipientType(nextClientType, otherName = '') {
  const type = ['school', 'authority', 'other'].includes(text(nextClientType)) ? text(nextClientType) : 'school';
  if (type === 'other') {
    return {
      id: null, authority_id: null, school_id: null, semel_mosad: null,
      school_required: 'no', client_type: 'other',
      client_name: otherName, authority: '', school: '',
      contact_name: '', contact_role: '', phone: '', mobile: '', email: '', source_table: ''
    };
  }
  if (type === 'authority') {
    return {
      id: null, authority_id: null, school_id: null, semel_mosad: null,
      school_required: 'no', client_type: 'authority',
      client_name: '', authority: '', school: '',
      contact_name: '', contact_role: '', phone: '', mobile: '', email: '', source_table: ''
    };
  }
  return {
    id: null, authority_id: null, school_id: null, semel_mosad: null,
    school_required: 'yes', client_type: 'school',
    client_name: '', authority: '', school: '',
    contact_name: '', contact_role: '', phone: '', mobile: '', email: '', source_table: ''
  };
}

function setContactSourceFields(form, contact = {}) {
  const host = form?.querySelector('[data-pa-contact-source]');
  if (host) host.innerHTML = contactSourceInputsHtml(contact || {});
}

function resetRecipientDependentFields(form, nextClientType) {
  if (!form) return;
  const type = ['school', 'authority', 'other'].includes(text(nextClientType)) ? text(nextClientType) : 'school';
  const otherName = type === 'other' ? text(form.querySelector('[name="other_client_name"]')?.value) : '';

  ['client_authority', 'school_framework', 'contact_name', 'contact_role', 'phone', 'email'].forEach((name) => {
    const inp = form.querySelector(`input[name="${name}"]`);
    if (inp) inp.value = '';
  });
  if (type !== 'other') {
    const otherInput = form.querySelector('[name="other_client_name"]');
    if (otherInput) otherInput.value = '';
  }

  const selectionModeInput = form.querySelector('input[name="contact_selection_mode"]');
  if (selectionModeInput) selectionModeInput.value = type === 'other' ? 'other' : '';

  const card = form.querySelector('[data-pa-client-card]');
  if (card) { card.hidden = true; card.innerHTML = ''; }

  const pickerHost = form.querySelector('[data-pa-contact-picker-host]');
  if (pickerHost) pickerHost.innerHTML = '';

  const roAuth = form.querySelector('[data-pa-contact-ro-authority]');
  const roSchool = form.querySelector('[data-pa-contact-ro-school]');
  if (roAuth) roAuth.value = '';
  if (roSchool) roSchool.value = '';
  const roCtx = form.querySelector('[data-pa-contact-ro-ctx]');
  if (roCtx) roCtx.hidden = true;

  form.querySelectorAll('[data-pa-contact-manual-fields]').forEach((el) => { el.hidden = type !== 'other'; });
  const channelsFields = form.querySelector('[data-pa-contact-channels-fields]');
  if (channelsFields) channelsFields.hidden = type !== 'other';
  const channelsStatus = form.querySelector('[data-pa-contact-channels-status]');
  if (channelsStatus) { channelsStatus.hidden = true; channelsStatus.innerHTML = ''; }

  const addContactRow = form.querySelector('[data-pa-add-contact-row]');
  if (addContactRow) addContactRow.hidden = true;
  const noContactNote = form.querySelector('[data-pa-no-contact-note]');
  if (noContactNote) noContactNote.hidden = true;

  form.dataset.paSearchStep = 'authority';
  delete form.dataset.paAuthorityId;
  delete form.dataset.paAuthorityName;
  delete form.dataset.paNewClient;

  const searchFieldWrap = form.querySelector('[data-pa-client-search-field-wrap]');
  const schoolSearchPanel = form.querySelector('[data-pa-school-search-panel]');
  const results = form.querySelector('[data-pa-client-results]');
  const schoolResults = form.querySelector('[data-pa-school-results]');
  if (searchFieldWrap) searchFieldWrap.hidden = false;
  hideSchoolSearchPanel(form);
  if (results) { results.hidden = true; results.innerHTML = ''; }
  if (schoolResults) { schoolResults.hidden = true; schoolResults.innerHTML = ''; }
  const searchInput = form.querySelector('[data-pa-client-search-input]');
  const schoolSearchInput = form.querySelector('[data-pa-school-search-input]');
  if (searchInput) searchInput.value = '';
  if (schoolSearchInput) schoolSearchInput.value = '';

  const otherField = form.querySelector('[data-pa-other-client-field]');
  if (otherField) otherField.hidden = type !== 'other';

  const contactPanel = form.querySelector('[data-pa-step-panel="contact"]');
  if (contactPanel) contactPanel.hidden = type !== 'other';

  const clientFields = form.querySelector('[data-pa-client-fields]');
  if (clientFields) clientFields.hidden = true;

  const searchRow = form.querySelector('[data-pa-client-search-row]');
  if (searchRow) searchRow.hidden = false;

  setContactSourceFields(form, emptyContactSourceForRecipientType(type));
}

function stepComplete(form) {
  if (!form) return { client: false, proposal: false, activity: false, summary: false };
  const selectedType = text(form.querySelector('input[name="client_type_selector"]:checked')?.value) || 'school';
  const clientType = text(form.querySelector('input[name="contact_source_client_type"]')?.value) || selectedType;
  const authorityId = text(form.querySelector('input[name="contact_source_authority_id"]')?.value);
  const schoolId = text(form.querySelector('input[name="contact_source_school_id"]')?.value);
  const otherName = text(form.querySelector('[name="other_client_name"]')?.value);
  const schoolFramework = text(form.querySelector('[name="school_framework"]')?.value);

  let clientDone = false;
  if (clientType === 'other') {
    clientDone = Boolean(authorityId && otherName);
  } else if (clientType === 'authority') {
    clientDone = Boolean(authorityId);
  } else {
    clientDone = Boolean(authorityId && schoolId);
  }

  const proposalDone = Boolean(text(form.querySelector('[name="activity_type_group"]')?.value));
  const items = proposalDone ? extractItemsFromForm(form) : [];
  const activityDone = proposalDone && items.some((item) => text(item.item_name) && (Number(proposalField(item, 'total_price', 'totalPrice')) > 0 || ((Number(proposalField(item, 'quantity', 'quantity')) || 0) * (Number(proposalField(item, 'unit_price', 'unitPrice')) || 0)) > 0));
  return { client: clientDone, proposal: proposalDone, activity: activityDone, summary: activityDone };
}

function contactSourceInputsHtml(contact = {}) {
  const source = contact || {};
  return `
    <input type="hidden" name="contact_source_id" value="${escapeHtml(text(source.id))}">
    <input type="hidden" name="contact_source_authority_id" value="${escapeHtml(text(source.authority_id))}">
    <input type="hidden" name="contact_source_school_id" value="${escapeHtml(text(source.school_id))}">
    <input type="hidden" name="contact_source_semel_mosad" value="${escapeHtml(text(source.semel_mosad))}">
    <input type="hidden" name="contact_source_school_required" value="${escapeHtml(text(source.school_required))}">
    <input type="hidden" name="contact_source_client_type" value="${escapeHtml(text(source.client_type))}">
    <input type="hidden" name="contact_source_client_name" value="${escapeHtml(text(source.client_name))}">
    <input type="hidden" name="contact_source_authority" value="${escapeHtml(text(source.authority))}">
    <input type="hidden" name="contact_source_school" value="${escapeHtml(text(source.school))}">
    <input type="hidden" name="contact_source_name" value="${escapeHtml(text(source.contact_name))}">
    <input type="hidden" name="contact_source_role" value="${escapeHtml(text(source.contact_role))}">
    <input type="hidden" name="contact_source_phone" value="${escapeHtml(text(source.phone || source.mobile || ''))}">
    <input type="hidden" name="contact_source_mobile" value="${escapeHtml(text(source.mobile))}">
    <input type="hidden" name="contact_source_email" value="${escapeHtml(text(source.email))}">
    <input type="hidden" name="contact_source_table" value="${escapeHtml(text(source.source_table))}">`;
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

export function proposalTypeCardsHtml(selected) {
  const normalizedSelected = normalizeProposalGroup(selected);
  const options = proposalGroupLookups.groups.filter(o => o.group_key !== 'combined');
  if (!options.length) {
    return `<div class="ds-pa-type-chips" data-pa-type-cards style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin:0"></div><input type="hidden" name="activity_type_group" value="${escapeHtml(normalizedSelected)}" data-pa-type-hidden>`;
  }
  return `<div class="ds-pa-type-chips" data-pa-type-cards style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin:0">
    ${options.map((opt) => {
      const isSel = normalizedSelected === opt.group_key;
      return `<button type="button" class="ds-pa-type-card${isSel ? ' is-selected' : ''}" data-pa-type-btn="${escapeHtml(opt.group_key)}" style="width:100%;min-height:auto;padding:4px 6px;border-radius:12px;border:1.5px solid ${isSel ? '#6366f1' : '#d1d5db'};background:${isSel ? '#eef2ff' : '#f9fafb'};color:${isSel ? '#4f46e5' : '#374151'};font-weight:${isSel ? '600' : '400'};font-size:0.8rem;cursor:pointer;text-align:center;line-height:1.2;transition:all .15s">${escapeHtml(opt.group_key === 'summer' ? 'קיץ' : opt.group_key === 'next_year' ? 'תשפ״ז' : opt.display_name)}</button>`;
    }).join('')}
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

function formHtml(mode, row = {}, activityNameOptions = [], contactOptions = [], items = [], pricingOptions = [], state = null, contactOptionsError = '') {
  const title = mode === 'edit' ? 'עריכת הצעת מחיר' : 'יצירת הצעת מחיר';
  row = enrichProposalRowFromContactOptions(row, contactOptions);
  const normalizedActivityGroup = normalizeProposalGroup(row.activity_type_group);
  const filteredPricing = filterPricingByProposalType(pricingOptions, normalizedActivityGroup);
  const currentStatus = STATUS_OPTIONS.includes(normalizeProposalStatus(row.status)) ? normalizeProposalStatus(row.status) : 'draft';
  const initAuth = text(row.client_authority);
  const initSchool = text(row.school_framework);
  const initContact = text(row.contact_name);
  const initRole = text(row.contact_role);
  const initPhone = text(row.phone);
  const initEmail = text(row.email);
  // Prefer building from the saved row data — the chosen contact is source of truth.
  // Only fall back to directory lookup when the row has no authority_id (very old rows).
  const initContactSource = buildContactSourceFromRow(row) || findContactForProposalRow(contactOptions, row);
  const isLocked = !!initAuth;
  const initClientType = text(initContactSource?.client_type) || text(row.client_type) || inferProposalClientType(row);
  const initAuthorityOnly = initClientType === 'authority';
  const initOther = initClientType === 'other';
  const initSchoolId = text(initContactSource?.school_id) || text(row.school_id);
  const initAuthorityId = text(initContactSource?.authority_id) || text(row.authority_id) || null;
  const initSchoolMeta = findSchoolCatalogContact(contactOptions, {
    authorityId: initAuthorityId,
    schoolId: initSchoolId,
    authority: initAuth,
    school: initSchool
  }) || row;
  const contactPanelVisible = initOther || (isLocked && (initAuthorityOnly ? Boolean(initAuthorityId) : Boolean(initSchoolId)));
  const channelsStatusVisible = contactPanelVisible && Boolean(initContact);
  const initPickerHtml = contactPanelVisible && !initOther ? contactPickerHtml(
    contactOptions,
    initAuth,
    initSchool,
    initContact,
    initAuthorityId,
    initAuthorityOnly ? null : (initSchoolId || null),
    initAuthorityOnly,
    initSchoolMeta
  ) : '';
  const initClientName = text(initContactSource?.client_name) || initSchool || initAuth;
  const proposalDate = mode === 'add' ? (text(row.proposal_date) || localDateInputValue()) : text(row.proposal_date);
  const hasCustomSections = Array.isArray(row.custom_document_sections) && row.custom_document_sections.length > 0;
  const rowNormalizedStatus = normalizeProposalStatus(text(row.status));
  const rowIsAlreadyApproved = rowNormalizedStatus === 'approved' || rowNormalizedStatus === 'sent' || proposalHasSavedApprovalSignature(row);
  const canApproveDirectly = canApproveProposalsAgreements(state) && !rowIsAlreadyApproved;
  const primaryActionLabel = canApproveDirectly ? 'חתום ואשר' : 'שליחה לאישור';
  const primaryActionStatus = canApproveDirectly ? 'approved' : 'pending_approval';
  const allowManualCourse = userRole(state) === 'admin';

  const initialPreviewRow = normalizeProposalAgreementRow({
    ...row,
    document_type: text(row.document_type) || 'הצעת מחיר',
    activity_type_group: normalizedActivityGroup,
    proposal_date: proposalDate
  });
  const initialTemplateKey = proposalGroupTemplateKey(normalizedActivityGroup);
  const initialTemplateSections = resolveDocumentSections(row, [])
    .filter((section) => !proposalTextField(section, 'template_key', 'templateKey') || proposalTextField(section, 'template_key', 'templateKey') === initialTemplateKey);
  const initialPreviewHtml = proposalPreviewBodyHtml(initialPreviewRow, items, initialTemplateSections);

  return `<form class="ds-pa-form ds-pa-form--compact pa-editor" data-pa-form data-pa-mode="${escapeHtml(mode)}" data-pa-id="${escapeHtml(row.id || '')}" data-pa-original-type="${escapeHtml(normalizedActivityGroup)}" data-pa-allow-manual-course="${allowManualCourse ? 'yes' : 'no'}" dir="rtl">
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
          ${clientTypeSelectorHtml(initClientType)}
          ${contactOptionsLoadErrorHtml(contactOptionsError)}
          ${clientSearchHtml(contactOptions, row)}
          <div class="ds-pa-other-client-section" data-pa-other-client-field${initOther ? '' : ' hidden'}><h5>פרטי הלקוח</h5><label class="ds-pa-form-field ds-pa-other-client-field"><span>שם הלקוח / חברה</span><input class="ds-input ds-input--sm" name="other_client_name" value="${escapeHtml(initOther ? (row.client_name || initSchool) : '')}" placeholder="שם הלקוח"></label></div>
        </div>
        <div data-pa-client-card${isLocked ? '' : ' hidden'}>${isLocked ? clientLockedBannerHtml(initAuth, initSchool, initContact, initRole, initPhone, initEmail, initClientName, initSchoolMeta) : ''}</div>
        <div class="ds-pa-client-hidden-values" data-pa-client-fields hidden>
          ${hiddenField('client_authority', row.client_authority)}
          ${hiddenField('school_framework', initOther ? '' : row.school_framework)}
        </div>
      </div>
      <div data-pa-step-panel="contact"${contactPanelVisible ? '' : ' hidden'}>
        <h4 class="pa-sidebar-section-title">איש קשר</h4>
        <div class="ds-pa-form-grid">
          <div data-pa-contact-picker-host>${initPickerHtml}</div>
          <div class="ds-pa-form-grid ds-pa-contact-manual-fields" data-pa-contact-manual-fields hidden>
            <div data-pa-contact-ro-ctx hidden>
              <label class="ds-pa-form-field"><span>רשות</span><input type="text" class="ds-input ds-input--sm" data-pa-contact-ro-authority readonly tabindex="-1"></label>
              <label class="ds-pa-form-field"><span>בית ספר</span><input type="text" class="ds-input ds-input--sm" data-pa-contact-ro-school readonly tabindex="-1"></label>
            </div>
            <input type="hidden" name="contact_selection_mode" value="">
            ${textField('contact_name', 'שם', row.contact_name, false)}
            ${textField('contact_role', FIELD_LABELS.contact_role, normalizeContactRoleDisplay(row.contact_role), false)}
            </div>
          <div class="ds-pa-contact-channels" data-pa-contact-channels-wrap>
            <div class="ds-pa-contact-channels-status" data-pa-contact-channels-status${channelsStatusVisible ? '' : ' hidden'}>${channelsStatusVisible ? contactChannelsStatusHtml(Boolean(initEmail), Boolean(initPhone), initOther) : ''}</div>
            <div class="ds-pa-form-grid ds-pa-contact-channels-fields" data-pa-contact-channels-fields${initOther ? '' : ' hidden'}>
              ${textField('phone', FIELD_LABELS.phone, row.phone, false)}
              ${textField('email', FIELD_LABELS.email, row.email, false)}
            </div>
          </div>
          <div data-pa-add-contact-row hidden>
            <p class="ds-pa-add-contact-note" data-pa-no-contact-note hidden>לא נבחר איש קשר</p>
            <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-pa-add-contact-toggle>הוסף איש קשר ידנית</button>
          </div>
        </div>
      </div>
    </div>

    <div class="ds-pa-form-type-panel" data-pa-step-panel="proposal" style="padding-top:4px">
      <div class="ds-pa-type-meta-grid">
        <div class="ds-pa-form-field">
          ${proposalTypeCardsHtml(normalizedActivityGroup)}
        </div>
        <div class="ds-pa-type-meta-aux ds-pa-two-col-grid">
          <label class="ds-pa-form-field"><span>${escapeHtml(FIELD_LABELS.proposal_date)}</span><input class="ds-input ds-input--sm" type="date" name="proposal_date" value="${escapeHtml(proposalDate)}"></label><label class="ds-pa-form-field"><span>${escapeHtml(FIELD_LABELS.proposal_domain)}: Y / E</span><select class="ds-input ds-input--sm" name="proposal_domain">${optionHtml('Y', row.proposal_domain || 'Y', 'Y')}${optionHtml('E', row.proposal_domain || 'Y', 'E')}</select></label>
          <input type="hidden" name="document_type" value="${escapeHtml(text(row.document_type) || 'הצעת מחיר')}">
        </div>
      </div>
      <div class="ds-pa-type-row">${templateIndicatorHtml(normalizedActivityGroup)}</div>
      <p class="ds-pa-template-mode ${hasCustomSections ? 'ds-pa-template-mode--custom' : ''}" data-pa-template-mode${hasCustomSections ? '' : ' hidden'}>${hasCustomSections ? 'נוסח מותאם אישית' : ''}</p>
    </div>

    <div class="ds-pa-form-activities-panel" data-pa-step-panel="activity">
      <h4 class="pa-sidebar-section-title">פעילויות ומחירים</h4>
      <div data-pa-items-host>${itemsEditorHtml(items, filteredPricing, normalizedActivityGroup, { allowManualCourse })}</div>
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
  const isAdminRole = canApproveProposalsAgreements(state);
  const canManage = canManageProposalsAgreements(state);
  const buttons = [];

  const iconBtn = (attrs, title, svgInner, extraClass = '') =>
    `<button type="button" class="ds-btn ds-btn--xs ds-btn--ghost ds-pa-row-action ds-pa-row-action--icon${extraClass ? ' ' + extraClass : ''}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" ${attrs}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svgInner}</svg></button>`;

  const EYE   = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  const PENCIL = '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>';
  const DOC   = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>';
  const SEND  = '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>';
  const XCIRC = '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>';
  const TRASH = '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>';
  const CHECK = '<polyline points="20 6 9 17 4 12"/>';
  const UNDO  = '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>';
  const SENT  = '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>';
  const PRINT = '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>';
  const CLONE = '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>';

  buttons.push(iconBtn(`data-pa-preview="${escapeHtml(row.id)}"`, isProposalSentLocked(row) ? 'צפייה במסמך שנשלח' : 'תצוגה מקדימה', EYE));

  if (isProposalEditable(row, state)) {
    buttons.push(iconBtn(`data-pa-edit-row="${escapeHtml(row.id)}"`, 'עריכה', PENCIL));
  }
  if (canManage && ['draft', 'returned_for_changes'].includes(normalizeProposalStatus(status))) {
    buttons.push(iconBtn(`data-pa-edit-document="${escapeHtml(row.id)}"`, 'עריכת מסמך', DOC));
  }
  if (canManage && ['draft', 'returned_for_changes'].includes(normalizeProposalStatus(status))) {
    buttons.push(iconBtn(`data-pa-status-action="pending_approval" data-pa-action-id="${escapeHtml(row.id)}"`, 'שליחה לאישור', SEND));
  }
  if (isAdminRole) {
    if (normalizeProposalStatus(status) === 'pending_approval') {
      buttons.push(iconBtn(`data-pa-status-action="cancelled" data-pa-action-id="${escapeHtml(row.id)}"`, 'ביטול', XCIRC));
    }
  }
  if (canDeleteProposal(row, state)) {
    buttons.push(iconBtn(`data-pa-delete-row="${escapeHtml(row.id)}"`, 'מחיקה', TRASH, 'ds-pa-row-action--danger'));
  }
  if (isAdminRole && normalizeProposalStatus(status) === 'pending_approval') {
    buttons.push(iconBtn(`data-pa-status-action="approved" data-pa-action-id="${escapeHtml(row.id)}"`, 'חתום ואשר', CHECK));
    buttons.push(iconBtn(`data-pa-status-action="returned_for_changes" data-pa-action-id="${escapeHtml(row.id)}"`, 'החזרה לתיקון', UNDO));
  }
  if (isAdminRole && normalizeProposalStatus(status) === 'approved' && !proposalHasSavedApprovalSignature(row)) {
    buttons.push(iconBtn(`data-pa-status-action="approved" data-pa-action-id="${escapeHtml(row.id)}"`, 'אשר וחתום מחדש', CHECK));
  }
  if (canTransitionProposalStatus(row, 'sent', state)) {
    buttons.push(iconBtn(`data-pa-status-action="sent" data-pa-action-id="${escapeHtml(row.id)}"`, 'סימון כנשלח', SENT));
  }
  if (canViewSentProposalPdf(row, state)) {
    buttons.push(iconBtn(`data-pa-view-final-pdf="${escapeHtml(row.id)}"`, 'צפייה ב־PDF שנשלח', EYE));
  }
  if (canGenerateProposalPdf(row, state)) {
    buttons.push(iconBtn(`data-pa-print="${escapeHtml(row.id)}"`, 'הדפסה / שמירה כ-PDF', PRINT));
    buttons.push(iconBtn(`data-pa-clone-row="${escapeHtml(row.id)}"`, 'שכפול להצעה חדשה', CLONE));
  } else if (isProposalSentLocked(row) && canManageProposalsAgreements(state)) {
    buttons.push(iconBtn(`data-pa-clone-row="${escapeHtml(row.id)}"`, 'שכפול להצעה חדשה', CLONE));
  }
  return buttons.join('');
}

function drawerHtml(row, activityNameOptions = [], state = null) {
  if (!row) return `<aside class="ds-pa-drawer" data-pa-drawer hidden></aside>`;

  const hasCustomSections = Array.isArray(row.custom_document_sections) && row.custom_document_sections.length > 0;
  const customBadge = hasCustomSections
    ? `<span class="ds-pa-state-note" title="המסמך הזה כולל עריכה מותאמת אישית">מסמך מותאם</span>`
    : '';
  const drawerRowStatus = normalizeProposalStatus(text(row.status));
  const drawerHasSig = proposalHasSavedApprovalSignature(row);
  const drawerNeedsResign = drawerRowStatus === 'approved' && !drawerHasSig;
  const signatureWarning = drawerNeedsResign
    ? `<span class="ds-pa-state-note ds-pa-state-note--warn">ההצעה מאושרת אך חסרה חתימה/זמן אישור ולכן לא ניתן לסמן כנשלחה</span>`
    : '';

  const drawerClientType = inferProposalClientType(row);
  const schoolName = drawerClientType === 'other'
    ? (text(row.school_framework) || text(row.client_name) || '—')
    : (text(row.school_framework) || text(row.client_name) || '—');
  const authorityName = text(row.client_authority) || '—';
  const proposalDate = formatDateDisplay(row.proposal_date) || '—';
  const proposalDomain = normalizeProposalDomain(row.proposal_domain) || '—';
  const statusText = drawerRowStatus === 'sent'
    ? `✓ ${STATUS_LABELS.sent}`
    : (STATUS_LABELS[drawerRowStatus] || STATUS_LABELS[row.status] || text(row.status) || '—');

  const infoCell = (label, value, wide = false, options = {}) => {
    const display = text(value) || (options.emptyText || '');
    if (!display && !options.showEmpty) return '';
    return `<div class="ds-pa-info-cell${wide ? ' ds-pa-info-cell--wide' : ''}"><span class="ds-pa-info-label">${escapeHtml(label)}</span><span class="ds-pa-info-value">${escapeHtml(display || 'לא הוזן')}</span></div>`;
  };
  const metaSep = '<span class="ds-pa-drawer-meta-sep" aria-hidden="true">|</span>';
  const drawerMetaLine = [
    `<span class="ds-pa-drawer-meta-item">${escapeHtml(authorityName)}</span>`,
    `<span class="ds-pa-drawer-meta-item">${escapeHtml(proposalDate)}</span>`,
    `<span class="ds-pa-drawer-meta-item">${escapeHtml(proposalDomain)}</span>`,
    `<span class="ds-pa-drawer-meta-item ds-pa-drawer-meta-item--status"><span class="ds-pa-drawer-status-text">${escapeHtml(statusText)}</span></span>`
  ].join(metaSep);

  const hasSendingInfo = Boolean(text(row.sent_by) || text(row.sent_at));
  const legacySentNotice = isProposalLegacySentWithoutPdf(row) ? proposalLegacySentNoticeHtml() : '';
  const legacyPdfUpload = canUploadLegacyProposalPdf(row, state) ? proposalLegacyPdfUploadHtml(row.id) : '';
  const sendingCard = hasSendingInfo || legacySentNotice || legacyPdfUpload
    ? `<div class="ds-pa-info-card ds-pa-info-card--sending ds-pa-info-card--flat">
    ${legacySentNotice}
    <div class="ds-pa-info-grid">
      ${infoCell('נשלח על ידי', text(row.sent_by), false, { showEmpty: true })}
      ${infoCell('תאריך שליחה', text(row.sent_at) ? formatDateDisplay(row.sent_at) : '', false, { showEmpty: true })}
      ${infoCell('נעול בתאריך', text(row.locked_at) ? formatDateDisplay(row.locked_at) : '', false, { showEmpty: true })}
    </div>
    ${legacyPdfUpload}
  </div>`
    : '';

  const sourceId = text(row.contact_school_id || row.contact_source_id);
  const contactCanUpdate = Boolean(sourceId);
  const contactCard = `<form class="ds-pa-info-card ds-pa-contact-update-card" data-pa-drawer-contact-form data-pa-contact-source-id="${escapeHtml(sourceId)}" data-pa-contact-source-table="contacts_schools">
    <div class="ds-pa-info-grid ds-pa-contact-view-grid">
      ${infoCell('איש קשר', text(row.contact_name), false, { showEmpty: true })}
      ${infoCell('תפקיד', text(row.contact_role), false, { showEmpty: true })}
      ${infoCell('מייל', text(row.email), false, { showEmpty: true })}
      ${infoCell('טלפון', text(row.phone), false, { showEmpty: true })}
    </div>
    ${contactCanUpdate ? `<details class="ds-pa-contact-edit-details"><summary>עדכון פרטי איש קשר</summary>
      <div class="ds-pa-contact-edit-grid">
        <label class="ds-pa-form-field"><span>שם איש קשר</span><input class="ds-input ds-input--sm" name="contact_name" value="${escapeHtml(text(row.contact_name))}"></label>
        <label class="ds-pa-form-field"><span>תפקיד</span><input class="ds-input ds-input--sm" name="contact_role" value="${escapeHtml(text(row.contact_role))}"></label>
        <label class="ds-pa-form-field"><span>מייל</span><input class="ds-input ds-input--sm" name="email" value="${escapeHtml(text(row.email))}"></label>
        <label class="ds-pa-form-field"><span>טלפון</span><input class="ds-input ds-input--sm" name="phone" value="${escapeHtml(text(row.phone))}"></label>
      </div>
      <button type="submit" class="ds-btn ds-btn--sm ds-btn--primary">שמור פרטי קשר</button>
      <p class="ds-pa-contact-update-msg" data-pa-contact-update-msg></p>
    </details>` : `<p class="ds-muted" style="font-size:.78rem;margin:8px 0 0">לא נמצא מזהה איש קשר קיים לעדכון.</p>`}
  </form>`;

  const itemsHost = `<div class="ds-pa-drawer-items-host" data-pa-drawer-items><span class="ds-muted" style="font-size:0.8rem">טוען שורות הצעה...</span></div>`;

  const financialCard = `<div class="ds-pa-info-card ds-pa-info-card--financial-summary">
    <h4 class="ds-pa-card-title">סה״כ לתשלום</h4>
    <div class="ds-pa-total-amount">${row.total_amount != null ? `₪ ${escapeHtml(formatCurrency(row.total_amount))}` : 'לא הוזן'}</div>
  </div>`;

  const notesFields = [
    infoCell('הערת אישור', text(row.approval_note), true),
    infoCell('הערות', text(row.notes), true)
  ].filter(Boolean).join('');
  const notesCard = notesFields
    ? `<div class="ds-pa-info-card"><div class="ds-pa-info-grid">${notesFields}</div></div>`
    : '';

  return `<aside class="ds-pa-drawer" data-pa-drawer data-pa-drawer-id="${escapeHtml(row.id)}" aria-live="polite" dir="rtl">
    <div class="ds-pa-drawer-panel">
      <header class="ds-pa-drawer-head ds-pa-drawer-head--hero">
        <div class="ds-pa-drawer-head-info">
          <h3 class="ds-pa-drawer-name ds-pa-drawer-name--hero">${escapeHtml(schoolName)}</h3>
          <p class="ds-pa-drawer-meta-line">${drawerMetaLine}</p>
        </div>
        <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-pa-close-drawer aria-label="סגירת פרטי רשומה" style="flex-shrink:0;font-size:1rem;padding:2px 8px">✕</button>
      </header>
      <div class="ds-pa-drawer-action-bar">
        <span class="ds-pa-drawer-badges">${signatureWarning ? signatureWarning : ''}${customBadge ? '&ensp;' + customBadge : ''}</span>
        <span class="ds-pa-drawer-icon-btns">${drawerActionButtons(row, state)}</span>
      </div>
      <div class="ds-pa-drawer-body">
        ${sendingCard}
        ${contactCard}
        ${itemsHost}
        ${notesCard}
        ${financialCard}
      </div>
      <p class="ds-pa-form-error" data-pa-drawer-error role="alert" style="color:#dc2626;font-size:0.8rem;padding:4px 16px 0"></p>
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

function allDisplayRows(data) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  return dedupeById(sortRows(rows));
}

function displayRows(data, filters = {}) {
  return allDisplayRows(data).filter((row) => rowMatches(row, filters));
}

function currentFilters(root) {
  return {
    q:                   root.querySelector('[data-pa-search]')?.value || '',
    activity_type_group: root.querySelector('[data-pa-filter="activity_type_group"]')?.value || '',
    status:              root.querySelector('[data-pa-filter="status"]')?.value || '',
    proposal_domain:     root.querySelector('[data-pa-filter="proposal_domain"]')?.value || ''
  };
}

function activeFilters(filters = {}) {
  return [
    text(filters.q) ? { key: 'q', label: 'חיפוש', value: text(filters.q) } : null,
    text(filters.activity_type_group) ? { key: 'activity_type_group', label: 'סוג הצעה', value: proposalGroupDisplayName(filters.activity_type_group) } : null,
    text(filters.status) ? { key: 'status', label: 'סטטוס', value: STATUS_LABELS[normalizeProposalStatus(filters.status)] || filters.status } : null,
    text(filters.proposal_domain) ? { key: 'proposal_domain', label: 'תחום', value: filters.proposal_domain } : null
  ].filter(Boolean);
}

function activeFiltersHtml(filters = {}) {
  const chips = activeFilters(filters);
  if (!chips.length) {
    return '<div class="ds-pa-active-filters" data-pa-active-filters hidden></div>';
  }
  const chipsHtml = chips.map((chip) => `<span class="ds-pa-active-filter-chip" data-pa-active-filter="${escapeHtml(chip.key)}"><strong>${escapeHtml(chip.label)}:</strong> ${escapeHtml(chip.value)}</span>`).join('');
  return `
    <div class="ds-pa-active-filters" data-pa-active-filters aria-live="polite">
      <span class="ds-pa-active-filters-label">פילטרים פעילים:</span>
      <span class="ds-pa-active-filter-chips" data-pa-active-filter-chips>${chipsHtml}</span>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-pa-clear-filters>נקה סינון</button>
    </div>`;
}

function filteredOutMessageHtml(totalRows) {
  if (!(Number(totalRows) > 0)) return '';
  return `
    <div class="ds-pa-filtered-empty" data-pa-filtered-empty role="status">
      <p>יש הצעות במערכת אך הן מוסתרות בגלל סינון פעיל</p>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-pa-clear-filters>נקה סינון</button>
    </div>`;
}

export function updateProposalsAgreementsTableOnly(root, rows, state, options = {}) {
  const body = root?.querySelector('[data-pa-table-body]');
  const counter = root?.querySelector('[data-pa-results-count]');
  const totalCounter = root?.querySelector('[data-pa-total-count]');
  const activeHost = root?.querySelector('[data-pa-active-filters]');
  const emptyHost = root?.querySelector('[data-pa-filtered-empty-host]');
  const totalRows = Number(options.totalRows ?? rows.length);
  if (body) body.innerHTML = proposalsAgreementsTableRowsHtml(rows, state);
  if (counter) counter.textContent = String(rows.length);
  if (totalCounter) totalCounter.textContent = String(totalRows);
  if (activeHost) activeHost.outerHTML = activeFiltersHtml(options.filters || {});
  if (emptyHost) emptyHost.innerHTML = rows.length === 0 && totalRows > 0 ? filteredOutMessageHtml(totalRows) : '';
}



function proposalsScreenSummaryText(rows = []) {
  const normalized = (Array.isArray(rows) ? rows : []).map((row) => normalizeProposalStatus(row.status));
  const total = normalized.length;
  const waiting = normalized.filter((status) => status === 'pending_approval' || status === 'returned_for_changes').length;
  const sent = normalized.filter((status) => status === 'sent').length;
  return `${total} הצעות | ${waiting} ממתינות לטיפול | ${sent} נשלחו`;
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
  // Mirror the legacy phone/email fields into contact_phone/contact_email so both
  // column sets stay in sync without introducing a second source of truth in the form.
  payload.contact_phone = payload.phone;
  payload.contact_email = payload.email;
  payload.document_type = 'הצעת מחיר';
  payload.include_catalog = false;
  payload.activity_type_group = normalizeProposalGroup(payload.activity_type_group);
  if (isTourProposalGroup(payload.activity_type_group)) {
    payload.activity_type_group = 'tour';
  }
  const items = filterItemsByProposalType(extractItemsFromForm(form), payload.activity_type_group);
  const subtotal = items.reduce((s, i) => s + Math.max(Number(proposalField(i, 'total_price', 'totalPrice')) || ((Number(proposalField(i, 'quantity', 'quantity')) || 0) * (Number(proposalField(i, 'unit_price', 'unitPrice')) || 0)), 0), 0);
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
  payload.total_amount = items.reduce((s, i) => s + (Number(proposalField(i, 'total_price', 'totalPrice')) || ((Number(proposalField(i, 'quantity', 'quantity')) || 0) * (Number(proposalField(i, 'unit_price', 'unitPrice')) || 0))), 0) || null;
  payload._items = items;
  const selectedClientType = text(formData.get('client_type_selector')) || text(formData.get('contact_source_client_type')) || (text(formData.get('contact_source_school_id')) ? 'school' : 'authority');
  payload.client_type = ['school', 'authority', 'other'].includes(selectedClientType) ? selectedClientType : 'school';
  if (payload.client_type === 'other') {
    const otherClientName = text(formData.get('other_client_name'));
    payload.school_framework = '';
    payload.client_authority = text(formData.get('contact_source_authority'));
    payload.client_name = otherClientName;
    payload.other_client_name = otherClientName;
    payload.authority_id = text(formData.get('contact_source_authority_id')) || null;
    payload.school_id = null;
    payload.contact_school_id = null;
    payload.semel_mosad = null;
    payload._school_required = 'no';
  } else {
    payload.authority_id = text(formData.get('contact_source_authority_id')) || null;
    payload.semel_mosad = text(formData.get('contact_source_semel_mosad')) || null;
    const schoolRequired = text(formData.get('contact_source_school_required'));
    payload._school_required = schoolRequired === 'no' ? 'no' : 'yes';
    const isAuthorityOnlyPayload = payload.client_type === 'authority' || payload.client_type === 'other';
    payload.school_id = isAuthorityOnlyPayload ? null : (text(formData.get('contact_source_school_id')) || null);
    payload.contact_school_id = isAuthorityOnlyPayload ? null : (text(formData.get('contact_source_id')) || null);
  }
  payload._contact_selection_mode = text(formData.get('contact_selection_mode'));
  payload._contact_original = {
    id:           text(formData.get('contact_source_id')),
    client_type:  payload.client_type,
    authority_id: text(formData.get('contact_source_authority_id')) || null,
    school_id:    text(formData.get('contact_source_school_id')) || null,
    semel_mosad:  text(formData.get('contact_source_semel_mosad')) || null,
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

function proposalItemHasCatalogIdentity(item = {}) {
  return Boolean(
    text(item.source_pricing_key || item.sourcePricingKey) ||
    text(item.pricing_key || item.pricingKey) ||
    text(item.pricing_option_key || item.pricingOptionKey) ||
    text(item.activity_no || item.activityNo || item.pricing_activity_no || item.pricingActivityNo) ||
    text(item.list_id || item.listId)
  );
}

function isManualCourseWithoutGefen(item = {}) {
  return Boolean(text(item.item_name || item.itemName))
    && !text(item.gefen_number || item.gefenNumber)
    && !proposalItemHasCatalogIdentity(item);
}

function validatePayload(payload, statusOverride, options = {}) {
  const targetStatus = statusOverride || payload.status || 'draft';
  const requiresCompleteProposal = targetStatus === 'sent' || targetStatus === 'pending_approval' || targetStatus === 'approved';
  const clientType = text(payload.client_type) || 'school';
  const isOtherProposal = clientType === 'other';
  const isAuthorityOnlyProposal = clientType === 'authority';
  const baseRequiredFields = requiresCompleteProposal ? REQUIRED_FIELDS_PENDING : REQUIRED_FIELDS_DRAFT;
  const requiredFields = baseRequiredFields;
  const missing = requiredFields.filter((key) => !text(payload[key]));
  const errors = missing.map((key) => FIELD_LABELS[key] || key);
  if (isOtherProposal && !text(payload.client_name || payload.school_framework)) {
    errors.push('שם הלקוח');
  }
  if (!text(payload.authority_id)) {
    errors.push('יש לבחור רשות מתוך רשימת הרשויות.');
  }
  if (!isOtherProposal) {
    if (!text(payload.school_id) && !isAuthorityOnlyProposal) {
      errors.push('יש לבחור בית ספר מתוך רשימת בתי הספר של הרשות.');
    }
  }
  const hasManualContact = Boolean(text(payload.contact_name) || text(payload.contact_role) || text(payload.phone) || text(payload.email));
  const isOtherContact = text(payload._contact_selection_mode) === 'other';
  if (isOtherContact && !text(payload.contact_name)) {
    errors.push('יש להזין שם איש קשר חדש.');
  }
  if (hasManualContact && !text(payload.contact_school_id)) {
    if (!text(payload.authority_id) || (!isOtherProposal && !isAuthorityOnlyProposal && !text(payload.school_id))) {
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
    if (options.canAddManualCourseWithoutGefen === false) {
      const manualCourseWithoutGefen = items.find(isManualCourseWithoutGefen);
      if (manualCourseWithoutGefen) errors.push('רק מנהל מערכת יכול להוסיף קורס חדש שאינו מהרשימה וללא מספר גפ״ן.');
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
  notifyPendingProposalsNav(data.rows);
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


export {
  setProposalGroupLookups,
  normalizeProposalItemRow,
  parseProposalItemsJsonFallback,
  proposalItemsWithFallback,
  resolveProposalTemplateKey,
  proposalGroupTemplateKey,
  filterTemplateSectionsForGroup,
  documentSectionsEditorHtml,
  itemsSummaryHtml,
  extractItemsFromForm,
  proposalPdfDocumentTitle,
  sanitizeProposalPdfFileLabel,
  proposalRecipientFileLabel,
  sortRows,
  proposalStatusSortPriority,
  calculateTourTotal,
  validatePayload,
  resetRecipientDependentFields,
  stepComplete,
  selectedRecipientType,
  hideSchoolSearchPanel
};

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
    const totalRows = allDisplayRows(data).length;
    const rows = displayRows(data, {});
    const proposalGroupFilterOptions = proposalGroupOptions(data, Array.isArray(data?.rows) ? data.rows : [], Array.isArray(data?.proposalActivityPricing) ? data.proposalActivityPricing : []);
    const canManage = canManageProposalsAgreements(state);
    const rawRows = Array.isArray(data?.rows) ? data.rows.map(normalizeProposalAgreementRow) : [];
    return dsScreenStack(`
      ${dsPageHeader('הצעות מחיר', proposalsScreenSummaryText(rawRows))}
      <section class="ds-pa-screen" data-pa-screen dir="rtl">
        <style>
          .ds-pa-screen-tab{border-radius:10px 10px 0 0;transition:background .15s,color .15s,border-color .15s}.ds-pa-screen-tab:hover{background:rgba(14,165,233,.08)}
          .ds-pa-form{max-width:1080px;margin-inline:auto}.ds-pa-form .ds-pa-form-grid{max-width:100%}.ds-pa-item-card{border:1px solid #dbe7f3;border-radius:10px;background:#fff;padding:5px 8px;margin:3px 0;box-shadow:0 1px 3px rgba(15,23,42,.04)}
          .ds-pa-item-quick-row{display:grid;grid-template-columns:minmax(0,1fr) 96px;gap:6px;align-items:end}.ds-pa-item-extra{margin-top:4px}.ds-pa-item-extra-toggle{cursor:pointer;color:#2563eb;font-size:.78rem}.ds-pa-type-chips{grid-template-columns:repeat(2,minmax(0,1fr))}.ds-pa-type-card{min-height:28px!important;padding:3px 5px!important;font-size:.76rem!important}.ds-pa-summary-bar--compact{display:flex;align-items:center;gap:8px;justify-content:space-between}.ds-pa-summary-bar--compact .ds-pa-summary-pill{flex:1}.ds-pa-item-field--select select{overflow:hidden;text-overflow:ellipsis}.ds-pa-item-field--select-no-label{gap:0}.ds-pa-item-field span{display:block;font-size:.74rem;color:#64748b;margin-bottom:3px;font-weight:600}.ds-pa-line-total output{min-height:34px;display:flex;align-items:center;justify-content:center;border:1px solid #dbe7f3;border-radius:10px;background:#f8fbff;font-weight:700;color:#0f766e}.ds-pa-items-total-row{margin-top:10px;padding:10px 12px;border-radius:12px;background:#eef8ff;font-size:.9rem}.ds-pa-items-total-row strong{color:#0369a1}
          .ds-pa-bundle-prompt{margin-top:12px}.ds-pa-bundle-panel{border:1px solid #b7e0f5;background:#f8fdff;border-radius:14px;padding:12px}.ds-pa-bundle-head{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:6px}.ds-pa-bundle-head strong{font-size:.9rem;color:#0f172a}.ds-pa-bundle-head span,.ds-pa-bundle-help,.ds-pa-bundle-empty{font-size:.78rem;color:#64748b}.ds-pa-bundle-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:10px}.ds-pa-bundle-child-card{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;border:1px solid #dbe7f3;border-radius:12px;background:#fff;padding:9px 10px;cursor:pointer;min-height:42px}.ds-pa-bundle-child-card:hover{border-color:#38bdf8;background:#f0f9ff}.ds-pa-bundle-child-card:has(input:checked){border-color:#0ea5e9;background:#e0f2fe;box-shadow:0 0 0 1px #0ea5e9 inset}.ds-pa-bundle-child-name{font-size:.82rem;color:#0f172a;line-height:1.25}.ds-pa-bundle-child-price{font-size:.8rem;font-weight:700;color:#0f766e;white-space:nowrap}.ds-pa-bundle-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}.ds-pa-bundle-actions{display:flex;gap:6px}.ds-pa-bundle-selection-summary{font-size:.78rem;color:#0369a1;font-weight:700}.ds-pa-summary-bundle-list{margin:4px 0 0;padding-right:16px;font-size:.72rem}.ds-pa-items-summary-table{width:100%;border-collapse:collapse;font-size:.78rem}.ds-pa-items-summary-table th,.ds-pa-items-summary-table td{border-bottom:1px solid #e5eef6;padding:6px;text-align:right}.ds-pa-items-summary-table th{color:#64748b;font-weight:700;background:#f8fbff}
          .ds-pa-active-filters{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;border:1px solid #dbe7f3;background:#f8fbff;border-radius:10px;padding:6px 10px;margin:8px 0 10px}.ds-pa-active-filters[hidden]{display:none}.ds-pa-active-filters-label{color:#475569;font-weight:700;font-size:.82rem;flex-shrink:0}.ds-pa-active-filter-chips{display:flex;flex-wrap:wrap;gap:6px}.ds-pa-active-filter-chip{border:1px solid #bfdbfe;background:#eff6ff;color:#1e3a8a;border-radius:999px;padding:3px 9px;font-size:.78rem}.ds-pa-active-filters [data-pa-clear-filters]{margin-inline-start:auto}.ds-pa-filtered-empty{margin:12px;border:1px solid #fed7aa;background:#fff7ed;color:#9a3412;border-radius:12px;padding:14px;text-align:center}.ds-pa-filtered-empty p{margin:0 0 10px;font-weight:700}
          @media (max-width:900px){.ds-pa-bundle-grid{grid-template-columns:1fr}}@media (max-width:640px){.ds-pa-type-chips{grid-template-columns:repeat(2,minmax(0,1fr))}.ds-pa-item-quick-row{grid-template-columns:1fr}}
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
            <label class="ds-pa-filter"><span>תחום</span><select class="ds-input ds-input--sm" data-pa-filter="proposal_domain"><option value="">הכול</option><option value="Y">Y</option><option value="E">E</option></select></label>
            <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost ds-pa-clear-inline" data-pa-clear-filters>ניקוי סינון</button>
          </div>
          ${activeFiltersHtml({})}
          <div class="ds-pa-local-status" aria-live="polite" hidden><strong data-pa-results-count>${rows.length}</strong><strong data-pa-total-count>${totalRows}</strong></div>
          <div data-pa-filtered-empty-host></div><div class="ds-pa-records-shell" data-pa-table-region>${tableHtml(rows, state)}</div>
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
    notifyPendingProposalsNav(data.rows);
    const activityNameOptions = Array.from(new Set((Array.isArray(data?.activityNameOptions) ? data.activityNameOptions : []).map((v) => text(v)).filter(Boolean)));
    const proposalActivityPricing = Array.isArray(data?.proposalActivityPricing) ? data.proposalActivityPricing : [];
    setProposalGroupLookups(data, data.rows, proposalActivityPricing);
    setProposalPricingLookup(proposalActivityPricing);
    const proposalTemplateSections = normalizeTemplateSections(Array.isArray(data?.proposalTemplateSections) ? data.proposalTemplateSections : []);
    const contactOptions = Array.isArray(data?.contactOptions) ? data.contactOptions : [];
    const contactOptionsError = text(data?.contactOptionsError || '');
    const proposalLoaderDebug = data?._debug?.proposal_loader || {};
    const proposalLoaderError = (key) => proposalLoaderDebug?.[key]?.errorDetails || proposalLoaderDebug?.[key]?.error || null;
    // eslint-disable-next-line no-console
    console.info('[proposal-load-debug]', {
      templateSectionsCount: proposalTemplateSections.length,
      agreementItemsCount: Array.isArray(data?.proposalAgreementItems) ? data.proposalAgreementItems.length : 0,
      activityGroupsCount: Array.isArray(data?.proposalActivityGroups) ? data.proposalActivityGroups.length : 0,
      groupAliasesCount: Array.isArray(data?.proposalGroupAliases) ? data.proposalGroupAliases.length : 0,
      activityPricingCount: proposalActivityPricing.length,
      proposalsCount: data.rows.length,
      directoryRowsCount: proposalLoaderDebug?.rows?.count ?? data.rows.length,
      templateSectionsError: proposalLoaderError('templateSectionsError') || proposalLoaderError('proposalTemplateSections'),
      agreementItemsError: proposalLoaderError('agreementItemsError') || null,
      activityGroupsError: proposalLoaderError('activityGroupsError') || proposalLoaderError('proposalActivityGroups'),
      groupAliasesError: proposalLoaderError('groupAliasesError') || proposalLoaderError('proposalGroupAliases'),
      activityPricingError: proposalLoaderError('activityPricingError') || proposalLoaderError('proposalActivityPricing')
    });
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
      const enriched = enrichProposalRowFromContactOptions(row, contactOptions);
      // The contact saved on the proposal is the source of truth — never override it.
      if (text(enriched.contact_name)) return enriched;
      const contact = findContactForProposalRow(contactOptions, enriched);
      if (!contact) return enriched;
      return {
        ...enriched,
        client_name:      text(contact.client_name) || enriched.client_name || text(contact.school) || text(contact.authority),
        client_type:      text(contact.client_type) || enriched.client_type,
        client_authority: text(contact.authority) || enriched.client_authority,
        school_framework: text(contact.school) || enriched.school_framework,
        contact_name:     text(contact.contact_name) || enriched.contact_name,
        contact_role:     text(contact.contact_role) || enriched.contact_role,
        phone:            text(contact.phone || contact.mobile || '') || enriched.phone,
        email:            text(contact.email) || enriched.email
      };
    };
    let debounceTimer = null;

    const refreshTable = () => {
      const filters = currentFilters(root);
      updateProposalsAgreementsTableOnly(root, displayRows(data, filters), state, { filters, totalRows: allDisplayRows(data).length });
    };
    const debouncedRefresh = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refreshTable, SEARCH_DEBOUNCE_MS);
    };

    root.querySelector('[data-pa-search]')?.addEventListener('input', debouncedRefresh, { signal });
    root.querySelectorAll('[data-pa-filter]').forEach((el) => el.addEventListener('change', refreshTable, { signal }));
    root.addEventListener('click', (ev) => {
      if (!ev.target?.closest?.('[data-pa-clear-filters]')) return;
      clearTimeout(debounceTimer);
      resetLocalFilters();
      refreshTable();
    }, { signal });
    


    const formHost = root.querySelector('[data-pa-form-host]');

    const stepPanel = (form, key) => form?.querySelector(`[data-pa-step-panel="${key}"]`);
    const setPanelOpen = (form, key, open) => {
      const panel = stepPanel(form, key);
      if (!panel) return;
      panel.hidden = !open;
      panel.setAttribute('aria-disabled', open ? 'false' : 'true');
    };
    const updateProposalStepper = (container) => {
      const form = container?.closest?.('[data-pa-form]') || container?.querySelector?.('[data-pa-form]') || container;
      if (!form) return;
      const selectedType = text(form.querySelector('input[name="client_type_selector"]:checked')?.value) || 'school';
      const clientType = text(form.querySelector('input[name="contact_source_client_type"]')?.value) || selectedType;
      const authorityId = text(form.querySelector('input[name="contact_source_authority_id"]')?.value);
      const schoolId = text(form.querySelector('input[name="contact_source_school_id"]')?.value);

      let contactPanelOpen = false;
      if (clientType === 'other') {
        contactPanelOpen = true;
      } else if (clientType === 'authority') {
        contactPanelOpen = Boolean(authorityId);
      } else {
        contactPanelOpen = Boolean(schoolId);
      }

      const proposalTypeDone = Boolean(text(form.querySelector('[name="activity_type_group"]')?.value));
      ['client', 'proposal', 'summary'].forEach((key) => setPanelOpen(form, key, true));
      setPanelOpen(form, 'contact', contactPanelOpen);
      setPanelOpen(form, 'activity', proposalTypeDone);
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
      form.addEventListener('input', () => { updateProposalStepper(form); calcGrandTotal(form); renderContactChannelsStatus(form); }, { signal });
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
        itemsHost.innerHTML = itemsEditorHtml(currentItems, filteredPricing, newType, { allowManualCourse: text(form.dataset.paAllowManualCourse) === 'yes' });
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
    const setAddContactRowState = (form, { visible = false, showNoContactNote = false } = {}) => {
      const addContactRowEl = form?.querySelector('[data-pa-add-contact-row]');
      const noContactNote = form?.querySelector('[data-pa-no-contact-note]');
      if (addContactRowEl) addContactRowEl.hidden = !visible;
      if (noContactNote) noContactNote.hidden = !showNoContactNote;
    };

    const lockClientFields = (form, auth, school, cName, cRole, phone, email, clientName = '', schoolMeta = null) => {
      const cardEl = form?.querySelector('[data-pa-client-card]');
      const fieldsEl = form?.querySelector('[data-pa-client-fields]');
      const searchRow = form?.querySelector('[data-pa-client-search-row]');
      const results = form?.querySelector('[data-pa-client-results]');
      if (cardEl) { cardEl.innerHTML = clientLockedBannerHtml(auth, school, cName, cRole, phone, email, clientName, schoolMeta); cardEl.hidden = false; }
      if (fieldsEl) fieldsEl.hidden = true;
      if (searchRow) searchRow.hidden = true;
      if (results) { results.hidden = true; results.innerHTML = ''; }
      const roAuth = form?.querySelector('[data-pa-contact-ro-authority]');
      const roSchoolEl = form?.querySelector('[data-pa-contact-ro-school]');
      const roCtx = form?.querySelector('[data-pa-contact-ro-ctx]');
      if (roAuth) roAuth.value = auth;
      if (roSchoolEl) roSchoolEl.value = school;
      if (roCtx) roCtx.hidden = false;
      form?.querySelectorAll('[data-pa-contact-manual-fields]').forEach((el) => { el.hidden = true; });
      const channelsFields = form?.querySelector('[data-pa-contact-channels-fields]');
      if (channelsFields) channelsFields.hidden = true;
      renderContactChannelsStatus(form);
    };

    const unlockClientFields = (form) => {
      const cardEl = form?.querySelector('[data-pa-client-card]');
      const fieldsEl = form?.querySelector('[data-pa-client-fields]');
      const searchRow = form?.querySelector('[data-pa-client-search-row]');
      if (cardEl) cardEl.hidden = true;
      if (fieldsEl) fieldsEl.hidden = true;
      if (searchRow) searchRow.hidden = false;
      form?.querySelectorAll('[data-pa-contact-manual-fields]').forEach((el) => { el.hidden = true; });
      const roCtx = form?.querySelector('[data-pa-contact-ro-ctx]');
      if (roCtx) roCtx.hidden = true;
      const channelsFields = form?.querySelector('[data-pa-contact-channels-fields]');
      if (channelsFields) channelsFields.hidden = true;
      const channelsStatus = form?.querySelector('[data-pa-contact-channels-status]');
      if (channelsStatus) { channelsStatus.hidden = true; channelsStatus.innerHTML = ''; }
    };

    const applyContactSelectionAfterClient = (form, ctx = {}) => {
      if (!form) return;
      const {
        authority = '',
        school = '',
        authorityId = '',
        schoolId = '',
        clientType = 'school',
        clientName = '',
        semel_mosad = '',
        schoolMeta = null
      } = ctx;

      if (clientType === 'other') {
        const authInput = form.querySelector('input[name="client_authority"]');
        const schoolInput = form.querySelector('input[name="school_framework"]');
        if (authInput) authInput.value = authority;
        if (schoolInput) schoolInput.value = '';
        const otherName = text(form.querySelector('[name="other_client_name"]')?.value);
        setContactSource(form, {
          id: null,
          authority_id: authorityId || null,
          school_id: null,
          semel_mosad: null,
          school_required: 'no',
          client_type: 'other',
          client_name: otherName || clientName || '',
          authority,
          school: '',
          contact_name: text(form.querySelector('input[name="contact_name"]')?.value),
          contact_role: text(form.querySelector('input[name="contact_role"]')?.value),
          phone: text(form.querySelector('input[name="phone"]')?.value),
          mobile: '',
          email: text(form.querySelector('input[name="email"]')?.value)
        });
        form.dataset.paAuthorityId = authorityId;
        form.dataset.paAuthorityName = authority;
        hideSchoolSearchPanel(form);
        const searchField = form.querySelector('[data-pa-client-search-field]');
        const searchFieldWrap = form.querySelector('[data-pa-client-search-field-wrap]');
        const results = form.querySelector('[data-pa-client-results]');
        const input = form.querySelector('[data-pa-client-search-input]');
        if (searchField) searchField.hidden = true;
        if (searchFieldWrap) searchFieldWrap.hidden = false;
        if (input) input.value = '';
        if (results) { results.hidden = true; results.innerHTML = ''; }
        const pickerHost = form.querySelector('[data-pa-contact-picker-host]');
        if (pickerHost) pickerHost.innerHTML = '';
        setAddContactRowState(form, { visible: false, showNoContactNote: false });
        const card = form.querySelector('[data-pa-client-card]');
        if (card) { card.hidden = true; card.innerHTML = ''; }
        const searchRow = form.querySelector('[data-pa-client-search-row]');
        if (searchRow) searchRow.hidden = false;
        const otherField = form.querySelector('[data-pa-other-client-field]');
        if (otherField) otherField.hidden = false;
        const contactPanel = form.querySelector('[data-pa-step-panel="contact"]');
        if (contactPanel) contactPanel.hidden = false;
        form.querySelectorAll('[data-pa-contact-manual-fields]').forEach((el) => { el.hidden = false; });
        const roCtx = form.querySelector('[data-pa-contact-ro-ctx]');
        if (roCtx) {
          roCtx.hidden = false;
          const roAuth = form.querySelector('[data-pa-contact-ro-authority]');
          const roSchool = form.querySelector('[data-pa-contact-ro-school]');
          if (roAuth) roAuth.value = authority;
          if (roSchool) roSchool.value = '';
        }
        syncOtherRecipientSchoolFieldVisibility(form);
        const channelsFields = form.querySelector('[data-pa-contact-channels-fields]');
        if (channelsFields) channelsFields.hidden = false;
        setContactSelectionMode(form, 'other');
        setPanelOpen(form, 'contact', true);
        setTimeout(() => {
          calcGrandTotal(form);
          updateProposalStepper(form);
          updateLivePreview(form);
        }, 0);
        return;
      }

      const isAuthorityOnly = clientType === 'authority' || clientType === 'other';
      const authInput = form.querySelector('input[name="client_authority"]');
      const schoolInput = form.querySelector('input[name="school_framework"]');
      if (authInput) authInput.value = authority;
      if (schoolInput) schoolInput.value = clientType === 'other' ? '' : school;

      const catalogSchool = schoolMeta || findSchoolCatalogContact(contactOptions, {
        authorityId,
        schoolId,
        authority,
        school
      }) || {};
      const pickerHost = form.querySelector('[data-pa-contact-picker-host]');
      // Contact must never be auto-filled on client selection — the school/authority
      // principal metadata is still offered as a pickable option inside contactPickerHtml,
      // but it must not be pre-selected here.
      const defaultContact = null;
      const baseSource = {
        authority_id: authorityId || null,
        school_id: isAuthorityOnly ? null : (schoolId || null),
        semel_mosad: isAuthorityOnly ? '' : (text(semel_mosad) || text(catalogSchool.semel_mosad)),
        school_required: isAuthorityOnly ? 'no' : 'yes',
        client_type: clientType,
        client_name: clientName || school || authority,
        authority,
        school: isAuthorityOnly ? '' : school,
        contact_name: text(defaultContact?.contact_name),
        contact_role: text(defaultContact?.contact_role),
        phone: text(defaultContact?.phone),
        mobile: text(defaultContact?.mobile),
        email: text(defaultContact?.email)
      };

      setPanelOpen(form, 'contact', true);

      fillContactFields(form, baseSource);
      setContactSelectionMode(form, '');
      setContactSource(form, baseSource);
      if (pickerHost) {
        pickerHost.innerHTML = contactPickerHtml(
          contactOptions,
          authority,
          isAuthorityOnly ? '' : school,
          '',
          authorityId,
          isAuthorityOnly ? null : (schoolId || null),
          isAuthorityOnly,
          catalogSchool
        );
        if (pickerHost.children.length) setupContactPicker(pickerHost, form);
        const noContacts = pickerHost.querySelector('[data-pa-contact-picker-state]')?.dataset?.paNoContacts === 'yes';
        setAddContactRowState(form, { visible: !isAuthorityOnly && Boolean(schoolId) && noContacts, showNoContactNote: noContacts });
      }
      lockClientFields(
        form,
        authority,
        isAuthorityOnly ? '' : school,
        text(defaultContact?.contact_name),
        text(defaultContact?.contact_role),
        text(defaultContact?.phone),
        text(defaultContact?.email),
        clientName || school || authority,
        catalogSchool
      );

      const searchField = form.querySelector('[data-pa-client-search-field]');
      const schoolSearchPanel = form.querySelector('[data-pa-school-search-panel]');
      const input = form.querySelector('[data-pa-client-search-input]');
      const schoolSearchInput = form.querySelector('[data-pa-school-search-input]');
      const results = form.querySelector('[data-pa-client-results]');
      const schoolResults = form.querySelector('[data-pa-school-results]');
      if (searchField) searchField.hidden = true;
      if (schoolSearchPanel) schoolSearchPanel.hidden = true;
      if (input) input.value = '';
      if (schoolSearchInput) schoolSearchInput.value = '';
      if (results) { results.hidden = true; results.innerHTML = ''; }
      if (schoolResults) { schoolResults.hidden = true; schoolResults.innerHTML = ''; }
      setPanelOpen(form, 'contact', true);
      setTimeout(() => {
        calcGrandTotal(form);
        updateProposalStepper(form);
        const contactSelect = form.querySelector('[data-pa-contact-select]');
        if (contactSelect && !contactSelect.disabled) contactSelect.focus({ preventScroll: true });
      }, 0);
    };
    const fillContactFields = (form, contact) => {
      if (!form || !contact) return;
      const map = {
        contact_name: text(contact.contact_name),
        contact_role: text(contact.contact_role),
        // Mobile is the central channel for follow-up; keep an existing landline
        // as a fallback only, never drop it from the source record.
        phone:        text(contact.mobile || contact.phone || ''),
        email:        text(contact.email || '')
      };
      for (const [name, value] of Object.entries(map)) {
        const input = form.querySelector(`input[name="${name}"]`);
        if (input) input.value = value;
      }
      renderContactChannelsStatus(form);
    };

    const setContactSource = (form, contact = {}) => {
      setContactSourceFields(form, contact || {});
    };

    const renderContactChannelsStatus = (form) => {
      const statusHost = form?.querySelector('[data-pa-contact-channels-status]');
      if (!statusHost) return;
      const contactName = text(form.querySelector('input[name="contact_name"]')?.value);
      if (!contactName) {
        statusHost.hidden = true;
        statusHost.innerHTML = '';
        return;
      }
      const hasEmail = Boolean(text(form.querySelector('input[name="email"]')?.value));
      const hasMobile = Boolean(text(form.querySelector('input[name="phone"]')?.value));
      const fieldsBlock = form.querySelector('[data-pa-contact-channels-fields]');
      const fieldsOpen = Boolean(fieldsBlock && !fieldsBlock.hidden);
      statusHost.hidden = false;
      statusHost.innerHTML = contactChannelsStatusHtml(hasEmail, hasMobile, fieldsOpen);
    };

    const syncContactChannelsToSource = async (form) => {
      renderContactChannelsStatus(form);
      const sourceId = text(form?.querySelector('input[name="contact_source_id"]')?.value);
      // A saved proposal only ever gets a non-empty contact_school_id from picking a
      // real directory contact (never from the school-principal default or a manual
      // "other" entry), so contacts_schools is a safe default when re-opening it for
      // edit without a freshly-known source table.
      const sourceTable = text(form?.querySelector('input[name="contact_source_table"]')?.value) || (sourceId ? 'contacts_schools' : '');
      if (!sourceId || !sourceTable || typeof api.updateUnifiedContactRecord !== 'function') return;
      const emailVal = text(form.querySelector('input[name="email"]')?.value);
      const mobileVal = text(form.querySelector('input[name="phone"]')?.value);
      try {
        await api.updateUnifiedContactRecord({ source_table: sourceTable, source_id: sourceId, fields: { mobile: mobileVal, email: emailVal } });
        const match = contactOptions.find((c) => text(c.id) === sourceId && text(c.source_table) === sourceTable);
        if (match) { match.mobile = mobileVal; match.email = emailVal; }
        showToast('פרטי הקשר עודכנו במקור', 'success', 1800);
      } catch (err) {
        // Best-effort sync only — never blocks saving the proposal itself.
        // eslint-disable-next-line no-console
        console.warn('[proposals-agreements] contact channel sync failed', err?.message || err);
      }
    };

    const setupContactChannelsPanel = (form) => {
      if (!form || form.dataset.paContactChannelsBound === 'yes') return;
      form.dataset.paContactChannelsBound = 'yes';
      form.addEventListener('click', (event) => {
        const toggleBtn = event.target?.closest?.('[data-pa-contact-channels-toggle]');
        if (!toggleBtn) return;
        const fieldsBlock = form.querySelector('[data-pa-contact-channels-fields]');
        if (fieldsBlock) fieldsBlock.hidden = false;
        renderContactChannelsStatus(form);
        fieldsBlock?.querySelector('input[name="phone"]')?.focus();
      }, { signal });
      form.addEventListener('change', (event) => {
        const target = event.target;
        if (!target?.closest?.('[data-pa-contact-channels-fields]')) return;
        if (target.name !== 'phone' && target.name !== 'email') return;
        syncContactChannelsToSource(form);
      }, { signal });
    };

    const setContactSelectionMode = (form, mode = '') => {
      const input = form?.querySelector('input[name="contact_selection_mode"]');
      if (input) input.value = mode;
    };

    const contactSourceFromForm = (form) => ({
      id: '',
      authority_id: text(form?.querySelector('input[name="contact_source_authority_id"]')?.value) || null,
      school_id: text(form?.querySelector('input[name="contact_source_school_id"]')?.value) || null,
      semel_mosad: text(form?.querySelector('input[name="contact_source_semel_mosad"]')?.value) || null,
      school_required: text(form?.querySelector('input[name="contact_source_school_required"]')?.value) || 'yes',
      client_type: text(form?.querySelector('input[name="contact_source_client_type"]')?.value) || 'school',
      client_name: text(form?.querySelector('input[name="contact_source_client_name"]')?.value),
      authority: text(form?.querySelector('input[name="contact_source_authority"]')?.value),
      school: text(form?.querySelector('input[name="contact_source_school"]')?.value),
      contact_name: '',
      contact_role: '',
      phone: '',
      mobile: '',
      email: ''
    });

    const showManualContactFields = (form) => {
      if (!form) return;
      form.querySelectorAll('[data-pa-contact-manual-fields]').forEach((el) => { el.hidden = false; });
      const roCtx = form.querySelector('[data-pa-contact-ro-ctx]');
      if (roCtx) roCtx.hidden = false;
      const channelsFields = form.querySelector('[data-pa-contact-channels-fields]');
      if (channelsFields) channelsFields.hidden = false;
      setContactSelectionMode(form, 'other');
      setContactSource(form, contactSourceFromForm(form));
      fillContactFields(form, {});
      form.querySelector('input[name="contact_name"]')?.focus();
    };

    const setupContactPicker = (container, form) => {
      const contactSelect = container?.querySelector?.('[data-pa-contact-select]');
      if (!contactSelect) return;
      contactSelect.addEventListener('change', () => {
        const key = contactSelect.value;
        if (key === '__pa_other_contact__') {
          lockClientFields(
            form,
            text(form.querySelector('input[name="contact_source_authority"]')?.value),
            text(form.querySelector('input[name="contact_source_school"]')?.value),
            '', '', '', '',
            text(form.querySelector('input[name="contact_source_client_name"]')?.value)
          );
          showManualContactFields(form);
          return;
        }
        if (!key) return;
        let contact = contactOptions.find((c) => contactOptionKey(c) === key);
        if (!contact) {
          const encoded = contactSelect.selectedOptions?.[0]?.dataset?.paContactOption || '';
          try { contact = encoded ? JSON.parse(decodeURIComponent(encoded)) : null; } catch { contact = null; }
        }
        if (contact) {
          setContactSelectionMode(form, '');
          fillContactFields(form, contact);
          setContactSource(form, contact);
          setAddContactRowState(form, { visible: false, showNoContactNote: false });
          lockClientFields(form, text(contact.authority), text(contact.school), text(contact.contact_name), text(contact.contact_role), text(contact.phone || contact.mobile || ''), text(contact.email || ''), text(contact.client_name) || text(contact.school) || text(contact.authority), contact);
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
          if (trigger.disabled || trigger.getAttribute('aria-disabled') === 'true') return;
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
      const results = form.querySelector('[data-pa-client-results]');
      if (searchField) searchField.hidden = false;
      hideSchoolSearchPanel(form);
      if (results) { results.hidden = true; results.innerHTML = ''; }
      const searchInput = form.querySelector('[data-pa-client-search-input]');
      if (searchInput) searchInput.value = '';
      setPanelOpen(form, 'contact', selectedRecipientType(form) === 'other');
      const pickerHost = form.querySelector('[data-pa-contact-picker-host]');
      if (pickerHost) pickerHost.innerHTML = '';
      if (selectedRecipientType(form) !== 'other') {
        form.querySelectorAll('[data-pa-contact-manual-fields]').forEach((el) => { el.hidden = true; });
      }
    };

    const showSchoolSearchPanel = (form, authorityName) => {
      if (selectedRecipientType(form) !== 'school') return;
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
      if (selectedRecipientType(form) === 'other') hideSchoolSearchPanel(form);
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
      if (selectedRecipientType(form) !== 'school') return;
      const authorityName = catalogAuthorityName(contact);
      const authorityId = text(contact.authority_id) || '';
      form.dataset.paAuthorityId = authorityId;
      form.dataset.paAuthorityName = authorityName;
      form.dataset.paNewClient = 'no';
      // eslint-disable-next-line no-console
      console.info('[proposal-schools-filter]', {
        selectedAuthority: { id: authorityId, name: authorityName },
        selectedAuthorityId: authorityId,
        allSchoolsCount: contactOptions.filter((c) => c._catalog_source === 'schools').length,
        matchingSchoolsCount: contactOptions
          .filter((c) => c._catalog_source === 'schools' && String(c.authority_id) === String(authorityId))
          .length,
        sampleMatchingSchools: contactOptions
          .filter((c) => c._catalog_source === 'schools' && String(c.authority_id) === String(authorityId))
          .slice(0, 10)
      });

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
        const selectedType = text(form.querySelector('input[name="client_type_selector"]:checked')?.value) || 'school';
        if (selectedType === 'other') {
          const authorityName = catalogAuthorityName(contact);
          const authorityId = text(contact.authority_id) || '';
          const otherClientName = text(form.querySelector('[name="other_client_name"]')?.value);
          form.dataset.paAuthorityId = authorityId;
          form.dataset.paAuthorityName = authorityName;
          form.dataset.paNewClient = 'no';
          applyContactSelectionAfterClient(form, {
            authority: authorityName, school: '', authorityId, schoolId: '',
            clientType: 'other', clientName: otherClientName || authorityName
          });
        } else if (selectedType === 'authority') {
          const authorityName = catalogAuthorityName(contact);
          const authorityId = text(contact.authority_id) || '';
          form.dataset.paAuthorityId = authorityId;
          form.dataset.paAuthorityName = authorityName;
          form.dataset.paNewClient = 'no';
          applyContactSelectionAfterClient(form, {
            authority: authorityName,
            school: '',
            authorityId,
            schoolId: '',
            clientType: 'authority',
            clientName: authorityName
          });
        } else {
          applyAuthoritySelection(form, contact);
        }
        return;
      }

      if (step === 'school') {
        if (selectedRecipientType(form) !== 'school') return;
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
          clientName: school,
          semel_mosad: text(contact.semel_mosad),
          schoolMeta: contact
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
        const stepLabel = step === 'school' ? 'בית ספר' : 'רשות';
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


    const applyRecipientTypeMode = (form, { resetData = false } = {}) => {
      if (!form) return;
      const selected = text(form.querySelector('input[name="client_type_selector"]:checked')?.value) || 'school';

      if (resetData) {
        resetRecipientDependentFields(form, selected);
      }

      const card = form.querySelector('[data-pa-client-card]');
      const locked = card && !card.hidden && card.children.length > 0;
      const otherField = form.querySelector('[data-pa-other-client-field]');
      const contactPanel = form.querySelector('[data-pa-step-panel="contact"]');
      const searchFieldWrap = form.querySelector('[data-pa-client-search-field-wrap]');
      const searchRow = form.querySelector('[data-pa-client-search-row]');
      const schoolSearchPanel = form.querySelector('[data-pa-school-search-panel]');
      const manualFields = form.querySelectorAll('[data-pa-contact-manual-fields]');
      const channelsFields = form.querySelector('[data-pa-contact-channels-fields]');
      const channelsStatus = form.querySelector('[data-pa-contact-channels-status]');
      const roCtx = form.querySelector('[data-pa-contact-ro-ctx]');

      if (selected === 'other') {
        if (searchRow) searchRow.hidden = locked;
        if (searchFieldWrap) searchFieldWrap.hidden = locked;
        hideSchoolSearchPanel(form);
        if (otherField) otherField.hidden = false;
        if (contactPanel) contactPanel.hidden = false;
        manualFields.forEach((el) => { el.hidden = false; });
        if (roCtx) roCtx.hidden = locked || !text(form.querySelector('input[name="contact_source_authority_id"]')?.value);
        syncOtherRecipientSchoolFieldVisibility(form);
        if (channelsFields) channelsFields.hidden = false;
        if (!locked) setContactSelectionMode(form, 'other');
        renderContactChannelsStatus(form);
      } else if (selected === 'authority') {
        if (otherField) otherField.hidden = true;
        if (searchRow) searchRow.hidden = locked;
        if (searchFieldWrap) searchFieldWrap.hidden = false;
        hideSchoolSearchPanel(form);
        if (!locked) {
          if (contactPanel) contactPanel.hidden = true;
          manualFields.forEach((el) => { el.hidden = true; });
          if (channelsFields) channelsFields.hidden = true;
          if (channelsStatus) { channelsStatus.hidden = true; channelsStatus.innerHTML = ''; }
          if (roCtx) roCtx.hidden = true;
        }
        applyClientSearchMode(form);
      } else {
        if (otherField) otherField.hidden = true;
        if (searchRow) searchRow.hidden = locked;
        if (searchFieldWrap) searchFieldWrap.hidden = locked || text(form.dataset.paSearchStep) === 'school';
        if (schoolSearchPanel) schoolSearchPanel.hidden = locked || text(form.dataset.paSearchStep) !== 'school';
        if (!locked) {
          if (contactPanel) contactPanel.hidden = true;
          manualFields.forEach((el) => { el.hidden = true; });
          if (channelsFields) channelsFields.hidden = true;
          if (channelsStatus) { channelsStatus.hidden = true; channelsStatus.innerHTML = ''; }
          if (roCtx) roCtx.hidden = true;
        }
        applyClientSearchMode(form);
      }

      calcGrandTotal(form);
      updateProposalStepper(form);
      if (resetData) updateLivePreview(form);
    };

    const setupRecipientTypeSelector = (form) => {
      if (!form || form.dataset.paRecipientTypeBound === 'yes') return;
      form.dataset.paRecipientTypeBound = 'yes';
      form.querySelectorAll('input[name="client_type_selector"]').forEach((input) => {
        input.addEventListener('change', () => applyRecipientTypeMode(form, { resetData: true }), { signal });
      });
      form.querySelector('[name="other_client_name"]')?.addEventListener('input', () => {
        const selected = text(form.querySelector('input[name="client_type_selector"]:checked')?.value);
        if (selected !== 'other') return;
        const otherName = text(form.querySelector('[name="other_client_name"]')?.value);
        const currentSource = contactSourceFromForm(form);
        const nextSource = {
          ...emptyContactSourceForRecipientType('other', otherName),
          authority_id: currentSource.authority_id,
          authority: currentSource.authority,
          client_name: otherName,
          contact_name: text(form.querySelector('input[name="contact_name"]')?.value),
          contact_role: text(form.querySelector('input[name="contact_role"]')?.value),
          phone: text(form.querySelector('input[name="phone"]')?.value),
          email: text(form.querySelector('input[name="email"]')?.value)
        };
        setContactSourceFields(form, nextSource);
        calcGrandTotal(form);
        updateLivePreview(form);
      }, { signal });
      applyRecipientTypeMode(form);
    };

    const setupClientSelector = (container) => {
      const form = container?.querySelector?.('[data-pa-form]') || container?.closest?.('[data-pa-form]') || (container?.matches?.('[data-pa-form]') ? container : null);
      if (!form || form.dataset.paClientSearchBound === 'yes') return;
      form.dataset.paClientSearchBound = 'yes';
      setupRecipientTypeSelector(form);
      setupContactChannelsPanel(form);
      applyClientSearchMode(form);
      // Init contact area for forms already locked on mount (edit mode)
      const initCard = form.querySelector('[data-pa-client-card]');
      const initIsLocked = initCard && !initCard.hidden && initCard.children.length > 0;
      if (initIsLocked) {
        const roAuthInit = form.querySelector('[data-pa-contact-ro-authority]');
        const roSchoolInit = form.querySelector('[data-pa-contact-ro-school]');
        const roCtxInit = form.querySelector('[data-pa-contact-ro-ctx]');
        if (roAuthInit) roAuthInit.value = text(form.querySelector('input[name="client_authority"]')?.value || '');
        if (roSchoolInit) roSchoolInit.value = text(form.querySelector('input[name="school_framework"]')?.value || '');
        if (roCtxInit) roCtxInit.hidden = false;
      }
      renderContactChannelsStatus(form);
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
      const templateSections = filterTemplateSectionsForGroup(proposalTemplateSections, row.activity_type_group);
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
      if (totalDisplay) totalDisplay.textContent = total ? `₪ ${formatCurrency(total)}` : '';
      return total;
    };

    const calcTourTotal = (container) => {
      const details = container.querySelector('[data-pa-tour-details]');
      if (!details) return null;
      const totalInput = details.querySelector('[data-pa-tour-total]');
      const costComponents = Array.from(details.querySelectorAll('[data-pa-tour-component-row]')).map((row) => {
        const typeInput = row.querySelector('[data-pa-tour-component-type]');
        const component_type = text(typeInput?.value);
        // Show/hide class name field based on component type
        const classNameField = row.querySelector('[data-pa-tour-class-name-field]');
        if (classNameField) classNameField.hidden = (component_type !== 'class');
        // Resolve label: class uses custom name input; others use fixed display label
        const classNameInput = row.querySelector('[data-pa-tour-component-class-name]');
        const customLabel = component_type === 'class' ? text(classNameInput?.value) : null;
        const labelInput = row.querySelector('[data-pa-tour-component-label]');
        const label = customLabel || TOUR_COST_COMPONENT_LABELS.get(component_type) || text(labelInput?.value);
        if (labelInput) labelInput.value = label;
        const unit_price = numberValue(row.querySelector('[data-pa-tour-component-price]')?.value) ?? 0;
        const componentQuantity = numberValue(row.querySelector('[data-pa-tour-component-quantity]')?.value) ?? 1;
        const total_price = unit_price * componentQuantity;
        const rowTotal = row.querySelector('[data-pa-tour-component-total]');
        if (rowTotal) rowTotal.value = total_price ? total_price.toFixed(2) : '';
        return { component_type, label, unit_price, quantity: componentQuantity, total_price };
      });
      const calculated = calculateTourTotal({ costComponents });
      if (totalInput) totalInput.value = calculated ? calculated.toFixed(2) : '';
      return calculated ?? 0;
    };

    const calcGrandTotal = (container) => {
      let subtotal = calcTourTotal(container);
      if (subtotal == null) {
        subtotal = 0;
        container.querySelectorAll('[data-pa-item-row]').forEach((rowEl) => { subtotal += calcItemRow(rowEl); });
      }
      const discountType = text(container.querySelector('[data-pa-discount-type]')?.value) || 'amount';
      const discountValue = parseFloat(container.querySelector('[data-pa-discount-value]')?.value || '0') || 0;
      const discount = discountType === 'percent' ? subtotal * (Math.min(discountValue, 100) / 100) : Math.min(discountValue, subtotal);
      const sum = Math.max(subtotal - discount, 0);
      const el = container.querySelector('[data-pa-grand-total]');
      if (el) el.textContent = sum ? `₪ ${formatCurrency(sum)}` : '₪ 0';
      const subtotalEl = container.querySelector('[data-pa-summary-subtotal]');
      if (subtotalEl) subtotalEl.textContent = subtotal ? `₪ ${formatCurrency(subtotal)}` : '₪ 0';
      const discountEl = container.querySelector('[data-pa-summary-discount]');
      if (discountEl) discountEl.textContent = discount ? `-₪ ${formatCurrency(discount)}` : '₪ 0';
      container.querySelectorAll('[data-pa-summary-discount-row]').forEach((el) => { el.hidden = discount <= 0; });
      const summaryEl = container.querySelector('[data-pa-summary-total]');
      if (summaryEl) summaryEl.textContent = sum ? `₪ ${formatCurrency(sum)}` : '₪ 0';
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

    const formAllowsManualCourse = (form) => text(form?.dataset?.paAllowManualCourse) === 'yes';

    const setManualCourseNameFieldActive = (itemRow, active) => {
      const manualInput = itemRow?.querySelector?.('[data-pa-manual-item-name]');
      const detailsInput = itemRow?.querySelector?.('[data-pa-details-item-name-input]');
      const manualRow = itemRow?.querySelector?.('[data-pa-manual-name-row]');
      const detailsName = itemRow?.querySelector?.('[data-pa-details-item-name]');
      const details = itemRow?.querySelector?.('[data-pa-item-details]');
      const summary = itemRow?.querySelector?.('.ds-pa-item-extra-toggle');
      if (active) {
        const currentName = text(detailsInput?.value || manualInput?.value);
        if (manualInput) {
          manualInput.name = 'item_name';
          if (currentName) manualInput.value = currentName;
        }
        if (detailsInput) detailsInput.removeAttribute('name');
        if (manualRow) manualRow.hidden = false;
        if (detailsName) detailsName.hidden = true;
        if (details) details.open = true;
        if (summary) summary.textContent = 'פרטי קורס';
        itemRow.classList.add('ds-pa-item-row--manual');
        itemRow.dataset.paManualCourse = 'yes';
      } else {
        const currentName = text(manualInput?.value || detailsInput?.value);
        if (manualInput) manualInput.removeAttribute('name');
        if (detailsInput) {
          detailsInput.name = 'item_name';
          if (currentName) detailsInput.value = currentName;
        }
        if (manualRow) manualRow.hidden = true;
        if (detailsName) detailsName.hidden = false;
        if (summary) summary.textContent = 'עריכה';
        itemRow.classList.remove('ds-pa-item-row--manual');
        delete itemRow.dataset.paManualCourse;
      }
    };

    const applyManualCourseToRow = (itemRow, form) => {
      const rowGroup = text(itemRow.dataset.paRowGroup) || 'next_year';
      [
        'pricing_option_key', 'activity_no', 'item_type', 'gefen_number', 'gefen_number_display',
        'item_source_pricing_key', 'bundle_pricing_key', 'list_id', 'description', 'unit_duration', 'hourly_price'
      ].forEach((name) => setRowValue(itemRow, name, ''));
      setRowValue(itemRow, 'item_display_mode', 'single');
      setRowValue(itemRow, 'proposal_group', rowGroup);
      setRowValue(itemRow, 'item_selected_bundle_items', '[]');
      const bundlePrompt = itemRow.querySelector('[data-pa-bundle-prompt]');
      if (bundlePrompt) {
        bundlePrompt.hidden = true;
        bundlePrompt.innerHTML = '';
      }
      setManualCourseNameFieldActive(itemRow, true);
      itemRow.querySelector('[data-pa-manual-item-name]')?.focus();
      calcItemRow(itemRow);
      if (form) calcGrandTotal(form);
      if (form) updateProposalStepper(form);
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
        ? `${selected.length} פעילויות נבחרו${sum ? ` | ₪ ${formatCurrency(sum)}` : ''}`
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
      row = enrichProposalRowFromContactOptions(row, contactOptions);
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
      items = proposalItemsWithFallback(items, row);
      formHost.hidden = false;
      formHost.innerHTML = formHtml(mode, row, activityNameOptions, contactOptions, items, proposalActivityPricing, state, contactOptionsError);
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

    const resetLocalFilters = () => {
      const search = root.querySelector('[data-pa-search]');
      if (search) search.value = '';
      root.querySelectorAll('[data-pa-filter]').forEach((filter) => { filter.value = ''; });
    };

    const highlightProposalRow = (id) => {
      const rowId = text(id);
      if (!rowId) return;
      setTimeout(() => {
        const row = root.querySelector(`[data-pa-row-id="${window.CSS?.escape ? window.CSS.escape(rowId) : rowId}"]`);
        if (!row) return;
        const previousBackground = row.style.backgroundColor;
        row.style.backgroundColor = '#fef3c7';
        row.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        setTimeout(() => { row.style.backgroundColor = previousBackground; }, 3500);
      }, 0);
    };

    const closeForm = () => {
      if (!formHost) return;
      formHost.hidden = true;
      formHost.innerHTML = '';
      setFormTabLabel('add');
      switchTab('records');
    };

    // ── Preview ───────────────────────────────────────────────────────────────
    const openProposalFinalPdf = async (row) => {
      const id = text(row?.id);
      if (!id || typeof api.getProposalFinalPdfSignedUrl !== 'function') {
        showToast('לא ניתן לפתוח PDF שנשלח', 'error');
        return;
      }
      try {
        const result = await api.getProposalFinalPdfSignedUrl(id);
        const url = text(result?.signedUrl);
        if (!url) throw new Error('proposal_final_pdf_missing');
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch (err) {
        showToast('שגיאה בפתיחת PDF שנשלח', 'error');
        window.alert?.(`שגיאה בפתיחת PDF: ${err?.message || err}`);
      }
    };

    const openSendProposalDialog = async (row, items = []) => {
      const freshRow = rowWithCentralContact(row);
      const mergedItems = proposalItemsWithFallback(items, freshRow);
      const templateSections = filterTemplateSectionsForGroup(proposalTemplateSections, freshRow.activity_type_group);
      const previewHtml = proposalPreviewBodyHtml(freshRow, mergedItems, templateSections, { showSignatureImage: true });
      document.getElementById('pa-send-dialog-overlay')?.remove();
      const overlay = document.createElement('div');
      overlay.id = 'pa-send-dialog-overlay';
      overlay.className = 'proposal-preview-overlay';
      overlay.setAttribute('dir', 'rtl');
      overlay.innerHTML = `
        <div class="proposal-preview-toolbar no-print">
          <button type="button" class="ds-btn ds-btn--sm no-print" id="pa-send-dialog-close">ביטול</button>
          <button type="button" class="ds-btn ds-btn--primary ds-btn--sm no-print" id="pa-send-dialog-confirm">אשר שליחה ונעילה</button>
          <span class="ds-pa-preview-client no-print">סימון כנשלח — נדרש PDF סופי</span>
        </div>
        <div class="ds-pa-send-dialog-body">
          <p class="ds-pa-send-dialog-note no-print">לפני שליחה: הדפיסו/שמרו את המסמך כ-PDF והעלו את הקובץ הסופי. לאחר השליחה המסמך יינעל ולא יושפע משינויי תבנית.</p>
          <label class="ds-pa-form-field ds-pa-form-field--wide no-print">
            <span>קובץ PDF סופי *</span>
            <input class="ds-input ds-input--sm" type="file" accept="application/pdf,.pdf" id="pa-send-pdf-input" required>
          </label>
          <p class="ds-pa-form-error no-print" id="pa-send-dialog-error" role="alert"></p>
          <div class="proposal-preview-area">${previewHtml}</div>
        </div>`;
      document.body.appendChild(overlay);
      const closeDialog = () => overlay.remove();
      overlay.querySelector('#pa-send-dialog-close')?.addEventListener('click', closeDialog);
      overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDialog(); });
      overlay.querySelector('#pa-send-dialog-confirm')?.addEventListener('click', async () => {
        const confirmBtn = overlay.querySelector('#pa-send-dialog-confirm');
        const errorEl = overlay.querySelector('#pa-send-dialog-error');
        const fileInput = overlay.querySelector('#pa-send-pdf-input');
        const pdfFile = fileInput?.files?.[0] || null;
        if (!pdfFile) {
          if (errorEl) errorEl.textContent = 'יש לבחור קובץ PDF סופי לפני שליחה.';
          return;
        }
        if (!/\.pdf$/i.test(text(pdfFile.name)) && text(pdfFile.type) !== 'application/pdf') {
          if (errorEl) errorEl.textContent = 'ניתן להעלות PDF בלבד.';
          return;
        }
        if (typeof api.lockAndSendProposalAgreement !== 'function') {
          if (errorEl) errorEl.textContent = 'פעולת שליחה ונעילה אינה זמינה.';
          return;
        }
        confirmBtn.disabled = true;
        try {
          const documentSnapshot = buildProposalDocumentSnapshot(freshRow, mergedItems, templateSections);
          const documentHtmlSnapshot = previewHtml;
          const result = await api.lockAndSendProposalAgreement(text(freshRow.id), {
            pdfFile,
            documentSnapshot,
            documentHtmlSnapshot
          });
          replaceLocalRow(data, result?.row || { ...freshRow, status: 'sent' });
          refreshTable();
          const updated = data.rows.find((item) => text(item.id) === text(freshRow.id));
          const drawer = root.querySelector('[data-pa-drawer]');
          if (drawer && updated) drawer.outerHTML = drawerHtml(updated, activityNameOptions, state);
          closeDialog();
          showToast('ההצעה נשלחה וננעלה בהצלחה', 'success');
        } catch (err) {
          confirmBtn.disabled = false;
          if (errorEl) errorEl.textContent = `שגיאה בשליחה: ${err?.message || err}`;
        }
      });
    };

    const openPreview = async (row, items, options = {}) => {
      if (options.form) options.form.dataset.paPreviewSeen = 'yes';
      const savedRow = data.rows.find((r) => text(r.id) === text(row.id));
      const mergedRow = savedRow ? { ...savedRow, ...row } : row;
      const freshRow = rowWithCentralContact(mergedRow);
      items = proposalItemsWithFallback(items, freshRow);
      const isSentLocked = isProposalSentLocked(freshRow);
      if (isSentLocked && proposalHasFinalPdf(freshRow) && options.forceLivePreview !== true) {
        await openProposalFinalPdf(freshRow);
        return;
      }
      const lockedPreviewHtml = isSentLocked ? proposalLockedPreviewHtml(freshRow) : '';
      const templateSections = filterTemplateSectionsForGroup(proposalTemplateSections, freshRow.activity_type_group);
      document.getElementById('pa-preview-overlay')?.remove();
      const overlay = document.createElement('div');
      overlay.id = 'pa-preview-overlay';
      overlay.className = 'proposal-preview-overlay';
      overlay.setAttribute('dir', 'rtl');
      const clientLabel = [freshRow.client_authority, freshRow.school_framework].filter(Boolean).map(escapeHtml).join(' — ');
      const saveBtnHtml = '';
      const signingMode = options.signatureMode === true;
      const freshNormalizedStatus = normalizeProposalStatus(freshRow.status);
      const freshIsApprovedOrSent = freshNormalizedStatus === 'approved' || freshNormalizedStatus === 'sent';
      const freshHasSavedSig = proposalHasSavedApprovalSignature(freshRow);
      const canApproveFromPreview = !signingMode && freshNormalizedStatus === 'pending_approval' && !freshHasSavedSig && canApproveProposalsAgreements(state) && text(freshRow.id);
      const submitBtnHtml = options.onSubmit ? `<button type="button" class="ds-btn ds-btn--primary ds-btn--sm no-print" id="pa-preview-submit">${escapeHtml(options.submitLabel || 'שליחה לאישור')}</button>` : '';
      const approvePreviewBtnHtml = canApproveFromPreview ? '<button type="button" class="ds-btn ds-btn--primary ds-btn--sm no-print" id="pa-preview-approve-sign">אישור וחתימה</button>' : '';
      const hasCustomSections = Array.isArray(freshRow.custom_document_sections) && freshRow.custom_document_sections.length > 0;
      const missingTemplateNotice = (!templateSections.length && !hasCustomSections && !isTourProposalGroup(freshRow.activity_type_group))
        ? '<p class="ds-pa-template-missing-notice no-print" role="alert" style="margin:6px 0 0;color:#b45309;font-size:0.85rem">לא נמצאה תבנית פעילה לסוג הצעה זה</p>'
        : '';
      // Admin-only notice (never printed) when the proposal has no saved item rows.
      const missingItemsNotice = (!Array.isArray(items) || !items.length)
        ? '<p class="ds-pa-no-items-notice no-print" role="alert" style="margin:6px 0 0;color:#b45309;font-size:0.85rem">לא נשמרו שורות פעילות להצעה זו</p>'
        : '';
      const legacyNotice = isSentLocked && !lockedPreviewHtml && !proposalHasFinalPdf(freshRow)
        ? `<p class="ds-pa-legacy-sent-notice no-print" role="status" style="margin:6px 0 0;color:#92400e;font-size:0.85rem">לא נמצא PDF סופי — מוצגת תצוגה מתוך הנתונים הקיימים.</p>`
        : '';
      const lockedNotice = isSentLocked && lockedPreviewHtml
        ? '<p class="ds-pa-locked-view-notice no-print" role="status" style="margin:6px 0 0;color:#1d4ed8;font-size:0.85rem">מוצג מסמך נעול שנשמר בעת השליחה — לא תצוגה חיה מתבנית Supabase.</p>'
        : '';
      const showPrintBtn = !isSentLocked || (!lockedPreviewHtml && !proposalHasFinalPdf(freshRow));
      overlay.innerHTML = `
        <div class="proposal-preview-toolbar no-print">
          <button type="button" class="ds-btn ds-btn--sm no-print" id="pa-preview-close">← חזרה</button>
          ${saveBtnHtml}
          ${submitBtnHtml}
          ${approvePreviewBtnHtml}
          ${signingMode ? '<button type="button" class="ds-btn ds-btn--primary ds-btn--sm no-print" id="pa-signature-confirm">אישור וחתימה</button><button type="button" class="ds-btn ds-btn--sm ds-btn--ghost no-print" id="pa-signature-cancel">ביטול</button>' : ''}
          ${showPrintBtn ? '<button type="button" class="ds-btn ds-btn--sm no-print" id="pa-print-btn">הדפסה / שמירה כ-PDF</button>' : ''}
          ${isSentLocked && proposalHasFinalPdf(freshRow) ? '<button type="button" class="ds-btn ds-btn--sm no-print" id="pa-view-final-pdf-btn">צפייה ב־PDF שנשלח</button>' : ''}
          <span class="ds-pa-preview-client no-print">${clientLabel}</span>
          ${legacyNotice}
          ${lockedNotice}
          ${missingTemplateNotice}
          ${missingItemsNotice}
        </div>
        <div class="proposal-preview-area">
          ${lockedPreviewHtml || proposalPreviewBodyHtml(freshRow, items, templateSections, signingMode ? { showSignatureImage: true } : {})}
        </div>`;
      document.body.appendChild(overlay);
      document.body.classList.add('is-print-preview');
      const previousDocumentTitle = document.title;
      document.title = proposalPdfDocumentTitle(freshRow);
      const readSignatureMeta = () => defaultSignatureMeta();
      if (options.form) options.form.dataset.paPreviewSeen = 'yes';
      if (options.autoPrint) {
        requestAnimationFrame(() => setTimeout(() => {
          document.title = proposalPdfDocumentTitle(freshRow);
          window.print();
        }, 150));
      }
      const printButton = overlay.querySelector('#pa-print-btn');
      printButton?.addEventListener('click', () => {
        document.title = proposalPdfDocumentTitle(freshRow);
        window.print();
      });
      overlay.querySelector('#pa-view-final-pdf-btn')?.addEventListener('click', () => openProposalFinalPdf(freshRow));
      const closeOverlay = () => {
        overlay.remove();
        document.body.classList.remove('is-print-preview');
        document.title = previousDocumentTitle;
      };
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
    const saveForm = async (form, statusOverride, signatureMeta = null) => {
      const errorEl = form.querySelector('[data-pa-form-error]');
      if (form.dataset.saving === 'yes') return;
      form.dataset.saving = 'yes';
      const allBtns = form.querySelectorAll('button');
      allBtns.forEach((b) => { b.disabled = true; });
      const payload = payloadFromForm(form);
      // Always set status explicitly — 'draft' is the safe default
      const targetStatus = statusOverride || 'draft';
      const approvingWithSignature = targetStatus === 'approved';
      payload.status = approvingWithSignature ? 'pending_approval' : targetStatus;
      if (signatureMeta && typeof signatureMeta === 'object' && !approvingWithSignature) payload.signature_meta = signatureMeta;
      const isPending = targetStatus === 'sent' || targetStatus === 'pending_approval';

      const validationErrors = validatePayload(payload, targetStatus, { canAddManualCourseWithoutGefen: userRole(state) === 'admin' });
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
        console.info('[proposal-save-payload]', {
          activity_type_group: payload.activity_type_group,
          activity_names: payload.activity_names,
          total_amount: payload.total_amount
        });
        const result = mode === 'edit'
          ? await api.updateProposalAgreement(id, payload)
          : await api.addProposalAgreement(payload);
        const savedId = text(result?.row?.id || id);
        const items = Array.isArray(payload._items) ? payload._items : filterItemsByProposalType(extractItemsFromForm(form), payload.activity_type_group);
        if (savedId && typeof api.saveProposalAgreementItems === 'function') {
          console.debug('[PA_SAVE_ITEMS]', { savedId, activity_type_group: payload.activity_type_group, items });
          await api.saveProposalAgreementItems(savedId, items);
        }
        let finalRow = result?.row || { ...payload, id: savedId };
        if (approvingWithSignature && savedId) {
          const approval = await api.updateProposalAgreementStatus(savedId, 'approved', '', signatureMeta || defaultSignatureMeta());
          finalRow = approval?.row || { ...finalRow, status: 'approved', signature_meta: signatureMeta || defaultSignatureMeta(), approved_at: new Date().toISOString() };
          showToast('ההצעה אושרה ונחתמה', 'success');
        } else if (targetStatus === 'pending_approval') {
          showToast('ההצעה נשמרה ונשלחה לאישור', 'success');
        } else if (targetStatus === 'draft') {
          showToast('הטיוטה נשמרה בהצלחה', 'success');
        }
        replaceLocalRow(data, finalRow);
        resetLocalFilters();
        switchTab('records');
        highlightProposalRow(savedId);
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
        const compactQty = itemRow.querySelector('[data-pa-item-compact-qty]');
        if (compactQty) compactQty.textContent = `כמות: ${text(itemRow.querySelector('[data-pa-item-qty]')?.value) || '1'}`;
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
                replaceLocalRow(data, result?.row || { id, status: 'approved', approval_note: '', signature_meta: signatureMeta, updated_at: new Date().toISOString() });
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
        if (newStatus === 'sent') {
          rowStatusSelect.value = previousStatus;
          const row = data.rows.find((r) => text(r.id) === id);
          if (!row || !canTransitionProposalStatus(row, 'sent', state)) {
            showToast('אין הרשאה או שהמעבר אינו מותר בסטטוס הנוכחי.', 'error');
            return;
          }
          let items = [];
          try { if (typeof api.readProposalAgreementItems === 'function') items = await api.readProposalAgreementItems(id); } catch { items = []; }
          await openSendProposalDialog(row, items);
          return;
        }
        rowStatusSelect.disabled = true;
        try {
          const result = await api.updateProposalAgreementStatus(id, newStatus, '');
          replaceLocalRow(data, result?.row || { id, status: newStatus, approval_note: '', updated_at: new Date().toISOString() });
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
          const itemRow = sel.closest('[data-pa-item-row]');
          const rowGroup = text(itemRow?.dataset?.paRowGroup);
          const currentVal = text(sel.value);
          sel.innerHTML = buildPricingSelectOptionsHtml(filteredPricing, currentVal, {
            allowManualCourse: formAllowsManualCourse(form),
            groupKey: rowGroup
          });
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
      if (!itemRow) return;
      const bundlePrompt = itemRow.querySelector('[data-pa-bundle-prompt]');
      if (selectedKey === MANUAL_COURSE_OPTION_KEY) {
        if (!formAllowsManualCourse(form)) return;
        applyManualCourseToRow(itemRow, form);
        return;
      }
      setManualCourseNameFieldActive(itemRow, false);
      const itemTypeInput = itemRow?.querySelector?.('[name="item_type"]');
      const picked = resolvePricingRow({
        optionKey: selectedKey,
        activityNo: selectedKey,
        activityName: selectedKey,
        itemType: itemTypeInput?.value
      });
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
                <span class="ds-pa-bundle-child-price">${unitPrice != null && unitPrice > 0 ? `₪ ${escapeHtml(formatCurrency(unitPrice))}` : '—'}</span>
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
      const compactName = itemRow.querySelector('[data-pa-item-compact-name]');
      if (compactName) {
        compactName.textContent = publicActivityName(picked.activity_name) || 'בחרו פעילות';
        compactName.title = publicActivityName(picked.activity_name) || '';
      }
      const compactQty = itemRow.querySelector('[data-pa-item-compact-qty]');
      if (compactQty) compactQty.textContent = `כמות: ${text(itemRow.querySelector('[data-pa-item-qty]')?.value) || '1'}`;
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

    root.addEventListener('submit', async (event) => {

      const drawerContactForm = event.target.closest?.('[data-pa-drawer-contact-form]');
      if (drawerContactForm && event.type === 'submit') {
        event.preventDefault();
        const msg = drawerContactForm.querySelector('[data-pa-contact-update-msg]');
        const sourceId = text(drawerContactForm.dataset.paContactSourceId);
        const sourceTable = text(drawerContactForm.dataset.paContactSourceTable) || 'contacts_schools';
        if (!sourceId) {
          if (msg) msg.textContent = 'לא נמצא איש קשר קיים לעדכון.';
          return;
        }
        const fields = {
          contact_name: text(drawerContactForm.querySelector('[name="contact_name"]')?.value),
          contact_role: text(drawerContactForm.querySelector('[name="contact_role"]')?.value),
          email: text(drawerContactForm.querySelector('[name="email"]')?.value),
          phone: text(drawerContactForm.querySelector('[name="phone"]')?.value),
          mobile: text(drawerContactForm.querySelector('[name="phone"]')?.value)
        };
        try {
          if (msg) msg.textContent = 'שומר...';
          await api.updateUnifiedContactRecord({ source_table: sourceTable, source_id: sourceId, fields });
          const openId = text(drawerContactForm.closest('[data-pa-drawer]')?.dataset?.paDrawerId);
          const existing = data.rows.find((item) => text(item.id) === openId);
          if (existing) {
            existing.contact_name = fields.contact_name;
            existing.contact_role = fields.contact_role;
            existing.email = fields.email;
            existing.phone = fields.phone;
          }
          const contactMatch = contactOptions.find((c) => text(c.id) === sourceId && text(c.source_table || 'contacts_schools') === sourceTable);
          if (contactMatch) {
            contactMatch.contact_name = fields.contact_name;
            contactMatch.contact_role = fields.contact_role;
            contactMatch.email = fields.email;
            contactMatch.phone = fields.phone;
            contactMatch.mobile = fields.mobile;
          }
          if (msg) msg.textContent = 'פרטי איש הקשר עודכנו.';
          if (existing) drawerContactForm.closest('[data-pa-drawer]').outerHTML = drawerHtml(normalizeProposalAgreementRow(existing), activityNameOptions, state);
          refreshTable();
          showToast('פרטי איש הקשר עודכנו', 'success', 1800);
        } catch (err) {
          if (msg) msg.textContent = `שגיאה בעדכון איש קשר: ${err?.message || err}`;
        }
        return;
      }
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
            const isSel = text(btn.dataset.paTypeBtn) === val;
            btn.classList.toggle('is-selected', isSel);
            btn.style.border = `1.5px solid ${isSel ? '#6366f1' : '#d1d5db'}`;
            btn.style.background = isSel ? '#eef2ff' : '#f9fafb';
            btn.style.color = isSel ? '#4f46e5' : '#374151';
            btn.style.fontWeight = isSel ? '600' : '400';
          });
          typeInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return;
      }

      // Row click — skip if clicking an inline action button inside the row
      const rowEl = !event.target.closest?.('[data-pa-preview],[data-pa-view-final-pdf],[data-pa-edit-row],[data-pa-print],[data-pa-delete-row],[data-pa-clone-row],[data-pa-row-more],[data-pa-status-action],.ds-pa-row-more')
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
              const items = proposalItemsWithFallback(await api.readProposalAgreementItems(text(row.id)), row);
              if (itemsHost.isConnected) {
                itemsHost.innerHTML = itemsSummaryHtml(items);
                const hasActiveItems = (Array.isArray(items) ? items : []).filter(hasMeaningfulProposalItemValue).filter((i) => !isTestHoursItem(i)).length > 0;
                const fallback = newDrawer?.querySelector('[data-pa-activities-fallback]');
                if (fallback && hasActiveItems) fallback.hidden = true;
              }
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
        if (editTargetRow && !isProposalEditable(editTargetRow, state)) {
          showToast('ההצעה נעולה לעריכה בסטטוס הנוכחי. ניתן לערוך רק טיוטה או הצעה שהוחזרה לתיקון.', 'warning');
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
        if (!row || !isProposalEditable(row, state)) {
          showToast('עריכת מסמך זמינה רק לטיוטה או להצעה שהוחזרה לתיקון.', 'warning');
          return;
        }
        if (normalizeProposalStatus(text(row.status)) === 'sent') {
          showToast('הצעה שנשלחה נעולה ולא ניתן לערוך אותה.', 'error');
          return;
        }
        const templateSections = filterTemplateSectionsForGroup(proposalTemplateSections, row.activity_type_group);
        const workingSections = resolveDocumentSections(row, templateSections).map((section) => ({
          section_key: proposalTextField(section, 'section_key', 'sectionKey'),
          section_title: proposalTextField(section, 'section_title', 'sectionTitle'),
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
        const templateSections = filterTemplateSectionsForGroup(proposalTemplateSections, row.activity_type_group);
        const sections = templateSections.map((section) => ({
          section_key: proposalTextField(section, 'section_key', 'sectionKey'),
          section_title: proposalTextField(section, 'section_title', 'sectionTitle'),
          section_body: normalizeMultilineText(Array.from(wrap.querySelectorAll('[data-pa-doc-body]')).find((el) => text(el.dataset.paDocBody) === proposalTextField(section, 'section_key', 'sectionKey'))?.value)
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
        await openPreview(row, proposalItemsWithFallback(items, row));
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
        await openPreview(row, proposalItemsWithFallback(items, row), { autoPrint: true });
        return;
      }

      const statusActionBtn = event.target.closest?.('[data-pa-status-action]');
      if (statusActionBtn) {
        if (!canManage) return;
        const newStatus = text(statusActionBtn.dataset.paStatusAction);
        const id = text(statusActionBtn.dataset.paActionId);
        if (!newStatus || !id) return;
        const currentActionRow = data.rows.find((r) => text(r.id) === id);
        const currentActionStatus = normalizeProposalStatus(currentActionRow?.status);
        if (currentActionStatus === 'cancelled') {
          showToast('הצעה שבוטלה נעולה. ניתן למחוק אותה או לשכפל להצעה חדשה.', 'error');
          return;
        }
        if (!currentActionRow || !canTransitionProposalStatus(currentActionRow, newStatus, state)) {
          showToast('אין הרשאה או שהמעבר אינו מותר בסטטוס הנוכחי.', 'error');
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
                replaceLocalRow(data, result?.row || { id, status: 'approved', approval_note: '', signature_meta: signatureMeta, updated_at: new Date().toISOString() });
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
        if (newStatus === 'sent') {
          const row = data.rows.find((r) => text(r.id) === id);
          if (!row) return;
          let items = [];
          try { if (typeof api.readProposalAgreementItems === 'function') items = await api.readProposalAgreementItems(id); } catch { items = []; }
          await openSendProposalDialog(row, items);
          statusActionBtn.disabled = false;
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
          replaceLocalRow(data, result?.row || { id, status: newStatus, approval_note: '', updated_at: new Date().toISOString() });
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

      const viewFinalPdfBtn = event.target.closest?.('[data-pa-view-final-pdf]');
      if (viewFinalPdfBtn) {
        const id = text(viewFinalPdfBtn.dataset.paViewFinalPdf);
        const row = data.rows.find((r) => text(r.id) === id);
        if (!row) return;
        viewFinalPdfBtn.disabled = true;
        await openProposalFinalPdf(row);
        viewFinalPdfBtn.disabled = false;
        return;
      }

      const legacyPdfUploadBtn = event.target.closest?.('[data-pa-legacy-pdf-upload-btn]');
      if (legacyPdfUploadBtn) {
        if (!canManage) return;
        const id = text(legacyPdfUploadBtn.dataset.paLegacyPdfId);
        const row = data.rows.find((r) => text(r.id) === id);
        const wrap = legacyPdfUploadBtn.closest('[data-pa-legacy-pdf-upload]');
        const fileInput = wrap?.querySelector('[data-pa-legacy-pdf-input]');
        const errorEl = wrap?.querySelector('[data-pa-legacy-pdf-error]');
        const pdfFile = fileInput?.files?.[0] || null;
        if (!row || !pdfFile) {
          if (errorEl) errorEl.textContent = 'יש לבחור קובץ PDF.';
          return;
        }
        if (typeof api.uploadLegacyProposalFinalPdf !== 'function') {
          if (errorEl) errorEl.textContent = 'העלאת PDF אינה זמינה.';
          return;
        }
        legacyPdfUploadBtn.disabled = true;
        try {
          const result = await api.uploadLegacyProposalFinalPdf(id, { pdfFile });
          replaceLocalRow(data, result?.row || row);
          refreshTable();
          const updated = data.rows.find((item) => text(item.id) === id);
          const drawer = root.querySelector('[data-pa-drawer]');
          if (drawer && updated) drawer.outerHTML = drawerHtml(updated, activityNameOptions, state);
          showToast('PDF סופי נשמר בהצלחה', 'success');
        } catch (err) {
          legacyPdfUploadBtn.disabled = false;
          if (errorEl) errorEl.textContent = `שגיאה בהעלאה: ${err?.message || err}`;
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
          replaceLocalRow(data, result?.row || { id, status: 'returned_for_changes', approval_note: note, updated_at: new Date().toISOString() });
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
      const addTourComponentBtn = event.target.closest?.('[data-pa-add-tour-component]');
      if (addTourComponentBtn) {
        const details = addTourComponentBtn.closest('[data-pa-tour-details]');
        const form = addTourComponentBtn.closest('[data-pa-form]');
        const body = details?.querySelector('[data-pa-tour-components-body]');
        if (!body) return;
        const idx = body.querySelectorAll('[data-pa-tour-component-row]').length;
        const tmp = document.createElement('div');
        tmp.innerHTML = tourCostComponentEditorRowHtml({ component_type: 'class', label: 'כיתה / קבוצה', unit_price: 0, quantity: 1 }, idx);
        body.appendChild(tmp.firstElementChild);
        if (form) calcGrandTotal(form);
        body.querySelector('[data-pa-tour-component-row]:last-child [data-pa-tour-component-price]')?.focus();
        return;
      }

      const removeTourComponentBtn = event.target.closest?.('[data-pa-remove-tour-component]');
      if (removeTourComponentBtn) {
        const form = removeTourComponentBtn.closest('[data-pa-form]');
        removeTourComponentBtn.closest('[data-pa-tour-component-row]')?.remove();
        if (form) calcGrandTotal(form);
        if (form) updateProposalStepper(form);
        return;
      }

      if (addItemBtn) {
        const form = addItemBtn.closest('[data-pa-form]');
        if (addItemBtn.disabled || addItemBtn.getAttribute('aria-disabled') === 'true') return;
        const groupKey = text(addItemBtn.dataset.paAddItemGroup);
        const groupSection = groupKey ? form?.querySelector(`[data-pa-items-group="${groupKey}"]`) : null;
        const tbody = groupSection?.querySelector('[data-pa-items-body]') || form?.querySelector('[data-pa-items-body]');
        if (!tbody) return;
        const idx = form ? form.querySelectorAll('[data-pa-item-row]').length : 0;
        const tmp = document.createElement('div');
        const currentType = text(form?.querySelector('[name="activity_type_group"]')?.value);
        if (!normalizeProposalGroup(currentType)) return;
        const rowGroup = groupKey || currentType;
        const basePricing = filterPricingByProposalType(proposalActivityPricing, rowGroup || currentType);
        const rowPricing = basePricing;
        const allowManualCourse = formAllowsManualCourse(form);
        tmp.innerHTML = itemRowHtml({ proposal_group: rowGroup }, idx, rowPricing, { groupKey: rowGroup, allowManualCourse });
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
        const hasMeaningfulRowData = itemRow && [
          '[name="item_name"]',
          '[name="pricing_activity_name"]',
          '[name="gefen_number"]',
          '[name="unit_price"]',
          '[name="total_price"]'
        ].some((selector) => text(itemRow.querySelector(selector)?.value));
        if (hasMeaningfulRowData) {
          const ok = window.confirm?.('למחוק את השורה?') ?? true;
          if (!ok) return;
        }
        if (itemRow) itemRow.remove();
        if (form) calcGrandTotal(form);
        if (form) updateProposalStepper(form);
        if (form) updateLivePreview(form);
        return;
      }

      const savePendingBtn = event.target.closest?.('[data-pa-save-pending]');
      if (savePendingBtn) {
        const form = savePendingBtn.closest('[data-pa-form]');
        if (!form) return;
        const targetStatus = text(savePendingBtn.dataset.paTargetStatus) || 'sent';
        const submitLabel = targetStatus === 'approved' ? 'חתום ואשר' : 'שליחה לאישור';
        const payload = payloadFromForm(form);
        const tempRow = { ...payload, id: text(form.dataset.paId) || '' };
        const items = payload._items || [];
        if (targetStatus === 'approved') {
          // Admin flow — always show preview with signature mode; save only after signing
          form.dataset.paPreviewSeen = 'yes';
          try {
            await openPreview(tempRow, items, {
              form,
              signatureMode: true,
              onSignatureConfirm: async (signatureMeta, closeOverlay) => {
                try {
                  await saveForm(form, 'approved', signatureMeta);
                  closeOverlay?.();
                } catch (e) {
                  console.warn('[PA] saveForm error (approved flow):', e);
                }
              }
            });
          } catch (e) {
            console.warn('[PA] openPreview error (approved flow):', e);
          }
        } else {
          // Preview is an optional helper only. Sending for approval must persist immediately,
          // regardless of whether the user opened the preview before clicking the primary action.
          form.dataset.paPreviewSeen = 'yes';
          await saveForm(form, targetStatus);
        }
        return;
      }

      const deleteBtn = event.target.closest?.('[data-pa-delete-row]');
      if (deleteBtn) {
        const id = text(deleteBtn.dataset.paDeleteRow);
        const row = data.rows.find((item) => text(item.id) === id);
        if (!row) return;
        if (!['draft', 'cancelled'].includes(normalizeProposalStatus(row.status))) {
          window.alert('ניתן למחוק רק הצעה בטיוטה או הצעה שבוטלה');
          return;
        }
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
          console.info('[proposal-save-payload]', {
            activity_type_group: clonePayload.activity_type_group,
            activity_names: clonePayload.activity_names,
            total_amount: clonePayload.total_amount
          });
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

      if (event.target.closest?.('[data-pa-add-contact-toggle]')) {
        const form = event.target.closest('[data-pa-form]');
        if (!form) return;
        lockClientFields(
          form,
          text(form.querySelector('input[name="contact_source_authority"]')?.value),
          text(form.querySelector('input[name="contact_source_school"]')?.value),
          '', '', '', '',
          text(form.querySelector('input[name="contact_source_client_name"]')?.value)
        );
        showManualContactFields(form);
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
        const roCtxUnlock = form.querySelector('[data-pa-contact-ro-ctx]');
        if (roCtxUnlock) roCtxUnlock.hidden = true;
        const pickerHost = form.querySelector('[data-pa-contact-picker-host]');
        if (pickerHost) pickerHost.innerHTML = '';
        resetClientSearchPanels(form);
        applyClientSearchMode(form);
        applyRecipientTypeMode(form);
        updateProposalStepper(form);
        form.querySelector('[data-pa-client-search-input]')?.focus();
        return;
      }

      if (event.target.closest?.('[data-pa-change-authority-step]')) {
        const form = event.target.closest('[data-pa-form]');
        if (!form) return;
        resetClientSearchPanels(form);
        applyClientSearchMode(form);
        applyRecipientTypeMode(form);
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
        const roCtxClear = form.querySelector('[data-pa-contact-ro-ctx]');
        if (roCtxClear) roCtxClear.hidden = true;
        const pickerHost = form.querySelector('[data-pa-contact-picker-host]');
        if (pickerHost) pickerHost.innerHTML = '';
        resetClientSearchPanels(form);
        applyClientSearchMode(form);
        applyRecipientTypeMode(form);
        updateProposalStepper(form);
        form.querySelector('[data-pa-client-search-input]')?.focus();
        return;
      }

      if (event.target.closest?.('[data-pa-authority-only]')) {
        const form = event.target.closest('[data-pa-form]');
        if (!form) return;
        const authorityId = form.dataset.paAuthorityId || '';
        const authorityName = form.dataset.paAuthorityName || '';
        applyContactSelectionAfterClient(form, {
          authority: authorityName,
          school: '',
          authorityId,
          schoolId: '',
          clientType: 'authority',
          clientName: authorityName
        });
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
