function catalogText(value) {
  return String(value ?? '').trim();
}

function firstCatalogValue(...values) {
  return values.map(catalogText).find(Boolean) || '';
}

function firstCatalogNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || String(value).trim() === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function catalogIdentityChanges({
  activity_name,
  activity_no,
  gefen_number,
  meetings_count,
  activity_type
} = {}, { normalizeActivityType = catalogText } = {}) {
  const canonicalName = catalogText(activity_name);
  const activityNo = catalogText(activity_no || gefen_number);
  // activity_no is always the catalog identity, but it is not necessarily a
  // Gefen number. Keep an absent Gefen value absent so a switch from a Gefen
  // activity actively clears the previous value in the activity row.
  const gefenNumber = catalogText(gefen_number);
  if (!canonicalName || !activityNo) throw new Error('catalog_activity_not_found');

  const changes = {
    activity_name: canonicalName,
    activity_no: activityNo,
    gefen_number: gefenNumber || null,
    exists_in_gefen: Boolean(gefenNumber),
    activity_name_override: false
  };
  const sessions = firstCatalogNumber(meetings_count);
  if (sessions !== null) changes.sessions = sessions;
  const type = normalizeActivityType(catalogText(activity_type));
  if (type) {
    changes.activity_type = type;
    changes.item_type = type;
  }
  return changes;
}

export function selectedActivityCatalogIdentity(form) {
  const nameSelect = form?.querySelector?.('[data-role="activity-name-select"]');
  const option = nameSelect?.selectedOptions?.[0] || null;
  if (!nameSelect || !option || !catalogText(nameSelect.value)) {
    return { isCatalogSelection: false, activity_name: '', activity_no: '', gefen_number: '', meetings_count: null, activity_type: '' };
  }
  const activityNo = catalogText(option.dataset.activityNo);
  const gefenNumber = catalogText(option.dataset.gefenNumber);
  return {
    isCatalogSelection: Boolean(activityNo || gefenNumber),
    activity_name: catalogText(nameSelect.value),
    activity_no: activityNo,
    gefen_number: gefenNumber,
    meetings_count: firstCatalogNumber(option.dataset.meetingsCount),
    activity_type: catalogText(option.dataset.activityType)
  };
}

export function syncActivityCatalogIdentityFromName(form, { clearWhenNoSelection = false } = {}) {
  const activityNoInput = form?.querySelector?.('[data-activity-no]');
  const gefenNumberInput = form?.querySelector?.('[data-gefen-number]');
  const identity = selectedActivityCatalogIdentity(form);
  if (!identity.activity_name) {
    if (clearWhenNoSelection) {
      if (activityNoInput) activityNoInput.value = '';
      if (gefenNumberInput) gefenNumberInput.value = '';
    }
    return identity;
  }
  if (identity.isCatalogSelection) {
    if (activityNoInput) activityNoInput.value = identity.activity_no;
    if (gefenNumberInput) gefenNumberInput.value = identity.gefen_number;
  }
  return identity;
}

export function catalogActivityChangesFromSelection(selection = {}, options = {}) {
  return catalogIdentityChanges(selection, options);
}

/**
 * Maps a server-resolved catalog item to the fields owned by that item.
 * Price is intentionally excluded: a specific activity can have a negotiated
 * proposal price that differs from the catalog's general price.
 */
export function catalogActivityChangesFromRows(
  { selection = {}, listRow = null, pricingRow = null, courseRow = null } = {},
  { normalizeActivityType = catalogText } = {}
) {
  return catalogIdentityChanges({
    activity_name: firstCatalogValue(
      listRow?.activity_name,
      listRow?.label_he,
      listRow?.label,
      courseRow?.short_name,
      pricingRow?.activity_name,
      selection.activity_name
    ),
    activity_no: firstCatalogValue(
      pricingRow?.activity_no,
      listRow?.activity_no,
      courseRow?.gefen_number,
      selection.activity_no,
      selection.gefen_number
    ),
    // If the displayed activity catalog row exists, its blank Gefen field is
    // authoritative. Do not fill it from activity_no or a pricing fallback.
    gefen_number: listRow && Object.prototype.hasOwnProperty.call(listRow, 'gefen_number')
      ? catalogText(listRow.gefen_number)
      : firstCatalogValue(courseRow?.gefen_number, pricingRow?.gefen_number, selection.gefen_number),
    meetings_count: firstCatalogNumber(
      pricingRow?.meetings_count,
      courseRow?.meetings_count,
      listRow?.meetings_count
    ),
    activity_type: firstCatalogValue(
      pricingRow?.item_type,
      listRow?.activity_type,
      listRow?.type
    )
  }, { normalizeActivityType });
}

export { catalogText };