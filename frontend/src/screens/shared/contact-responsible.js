import { getActivitySchoolNames, getActivityAuthorityName } from './operations-activity-helpers.js';

/**
 * Single source of truth for "who confirms the summer activity with the school contact"
 * (אחראי קשר) and "who is the school's own contact person" (איש קשר בית ספר).
 *
 * Every screen (admin operations management, instructor calendar/my-data, printed
 * schedules, completion approvals) must resolve both values through this module so
 * the same date+school always produces the same answer everywhere.
 */

export function normalizeContactMatchText(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/[״"]/g, '')
    .replace(/[׳']/g, '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// Note: deliberately NOT a \b-bounded regex - \w/\b in JS regex is ASCII-only,
// so word boundaries never match around Hebrew letters and a \b...\b pattern
// here would silently strip nothing. Plain substring removal sidesteps that.
const GENERIC_SCHOOL_PHRASES = ['בית ספר', 'ביהס', 'ביס', 'מקיף', 'חטיבת ביניים', 'חטיבה', 'יסודי'];

// A looser variant that also strips generic institution-type words ("בית ספר",
// "חטיבה", ...) and punctuation, so "בית ספר מגנים" and "מגנים" are recognized
// as the same school even though their exact text differs.
export function looseContactMatchText(value) {
  let text = normalizeContactMatchText(value)
    .replace(/["'`\u00b4]/g, '')
    .replace(/-/g, '');
  GENERIC_SCHOOL_PHRASES.forEach((phrase) => { text = text.split(phrase).join(''); });
  return text.replace(/\s+/g, '').trim();
}

export function contactActivityDateKey(row) {
  const raw = String(row?.start_date || row?.activity_date || row?.date || row?.date_1 || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';
}

function activitySchoolId(row) {
  return String(row?.school_id || row?.single_school_id || '').trim();
}

// All identity tokens a row is known by for grouping purposes: its school_id (if any)
// plus every known display-name spelling variant. Two rows sharing ANY token belong
// to the same school group, which is what lets a school_id-less row merge with a
// school_id-bearing row describing the same school.
// Name/loose tokens are qualified by authority so that two unrelated schools that
// happen to share a common name (e.g. a generic "בית ספר יסודי א'") in different
// authorities never merge into one group just because the bare text matches.
export function schoolIdentityTokens(row) {
  const tokens = [];
  const id = activitySchoolId(row);
  if (id) tokens.push(`id:${id}`);
  const authorityNorm = normalizeContactMatchText(getActivityAuthorityName(row));
  getActivitySchoolNames(row).forEach((name) => {
    const norm = normalizeContactMatchText(name);
    if (norm) tokens.push(`name:${authorityNorm}::${norm}`);
    const loose = looseContactMatchText(name);
    if (loose) tokens.push(`loose:${authorityNorm}::${loose}`);
  });
  return tokens;
}

// Bare (authority-agnostic) name tokens, used only for matching against
// activity_school_contact_responsibles overrides - that table has no authority
// column, so it can only ever be matched by school_id or by school text alone.
function bareSchoolNameTokens(names) {
  const tokens = [];
  (Array.isArray(names) ? names : []).forEach((name) => {
    const norm = normalizeContactMatchText(name);
    if (norm) tokens.push(`name:${norm}`);
    const loose = looseContactMatchText(name);
    if (loose) tokens.push(`loose:${loose}`);
  });
  return tokens;
}

function instructorEntriesForRow(row) {
  const entries = [];
  const add = (name, empId) => {
    const cleanName = String(name || '').trim();
    const cleanId = String(empId || '').trim();
    if (!cleanName && !cleanId) return;
    const exists = entries.some((entry) => (cleanId && entry.empId === cleanId) || (!cleanId && !entry.empId && entry.name === cleanName));
    if (exists) return;
    entries.push({ name: cleanName || cleanId, empId: cleanId });
  };
  add(row?.instructor_name || row?.instructor, row?.emp_id);
  add(row?.instructor_name_2 || row?.instructor_2, row?.emp_id_2);
  return entries;
}

// Deterministic ordering independent of the order rows arrived from the DB/API.
function rowSortKey(row) {
  const time = String(row?.start_time || row?.StartTime || '').trim() || '99:99';
  const id = String(row?.row_id || row?.RowID || '').trim();
  return `${time}|${id}`;
}

class DisjointSet {
  constructor() { this.parent = new Map(); }
  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur);
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // Smaller string always becomes root so the final representative is deterministic
    // (the global minimum token of the component) regardless of processing order.
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

function overrideRowTokens(row) {
  const tokens = [];
  const id = String(row?.school_id || '').trim();
  if (id) tokens.push(`id:${id}`);
  const norm = normalizeContactMatchText(row?.school || '');
  if (norm) tokens.push(`name:${norm}`);
  const loose = looseContactMatchText(row?.school || '');
  if (loose) tokens.push(`loose:${loose}`);
  return tokens;
}

function buildOverrideIndex(overrideRows = []) {
  const map = new Map();
  (Array.isArray(overrideRows) ? overrideRows : []).forEach((row) => {
    const date = String(row?.activity_date || '').trim().slice(0, 10);
    if (!date) return;
    overrideRowTokens(row).forEach((token) => {
      map.set(`${date}|${token}`, row);
    });
  });
  return map;
}

/**
 * Groups every row of `allRows` into school-identity buckets per date using a
 * union-find over (school_id, every known school-name spelling), then resolves
 * the contact responsible for each bucket: an explicit override row always wins;
 * otherwise a deterministic fallback (earliest activity by start_time/row_id,
 * its primary instructor) is used and flagged as such via `responsibleSource`.
 *
 * Must be called with the FULL activities dataset (not a single user's subset) -
 * ownRows/visibility filtering only decides which groups a caller looks at, never
 * how a group's responsible is computed.
 */
export function buildContactResponsibleIndex(allRows = [], overrideRows = []) {
  const rowsByDate = new Map();
  (Array.isArray(allRows) ? allRows : []).forEach((row) => {
    const date = contactActivityDateKey(row);
    if (!date) return;
    if (!rowsByDate.has(date)) rowsByDate.set(date, []);
    rowsByDate.get(date).push(row);
  });

  const rawGroups = new Map(); // groupKey -> { date, rows: [] }
  const tokenIndex = new Map(); // `${date}|${token}` -> groupKey

  rowsByDate.forEach((rows, date) => {
    const ds = new DisjointSet();
    const tokensByRow = rows.map(schoolIdentityTokens);
    rows.forEach((row, i) => {
      const tokens = tokensByRow[i];
      for (let t = 1; t < tokens.length; t++) ds.union(tokens[0], tokens[t]);
    });
    rows.forEach((row, i) => {
      const tokens = tokensByRow[i];
      if (!tokens.length) return;
      const root = ds.find(tokens[0]);
      const groupKey = `${date}::${root}`;
      if (!rawGroups.has(groupKey)) rawGroups.set(groupKey, { date, rows: [] });
      rawGroups.get(groupKey).rows.push(row);
      tokens.forEach((token) => tokenIndex.set(`${date}|${token}`, groupKey));
    });
  });

  const overrideIndex = buildOverrideIndex(overrideRows);

  const groups = new Map();
  rawGroups.forEach(({ date, rows }, groupKey) => {
    const sortedRows = rows.slice().sort((a, b) => rowSortKey(a).localeCompare(rowSortKey(b)));

    const schoolId = sortedRows.map(activitySchoolId).find(Boolean) || '';

    const nameCounts = new Map();
    sortedRows.forEach((row) => {
      getActivitySchoolNames(row).forEach((name) => {
        const norm = normalizeContactMatchText(name);
        if (!norm) return;
        const entry = nameCounts.get(norm) || { count: 0, display: String(name || '').trim() };
        entry.count += 1;
        nameCounts.set(norm, entry);
      });
    });
    const school = Array.from(nameCounts.values())
      .sort((a, b) => (b.count - a.count) || a.display.localeCompare(b.display, 'he'))[0]?.display || '';
    const schoolAliases = Array.from(nameCounts.values()).map((entry) => entry.display);

    const instructors = [];
    sortedRows.forEach((row) => instructorEntriesForRow(row).forEach((entry) => {
      const exists = instructors.some((item) => (item.empId && item.empId === entry.empId) || (!item.empId && !entry.empId && item.name === entry.name));
      if (!exists) instructors.push(entry);
    }));

    // id match first, then exact-name match, then loose-name match - each tier
    // tried in sorted (deterministic) token order so the outcome never depends
    // on which row happened to be iterated first while building the group. Bare
    // (authority-agnostic) tokens are used here because the override table has
    // no authority column to qualify against.
    let override = schoolId ? overrideIndex.get(`${date}|id:${schoolId}`) : null;
    if (!override) {
      const bareTokens = new Set(bareSchoolNameTokens(schoolAliases));
      for (const prefix of ['name:', 'loose:']) {
        const candidates = Array.from(bareTokens).filter((token) => token.startsWith(prefix)).sort();
        for (const token of candidates) {
          const hit = overrideIndex.get(`${date}|${token}`);
          if (hit) { override = hit; break; }
        }
        if (override) break;
      }
    }

    const fallback = instructors[0] || { name: '', empId: '' };
    const responsible = override
      ? {
          empId: String(override.responsible_emp_id || '').trim(),
          name: String(override.responsible_name || override.responsible_emp_id || '').trim(),
          source: 'override'
        }
      : (fallback.name || fallback.empId
        ? { empId: fallback.empId, name: fallback.name, source: 'fallback' }
        : { empId: '', name: '', source: 'none' });

    groups.set(groupKey, {
      key: groupKey,
      date,
      schoolId,
      school,
      schoolAliases,
      instructors,
      responsibleEmpId: responsible.empId,
      responsibleName: responsible.name,
      responsibleSource: responsible.source
    });
  });

  return { groups, tokenIndex };
}

export function findContactResponsibleGroup(row, index) {
  if (!index?.groups || !index?.tokenIndex) return null;
  const date = contactActivityDateKey(row);
  if (!date) return null;
  for (const token of schoolIdentityTokens(row)) {
    const groupKey = index.tokenIndex.get(`${date}|${token}`);
    if (groupKey) return index.groups.get(groupKey) || null;
  }
  return null;
}

export function contactResponsibleGroupsArray(index) {
  if (!index?.groups) return [];
  return Array.from(index.groups.values());
}

export function isUserResponsibleForGroup(group, ids) {
  if (!group) return false;
  const idList = (Array.isArray(ids) ? ids : [ids]).map((value) => String(value || '').trim()).filter(Boolean);
  if (!idList.length) return false;
  return idList.includes(String(group.responsibleEmpId || '').trim());
}

// ---------------------------------------------------------------------------
// School contact (the school's own point of contact) resolution.
//
// Priority: a dedicated summer contact row if one exists, then contacts_schools,
// then the school catalog - each lower tier only fills fields the higher tiers
// left empty. Never keys contacts_schools rows by schools.id or vice versa:
// both are matched by (authority, school name) text, which is the only key the
// two tables are guaranteed to share.
// ---------------------------------------------------------------------------

function contactIndexKey(authority, school) {
  return `${normalizeContactMatchText(authority)}|${normalizeContactMatchText(school)}`;
}

export function buildSummerContactIndex(rows = []) {
  const index = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (String(row?.season || '').trim() !== 'summer_2026' || row?.active === false) return;
    const name = String(row?.contact_name || '').trim();
    const phone = String(row?.contact_phone || '').trim();
    if (!name && !phone) return;
    const key = contactIndexKey(row?.authority, row?.school);
    if (key === '|') return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({
      name,
      phone,
      role: '',
      address: String(row?.school_address || '').trim(),
      cityOrAuthority: String(row?.city_or_authority || '').trim(),
      status: String(row?.contact_status || row?.status || '').trim()
    });
  });
  return index;
}

export function buildContactsSchoolsIndex(rows = []) {
  const index = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const name = String(row?.contact_name || '').trim();
    if (!name) return;
    const key = contactIndexKey(row?.authority, row?.school);
    if (key === '|') return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ name, phone: String(row?.phone || '').trim(), role: String(row?.contact_role || '').trim(), address: '' });
  });
  return index;
}

// Keyed by the schools-catalog's OWN id (schools.id) - never to be confused with
// contacts_schools.id, which lives in a separate namespace and is never used here.
export function buildSchoolsCatalogContactIndex(rows = []) {
  const index = new Map();
  const addTo = (key, entry) => {
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(entry);
  };
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const name = String(row?.principal_name || '').trim();
    const address = String(row?.institution_address || row?.address || '').trim();
    if (!name && !address) return;
    const entry = { name, phone: String(row?.school_phone || '').trim(), role: name ? 'מנהל/ת בית ספר' : '', address };
    const catalogId = String(row?.id || '').trim();
    if (catalogId) addTo(`id:${catalogId}`, entry);
    addTo(contactIndexKey(row?.authority, row?.school_name || row?.school), entry);
  });
  return index;
}

