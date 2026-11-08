/** Funding-source edits are a structured request field, not an activities column. */
export function normalizeRequestedFundingSources(value) {
  if (!Array.isArray(value)) throw new Error('invalid_activity_funding_request');
  const result = value.map((item) => {
    const id = String(typeof item === 'string' ? item : (item?.funding_source_id ?? item?.id ?? '')).trim();
    if (!id) throw new Error('invalid_activity_funding_request');
    const rawAmount = typeof item === 'string' ? null : item?.amount;
    const amount = rawAmount === '' || rawAmount == null ? null : Number(rawAmount);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      throw new Error('invalid_activity_funding_amount');
    }
    return { funding_source_id: id, amount };
  });
  if (new Set(result.map((item) => item.funding_source_id)).size !== result.length) {
    throw new Error('duplicate_activity_funding_source');
  }
  return result;
}

export function separateFundingSourceChange(changes = {}) {
  const activityChanges = { ...(changes || {}) };
  if (!Object.prototype.hasOwnProperty.call(activityChanges, 'funding_sources')) {
    return { activityChanges, fundingSources: undefined };
  }
  const fundingSources = normalizeRequestedFundingSources(activityChanges.funding_sources);
  delete activityChanges.funding_sources;
  return { activityChanges, fundingSources };
}

export function displayFundingSourcesForApproval(value, namesById = {}) {
  if (!Array.isArray(value)) return '';
  if (!value.length) return 'ללא גורמי מימון';
  return value.map((item) => {
    const id = String(item?.funding_source_id ?? item?.id ?? '').trim();
    const name = String(namesById[id] || (id ? `גורם מימון ${id}` : 'גורם מימון')).trim();
    const amount = item?.amount === null || item?.amount === undefined || item?.amount === ''
      ? '' : Number(item.amount).toLocaleString('he-IL');
    return amount ? `${name}: ${amount} ₪` : name;
  }).join(' + ');
}
