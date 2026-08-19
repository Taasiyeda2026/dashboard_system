export const FINANCE_UNFUNDED_PAYER_LABEL = 'ללא גורם מימון';
export const FINANCE_COLLECTION_OPEN = 'open';
export const FINANCE_COLLECTION_CLOSED = 'closed';

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

export function financePayerKey(row = {}) {
  const funding = primaryFunding(row);
  if (!funding.name && !funding.id) {
    return {
      key: 'unfunded',
      kind: 'unfunded',
      id: '',
      label: FINANCE_UNFUNDED_PAYER_LABEL
    };
  }
  if (isGefenFunding(funding.name)) {
    const schoolId = txt(row.school_id || row.semel_mosad);
    const label = txt(row.school) || 'בית ספר ללא שם';
    return {
      key: `school:${schoolId || compactToken(label)}`,
      kind: 'school',
      id: schoolId,
      label
    };
  }
  if (isAuthorityFunding(funding.name)) {
    const authorityId = txt(row.authority_id);
    const label = txt(row.authority) || 'רשות ללא שם';
    return {
      key: `authority:${authorityId || compactToken(label)}`,
      kind: 'authority',
      id: authorityId,
      label
    };
  }
  const label = funding.name || 'גורם מימון';
  return {
    key: `funding:${funding.id || compactToken(label)}`,
    kind: 'funding',
    id: funding.id,
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

export function groupFinanceCollectionPayers(activities = [], { tab = 'open' } = {}) {
  const wantOpenOnly = tab !== 'all';
  const groups = new Map();
  for (const activity of activities || []) {
    const status = normalizeCollectionStatus(activity.collection_status);
    if (wantOpenOnly && status !== FINANCE_COLLECTION_OPEN) continue;
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
