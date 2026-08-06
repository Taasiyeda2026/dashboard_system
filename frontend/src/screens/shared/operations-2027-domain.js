const EMPTY_TEXT = '';

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[־–—]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ');
}

function normalizeKey(value) {
  return String(value ?? '').trim();
}

function firstPresent(...values) {
  return values.find((value) => normalizeKey(value));
}

function findByKey(rows, field, value) {
  const key = normalizeKey(value);
  if (!key) return null;
  return rows.find((row) => normalizeKey(row?.[field]) === key) ?? null;
}

export function resolveCourseForActivity(activity = {}, courses = []) {
  const activityNoMatch = findByKey(courses, 'gefen_number', activity.activity_no);
  if (activityNoMatch) return activityNoMatch;

  const gefenMatch = findByKey(courses, 'gefen_number', activity.gefen_number);
  if (gefenMatch) return gefenMatch;

  const activityName = normalizeText(firstPresent(activity.short_name, activity.full_name, activity.activity_name, activity.name));
  if (!activityName) return null;

  return courses.find((course) => {
    const shortName = normalizeText(course?.short_name);
    const fullName = normalizeText(course?.full_name);
    return shortName === activityName || fullName === activityName;
  }) ?? null;
}

export function trainingCellState({ trained = false, assigned = false } = {}) {
  if (trained === true) {
    return { text: '✓', tone: 'green', state: 'trained' };
  }

  if (assigned === true) {
    return { text: '✕', tone: 'red', state: 'assigned_untrained' };
  }

  return { text: EMPTY_TEXT, tone: 'empty', state: 'empty' };
}

function hasPrintKit(holder) {
  return holder?.has_print_kit !== false;
}

export function isActiveInstructor(value) {
  if (value === true) return true;
  if (value === false) return false;

  const normalized = normalizeText(value);
  if (['yes', 'active', 'פעיל'].includes(normalized)) return true;
  if (['no', 'inactive', 'לא פעיל'].includes(normalized)) return false;

  return false;
}

function buildActiveInstructorNameSet(activeInstructors = []) {
  const activeNames = new Set();
  for (const row of activeInstructors) {
    const name = normalizeText(row?.full_name);
    if (!name || !isActiveInstructor(row?.active)) continue;
    activeNames.add(name);
  }
  return activeNames;
}

function holderNameKey(holder) {
  return normalizeText(firstPresent(holder?.instructor_name, holder?.name));
}

function holderIdentityKey(holder) {
  return normalizeText(firstPresent(holder?.instructor_name, holder?.instructor_id, holder?.contact_id, holder?.name));
}

export function splitKitHoldersByActivity(holders = [], activeInstructors = []) {
  const activeInstructorNames = buildActiveInstructorNameSet(activeInstructors);

  return holders.reduce((groups, holder) => {
    if (!hasPrintKit(holder) || !holderIdentityKey(holder)) return groups;

    const active = activeInstructorNames.has(holderNameKey(holder));
    if (active) {
      groups.active.push(holder);
    } else {
      groups.inactive.push(holder);
    }
    return groups;
  }, { active: [], inactive: [] });
}

function uniqueHolderCount(holders = []) {
  const keys = new Set();
  for (const holder of holders) {
    if (!hasPrintKit(holder)) continue;
    const holderKey = holderIdentityKey(holder);
    if (!holderKey) continue;
    keys.add(holderKey);
  }
  return keys.size;
}

export function buildPrintKitSummary({ warehouse = 0, hila = 0, idan = 0, gil = 0, holders = [], activeInstructors = [] } = {}) {
  const split = splitKitHoldersByActivity(holders, activeInstructors);
  const activeInstructorKits = uniqueHolderCount(split.active);
  const inactiveInstructorKits = uniqueHolderCount(split.inactive);
  const warehouseKits = Number(warehouse) || 0;
  const hilaKits = Number(hila) || 0;
  const idanKits = Number(idan) || 0;
  const gilKits = Number(gil) || 0;

  return {
    warehouse: warehouseKits,
    hila: hilaKits,
    idan: idanKits,
    gil: gilKits,
    activeInstructorKits,
    inactiveInstructorKits,
    totalUnique: warehouseKits + hilaKits + idanKits + gilKits + activeInstructorKits + inactiveInstructorKits
  };
}

export function resolveWorkshopStockKey(workshop = {}, { aliases = {} } = {}) {
  const explicitKey = firstPresent(workshop.stock_group_key, workshop.activity_no);
  if (explicitKey) return normalizeKey(explicitKey);

  const rawName = firstPresent(workshop.short_name, workshop.full_name, workshop.activity_name, workshop.name);
  const normalizedName = normalizeText(rawName);
  if (!normalizedName) return null;

  const aliasKey = aliases[rawName] ?? aliases[normalizedName];
  if (aliasKey) return normalizeKey(aliasKey);

  return normalizedName;
}
