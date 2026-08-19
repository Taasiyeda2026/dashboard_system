import { getActivityDateColumns } from './shared/format-date.js';

export const FINANCE_UNFUNDED_PAYER_LABEL = 'ללא גורם מימון';
export const FINANCE_COLLECTION_OPEN = 'open';
export const FINANCE_COLLECTION_CLOSED = 'closed';
export const FINANCE_COLLECTION_TAB_OPEN = 'open';
export const FINANCE_COLLECTION_TAB_CLOSED = 'closed';
export const FINANCE_COLLECTION_TAB_ALL = 'all';
export const FINANCE_COLLECTION_TAB_NO_END_DATE = 'no_end_date';
export const FINANCE_NO_END_DATE_MONTH_KEY = '__no_end_date__';
export const FINANCE_NO_END_DATE_MONTH_LABEL = 'ללא תאריך סיום';

const txt = (value) => String(value ?? '').trim();

export function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(txt(value).replace(/[₪,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function money(value) {
  const amount = num(value);
  if (!amount) return '—';
  return `₪${amount.toLocaleString('he-IL', { maximumFractionDigits: 0 })}`;
}

function compactToken(value) {
  return txt(value)
    .normalize('NFKC')
    .replace(/["'`׳״]/g, '')
    .replace(/[\s_\-./\\]+/g, '')
    .toLowerCase();
}

function normalizeIsoDate(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(txt(value));
  return match ? match[1] : '';
}

export function isGefenFunding(value) {
  const token = compactToken(value);
  return token === 'גפן' || token === 'gefen' || token === 'gafan';
}

export function isAuthorityFunding(value) {
  const token = compactToken(value);
  return token === 'רשות' || token === 'authority';
}

export function activityRowId(row = {}) {
  return txt(row.row_id || row.RowID || row.source_row_id);
}

export function mapLegacyPaymentCollected(value) {
  const raw = txt(value).toLowerCase();
  if (raw === 'yes' || raw === 'true' || raw === '1' || raw === 'נגבה') return FINANCE_COLLECTION_CLOSED;
  return FINANCE_COLLECTION_OPEN;
}

export function normalizeCollectionStatus(value) {
  return txt(value).toLowerCase() === FINANCE_COLLECTION_CLOSED
    ? FINANCE_COLLECTION_CLOSED
    : FINANCE_COLLECTION_OPEN;
}

export function normalizeFinanceCollectionTab(value) {
  const tab = txt(value).toLowerCase();
  if (tab === FINANCE_COLLECTION_TAB_CLOSED) return FINANCE_COLLECTION_TAB_CLOSED;
  if (tab === FINANCE_COLLECTION_TAB_ALL) return FINANCE_COLLECTION_TAB_ALL;
  if (tab === FINANCE_COLLECTION_TAB_NO_END_DATE) return FINANCE_COLLECTION_TAB_NO_END_DATE;
  return FINANCE_COLLECTION_TAB_OPEN;
}

export function financeActivityEndDate(row = {}) {
  const endDate = normalizeIsoDate(row.end_date ?? row.date_end);
  const latestMeeting = getActivityDateColumns(row).reduce((max, dateKey) => (
    !max || dateKey > max ? dateKey : max
  ), '');
  return endDate || latestMeeting || '';
}

export function financeActivityEndMonthKey(row = {}) {
  const endDate = financeActivityEndDate(row);
  return endDate ? endDate.slice(0, 7) : FINANCE_NO_END_DATE_MONTH_KEY;
}

function primaryFunding(row = {}) {
  const sources = Array.isArray(row.funding_sources) ? row.funding_sources : [];
  const first = sources.find((item) => item && (item.id || item.funding_source_id || item.name));
  if (first) {
    return {
      id: txt(first.id || first.funding_source_id),
      name: txt(first.name || row.funding)
    };
  }
  return {
    id: txt(row.funding_id || row.funding_source_id),
    name: txt(row.funding)
  };
}

function normalizeStableId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  return raw || '';
}

function rowFundingName(row = {}) {
  const direct = txt(row.funding);
  if (direct) return direct;
  return txt(primaryFunding(row).name);
}

function isRowGefenFunding(row = {}) {
  return isGefenFunding(rowFundingName(row));
}

function isRowAuthorityFunding(row = {}) {
  return isAuthorityFunding(rowFundingName(row));
}

function pickPayerLabel(current = '', candidate = '') {
  const left = txt(current);
  const right = txt(candidate);
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

export function financePayerKey(row = {}) {
  const funding = primaryFunding(row);
  const fundingName = rowFundingName(row) || funding.name;
  if (!fundingName && !funding.id) {
    return {
      key: 'unfunded',
      kind: 'unfunded',
      id: '',
      label: FINANCE_UNFUNDED_PAYER_LABEL
    };
  }
  if (isRowGefenFunding(row)) {
    const schoolId = normalizeStableId(row.school_id ?? row.semel_mosad ?? row.single_school_id);
    const label = txt(row.school || row.single_school_name) || 'בית ספר ללא שם';
    return {
      key: schoolId ? `school:id:${schoolId}` : `school:name:${compactToken(label)}`,
      kind: 'school',
      id: schoolId,
      label
    };
  }
  if (isRowAuthorityFunding(row)) {
    const authorityId = normalizeStableId(row.authority_id);
    const label = txt(row.authority) || 'רשות ללא שם';
    return {
      key: authorityId ? `authority:id:${authorityId}` : `authority:name:${compactToken(label)}`,
      kind: 'authority',
      id: authorityId,
      label
    };
  }
  const fundingId = normalizeStableId(funding.id || row.funding_id || row.funding_source_id);
  const label = fundingName || 'גורם מימון';
  return {
    key: fundingId ? `funding:id:${fundingId}` : `funding:name:${compactToken(label)}`,
    kind: 'funding',
    id: fundingId,
    label
  };
}

export function trackingByActivityId(trackingRows = []) {
  const map = new Map();
  for (const row of trackingRows || []) {
    const id = activityRowId(row) || txt(row.activity_row_id);
    if (!id) continue;
    map.set(id, row);
  }
  return map;
}

export function attachCollectionTracking(activities = [], trackingRows = []) {
  const tracking = trackingByActivityId(trackingRows);
  return (activities || []).map((activity) => {
    const id = activityRowId(activity);
    const rec = tracking.get(id);
    return {
      ...activity,
      collection_status: rec ? normalizeCollectionStatus(rec.collection_status) : FINANCE_COLLECTION_OPEN,
      expected_collection_date: rec?.expected_collection_date || '',
      finance_note: rec?.finance_note || ''
    };
  });
}

export function activityStatusLabel(row = {}) {
  return txt(row.status) || '—';
}

function financeCollectionSearchText(value) {
  return txt(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[׳״'"`´’‘“”.,;:()\[\]{}\-_/\\\u05BE\u2010-\u2015]/g, '')
    .replace(/\s+/g, '');
}

export function financeCollectionSearchHaystack(activity = {}) {
  const payer = financePayerKey(activity);
  return financeCollectionSearchText([
    activity.activity_name,
    activity.authority,
    activity.school,
    activity.funding,
    payer.label
  ].filter(Boolean).join(' '));
}

export function filterFinanceCollectionActivities(activities = [], { tab = FINANCE_COLLECTION_TAB_OPEN, search = '' } = {}) {
  const normalizedTab = normalizeFinanceCollectionTab(tab);
  const query = financeCollectionSearchText(search);
  return (activities || []).filter((activity) => {
    const status = normalizeCollectionStatus(activity.collection_status);
    const hasEndDate = financeActivityEndMonthKey(activity) !== FINANCE_NO_END_DATE_MONTH_KEY;
    if (normalizedTab === FINANCE_COLLECTION_TAB_OPEN && status !== FINANCE_COLLECTION_OPEN) return false;
    if (normalizedTab === FINANCE_COLLECTION_TAB_CLOSED && status !== FINANCE_COLLECTION_CLOSED) return false;
    if (normalizedTab === FINANCE_COLLECTION_TAB_NO_END_DATE && hasEndDate) return false;
    if (query && !financeCollectionSearchHaystack(activity).includes(query)) return false;
    return true;
  });
}

export function summarizeFinanceCollectionTotals(activities = []) {
  let totalAmount = 0;
  let openAmount = 0;
  let closedAmount = 0;
  let openCount = 0;
  let closedCount = 0;
  for (const activity of activities || []) {
    const price = num(activity.price ?? activity.amount ?? activity.activity_price);
    totalAmount += price;
    if (normalizeCollectionStatus(activity.collection_status) === FINANCE_COLLECTION_CLOSED) {
      closedAmount += price;
      closedCount += 1;
    } else {
      openAmount += price;
      openCount += 1;
    }
  }
  return {
    totalAmount,
    openAmount,
    closedAmount,
    activityCount: (activities || []).length,
    openCount,
    closedCount
  };
}

export function groupFinanceCollectionPayers(activities = [], { tab = FINANCE_COLLECTION_TAB_OPEN } = {}) {
  const filtered = filterFinanceCollectionActivities(activities, { tab, search: '' });
  const groups = new Map();
  for (const activity of filtered) {
    const status = normalizeCollectionStatus(activity.collection_status);
    const payer = financePayerKey(activity);
    let group = groups.get(payer.key);
    if (!group) {
      group = {
        key: payer.key,
        kind: payer.kind,
        id: payer.id,
        label: payer.label,
        activities: [],
        totalAmount: 0,
        openCount: 0
      };
      groups.set(payer.key, group);
    }
    group.label = pickPayerLabel(group.label, payer.label);
    group.activities.push(activity);
    group.totalAmount += num(activity.price ?? activity.amount ?? activity.activity_price);
    if (status === FINANCE_COLLECTION_OPEN) group.openCount += 1;
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      activityCount: group.activities.length
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'he'));
}

export function groupFinanceCollectionByEndMonth(activities = [], { tab = FINANCE_COLLECTION_TAB_OPEN, search = '' } = {}) {
  const filtered = filterFinanceCollectionActivities(activities, { tab, search });
  const monthMap = new Map();
  for (const activity of filtered) {
    const monthKey = financeActivityEndMonthKey(activity);
    let month = monthMap.get(monthKey);
    if (!month) {
      month = { monthKey, activities: [] };
      monthMap.set(monthKey, month);
    }
    month.activities.push(activity);
  }

  const months = [...monthMap.values()]
    .map((month) => ({
      monthKey: month.monthKey,
      payers: groupFinanceCollectionPayers(month.activities, { tab: FINANCE_COLLECTION_TAB_ALL }),
      activityCount: month.activities.length,
      totalAmount: month.activities.reduce((sum, activity) => (
        sum + num(activity.price ?? activity.amount ?? activity.activity_price)
      ), 0)
    }))
    .sort((a, b) => {
      if (a.monthKey === FINANCE_NO_END_DATE_MONTH_KEY) return 1;
      if (b.monthKey === FINANCE_NO_END_DATE_MONTH_KEY) return -1;
      return b.monthKey.localeCompare(a.monthKey);
    });

  return months;
}