function firstWithContent(list) {
  return (Array.isArray(list) ? list : []).find((entry) => entry?.name || entry?.phone) || null;
}

/**
 * Resolves the school contact for one authority+school(+schoolId) identity using
 * the fixed 3-tier priority. Returns the same shape everywhere it's called from.
 */
export function resolveSchoolContact({ authority = '', schoolNames = [], schoolCatalogId = '' } = {}, { summerIndex, contactsSchoolsIndex, schoolsCatalogIndex } = {}) {
  const names = (Array.isArray(schoolNames) ? schoolNames : [schoolNames]).filter(Boolean);
  const lookup = (index) => {
    if (!(index instanceof Map)) return [];
    for (const name of names) {
      const hit = index.get(contactIndexKey(authority, name));
      if (hit && hit.length) return hit;
    }
    return [];
  };

  const summerHits = lookup(summerIndex);
  const contactsHits = lookup(contactsSchoolsIndex);
  const catalogById = schoolCatalogId ? schoolsCatalogIndex?.get(`id:${schoolCatalogId}`) : null;
  const catalogHits = (catalogById && catalogById.length) ? catalogById : lookup(schoolsCatalogIndex);

  const summerPrimary = firstWithContent(summerHits);
  const contactsPrimary = firstWithContent(contactsHits);
  const catalogPrimary = firstWithContent(catalogHits);
  const primary = summerPrimary || contactsPrimary || catalogPrimary;

  const result = {
    name: '',
    phone: '',
    role: '',
    address: '',
    // Only the dedicated summer-contact tier carries these - they don't exist
    // in contacts_schools or the schools catalog, so no fallback applies.
    cityOrAuthority: summerPrimary?.cityOrAuthority || '',
    status: summerPrimary?.status || '',
    source: primary ? (summerPrimary === primary ? 'summer' : (contactsPrimary === primary ? 'contacts_schools' : 'catalog')) : 'none'
  };
  [summerPrimary, contactsPrimary, catalogPrimary].filter(Boolean).forEach((candidate) => {
    if (!result.name && candidate.name) result.name = candidate.name;
    if (!result.phone && candidate.phone) result.phone = candidate.phone;
    if (!result.role && candidate.role) result.role = candidate.role;
    if (!result.address && candidate.address) result.address = candidate.address;
  });
  return result;
}
