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

function editableMeetingCardCount(form) {
  if (!form || String(form?.dataset?.isOnce || '') === 'yes') return null;
  const grid = form.querySelector?.('[data-meeting-dates-edit]');
  if (!grid) return null;
  const count = grid.querySelectorAll(':scope > .activity-drawer__date-card').length;
  return Number.isInteger(count) && count >= 1 && count <= 35 ? count : null;
}

/**
 * The activity-level session count is operational data, not catalog metadata.
 * Keep a lightweight hidden form field synchronized with the number of meeting
 * cards so removing/adding meetings in the drawer persists the new contract
 * count together with the date changes.
 */
function ensureActivitySessionCountInput(form) {
  const count = editableMeetingCardCount(form);
  if (count === null) return form?.querySelector?.('[name="sessions"]') || null;

  let input = form.querySelector?.('[name="sessions"]') || null;
  if (!input) {
    input = form.ownerDocument?.createElement?.('input') || null;
    if (!input) return null;
    input.type = 'hidden';
    input.name = 'sessions';
    input.dataset.activitySessionsAuto = 'yes';
    input.value = String(count);
    input.defaultValue = String(count);
    form.appendChild(input);
  }

  const sync = () => {
    const nextCount = editableMeetingCardCount(form);
    if (nextCount !== null && input.dataset.activitySessionsAuto === 'yes') {
      input.value = String(nextCount);
    }
  };
  sync();

  if (!form._activitySessionsCountObserver) {
    const grid = form.querySelector?.('[data-meeting-dates-edit]');
    const MutationObserverCtor = form.ownerDocument?.defaultView?.MutationObserver;
    if (grid && MutationObserverCtor) {
      const observer = new MutationObserverCtor(sync);
      observer.observe(grid, { childList: true });
      form._activitySessionsCountObserver = observer;
    }
  }

  return input;
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
  const sessionInput = ensureActivitySessionCountInput(form);
  const nameSelect = form?.querySelector?.('[data-role="activity-name-select"]');
  const option = nameSelect?.selectedOptions?.[0] || null;
  if (!nameSelect || !option || !catalogText(nameSelect.value)) {
    return { isCatalogSelection: false, activity_name: '', activity_no: '', gefen_number: '', meetings_count: null, activity_type: '' };
  }
  const activityNo = catalogText(option.dataset.activityNo);
  const gefenNumber = catalogText(option.dataset.gefenNumber);
  const currentActivityNo = catalogText(form?.querySelector?.('[data-activity-no], [name="activity_no"]')?.value);
  const currentGefenNumber = catalogText(form?.querySelector?.('[data-gefen-number], [name="gefen_number"]')?.value);
  const sameCatalogIdentity = Boolean(activityNo || gefenNumber) && (
    (activityNo && currentActivityNo === activityNo)
    || (gefenNumber && currentGefenNumber === gefenNumber)
  );
  const localMeetingCount = firstCatalogNumber(sessionInput?.value, editableMeetingCardCount(form));
  return {
    isCatalogSelection: Boolean(activityNo || gefenNumber),
    activity_name: catalogText(nameSelect.value),
    activity_no: activityNo,
    gefen_number: gefenNumber,
    // The catalog count is only a default when the user actually switches to
    // another catalog item. Once the selected item is the activity's current
    // identity, the locally edited meeting count is authoritative.
    meetings_count: sameCatalogIdentity && localMeetingCount !== null
      ? localMeetingCount
      : firstCatalogNumber(option.dataset.meetingsCount),
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
  const catalogType = firstCatalogValue(
    pricingRow?.item_type,
    listRow?.activity_type,
    listRow?.type
  );
  const courseShortName = catalogType === 'course' ? catalogText(courseRow?.short_name) : '';

  return catalogIdentityChanges({
    // School-year Gefen course rows are normalized in Supabase by
    // normalize_school_2027_activity_course_short_name(), which uses
    // proposal_gefen_courses.short_name. Prefer the same canonical name here
    // so the requested value and the post-trigger DB value cannot diverge after
    // an otherwise successful save.
    activity_name: firstCatalogValue(
      courseShortName,
      listRow?.activity_name,
      listRow?.label_he,
      listRow?.label,
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
    activity_type: catalogType
  }, { normalizeActivityType });
}

export { catalogText };