import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewEmploymentType } from './shared/ui-hebrew.js';
import { dsScreenStack, dsEmptyState, dsStatusChip } from './shared/layout.js';
import { showToast } from './shared/toast.js';
import {
  ensureActivityListFilters,
  prepareRowsForSearch,
  applyLocalFilters,
  filtersToolbarHtml,
  bindLocalFilters,
  normalizeText
} from './shared/activity-list-filters.js';
import { getManagerUsers } from './shared/activity-options.js';

const AVATAR_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6',
  '#f43f5e', '#a855f7'
];
const CONTACTS_SCOPE = 'contacts';

const INSTR_SEARCH_FIELDS = [
  'full_name', 'mobile', 'email', 'contact_role', 'role', 'employment_type'
];

const SCHOOL_FILTER_FIELDS = [
  { key: 'authority', label: 'רשות' },
  { key: 'school', label: 'בית ספר' },
  { key: 'contact_role', label: 'תפקיד' }
];

function textValue(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || raw === 'null' || raw === 'undefined') return '';
  return raw;
}

function isSchoolProfileRow(row) {
  return String(row?.source_table || '') === 'schools';
}

function isValidContact(row) {
  if (isSchoolProfileRow(row)) {
    return Boolean(
      textValue(row?.contact_name)
      || textValue(row?.mobile || row?.phone)
      || textValue(row?.email)
      || textValue(row?.address)
    );
  }
  return Boolean(
    textValue(row?.contact_name)
    || textValue(row?.mobile || row?.phone)
    || textValue(row?.email)
  );
}

function hasSchoolDirectoryEntry(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.some((row) => isValidContact(row) || isSchoolProfileRow(row));
}

function contactDedupeKey(row) {
  return [
    String(row?.source_table || '').trim(),
    String(row?.source_id || '').trim(),
    String(row?.authority || row?.client_name || '').trim().toLowerCase(),
    String(row?.school || '').trim().toLowerCase(),
    String(row?.contact_name || '').trim().toLowerCase(),
    String(row?.mobile || row?.phone || '').trim(),
    String(row?.email || '').trim().toLowerCase()
  ].join('|');
}

function applyInstrFilters(rows, filters) {
  const list = Array.isArray(rows) ? rows : [];
  const rawSearch = Object.prototype.hasOwnProperty.call(filters || {}, 'appliedQ')
    ? filters.appliedQ
    : filters?.q;
  const search = normalizeText(rawSearch || '');
  if (!search) return list;
  return list.filter((row) => {
    const hay = INSTR_SEARCH_FIELDS
      .map((field) => row?.[field])
      .filter(Boolean)
      .map((v) => normalizeText(v))
      .join(' ');
    return hay.includes(search);
  });
}

function instrToolbarHtml(scope, state) {
  const filters = ensureActivityListFilters(state, scope);
  return `<div class="ds-toolbar ds-toolbar--filters-inline ds-toolbar--contacts-instr" dir="rtl" data-local-filters="${escapeHtml(scope)}">
    <input type="search" class="ds-input ds-input--sm ds-filter-search-sm" data-filter-search="${escapeHtml(scope)}" value="${escapeHtml(filters.q || '')}" placeholder="חיפוש לפי שם / טלפון / מייל / תפקיד…" />
    <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-filter-clear="${escapeHtml(scope)}">ניקוי</button>
  </div>`;
}

function computeSchoolTabStats(authorityMap, activeLetter = '') {
  let authorities = 0;
  let schools = 0;
  const contactKeys = new Set();

  authorityMap.forEach((bucket, authority) => {
    if (activeLetter && firstHebrewLetter(authority) !== activeLetter) return;
    let hasContent = false;

    bucket.schools.forEach((schoolRows, schoolName) => {
      if (!String(schoolName || '').trim()) return;
      const valid = schoolRows.filter((row) => isValidContact(row) || isSchoolProfileRow(row));
      if (!valid.length) return;
      schools += 1;
      hasContent = true;
      valid.forEach((row) => contactKeys.add(contactDedupeKey(row)));
    });

    [...bucket.authority, ...bucket.other].forEach((row) => {
      if (!isValidContact(row)) return;
      hasContent = true;
      contactKeys.add(contactDedupeKey(row));
    });

    if (hasContent) authorities += 1;
  });

  return { authorities, schools, contacts: contactKeys.size };
}

function countAuthorityBucket(bucket) {
  let schoolCount = 0;
  const contactKeys = new Set();

  bucket.schools.forEach((schoolRows, schoolName) => {
    if (!String(schoolName || '').trim()) return;
    const valid = schoolRows.filter((row) => isValidContact(row) || isSchoolProfileRow(row));
    if (!valid.length) return;
    schoolCount += 1;
    valid.forEach((row) => contactKeys.add(contactDedupeKey(row)));
  });

  [...bucket.authority, ...bucket.other].forEach((row) => {
    if (!isValidContact(row)) return;
    contactKeys.add(contactDedupeKey(row));
  });

  return { schoolCount, contactCount: contactKeys.size };
}

/* ─── Copy button ─── */

function copyBtn(email, label = 'העתק מייל') {
  if (!email) return '';
  return `<button type="button" class="ci-copy-btn" data-copy-email="${escapeHtml(email)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">⎘</button>`;
}

function actionBtn(action, payload, label) {
  return `<button type="button" class="ci-copy-btn" data-contact-action="${escapeHtml(action)}" data-contact-payload="${escapeHtml(encodeURIComponent(JSON.stringify(payload || {})))}" aria-label="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
}

/* ─── Instructor contacts ─── */

function avatarColor(empId) {
  let hash = 0;
  const s = String(empId || '');
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function avatarInitials(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return parts[0][0] + parts[1][0];
  if (parts.length === 1) return parts[0].slice(0, 2);
  return '??';
}

function instrDrawerHtml(row, hideEmpIds) {
  const isActive = String(row.active || '').toLowerCase() !== 'no';
  const fields = [
    row.full_name                ? { icon: '👤', label: hebrewColumn('full_name'),       val: row.full_name }                             : null,
    row.mobile                   ? { icon: '📱', label: hebrewColumn('mobile'),          val: row.mobile, copy: true, copyLabel: 'העתק טלפון' } : null,
    row.email                    ? { icon: '✉',  label: hebrewColumn('email'),           val: row.email, copy: true, copyLabel: 'העתק מייל' }   : null,
    (!hideEmpIds && row.emp_id)  ? { icon: '#',  label: hebrewColumn('emp_id'),          val: row.emp_id }                                : null,
    row.address                  ? { icon: '📍', label: hebrewColumn('address'),         val: row.address }                               : null,
    row.employment_type          ? { icon: '💼', label: hebrewColumn('employment_type'), val: hebrewEmploymentType(row.employment_type) } : null,
    row.direct_manager           ? { icon: '👤', label: hebrewColumn('direct_manager'),  val: row.direct_manager }                        : null,
                                    { icon: '●',  label: hebrewColumn('active'),          status: true, isActive }
  ].filter(Boolean);

  const linesHtml = fields.map(({ icon, label, val, copy, copyLabel, status, isActive: active }) => {
    let valueHtml;
    if (status) {
      valueHtml = dsStatusChip(active ? 'פעיל' : 'לא פעיל', active ? 'success' : 'neutral');
    } else if (copy) {
      valueHtml = `<span class="ci-dv">${escapeHtml(String(val))}</span>${copyBtn(val, copyLabel)}`;
    } else {
      valueHtml = `<span class="ci-dv">${escapeHtml(String(val))}</span>`;
    }
    return `<div class="ci-df">
      <span class="ci-df__icon" aria-hidden="true">${icon}</span>
      <span class="ci-df__label">${escapeHtml(label)}</span>
      <span class="ci-df__value">${valueHtml}</span>
    </div>`;
  }).join('');

  return `<div class="ci-detail">${linesHtml}</div>`;
}

function renderInstrCard(row) {
  const nameRaw = row.full_name || row.emp_id || '—';
  const name = escapeHtml(nameRaw);
  const isInactive = String(row.active || '').toLowerCase() === 'no';
  const initials = escapeHtml(avatarInitials(nameRaw));
  const bg = avatarColor(row.emp_id || nameRaw);

  return `
    <div class="ci-person-card-wrap">
      <button type="button" class="ci-person-card${isInactive ? ' ci-person-card--inactive' : ''}"
        data-card-action="icontact:${encodeURIComponent(row.emp_id || '')}">
        <span class="ci-person-card__avatar" style="background:${bg}" aria-hidden="true">${initials}</span>
        <span class="ci-person-card__info">
          <span class="ci-person-card__name">${name}</span>
        </span>
      </button>
      <span class="ci-person-card__actions">${actionBtn('edit-instr', { emp_id: row.emp_id }, '✎')}</span>
    </div>`;
}

function hasActiveInstrFilters(filters = {}) {
  return Boolean(String(filters.appliedQ || filters.q || '').trim());
}

function hasActiveContactFilters(filters = {}) {
  return Boolean(String(filters.appliedQ || filters.q || '').trim())
    || SCHOOL_FILTER_FIELDS.some((field) => String(filters?.[field.key] || '').trim());
}

function contactEmptyState(rows, filters) {
  if (Array.isArray(rows) && rows.length && hasActiveContactFilters(filters)) {
    return dsEmptyState('לא נמצאו אנשי קשר שתואמים לסינון הפעיל.');
  }
  return dsEmptyState('לא נמצאו אנשי קשר');
}

function instrEmptyState(rows, filters) {
  if (Array.isArray(rows) && rows.length && hasActiveInstrFilters(filters)) {
    return dsEmptyState('לא נמצאו מדריכים לפי הסינון הנוכחי');
  }
  return dsEmptyState('לא נמצאו מדריכים');
}

function instrTabHtml(rows, filters) {
  const filtered = applyInstrFilters(rows, filters);
  const body = filtered.length === 0
    ? instrEmptyState(rows, filters)
    : `<div class="ci-person-grid">${filtered.map((r) => renderInstrCard(r)).join('')}</div>`;
  return { filtered, body };
}

/* ─── School contacts ─── */

function editPayload(row) {
  return {
    source_table: row?.source_table || '',
    source_id: row?.source_id || '',
    authority: row?.authority,
    school: row?.school,
    contact_name: row?.contact_name
  };
}

function fieldLine(label, value, { copy = false, copyLabel = '', dir = 'rtl' } = {}) {
  const safe = textValue(value);
  if (!safe) return '';
  const valueHtml = copy
    ? `<span class="ci-dv">${escapeHtml(safe)}</span>${copyBtn(safe, copyLabel)}`
    : escapeHtml(safe);
  return `<div class="sc-person__field sc-person__field--${escapeHtml(label)}" dir="${dir}"><span class="sc-person__field-label">${escapeHtml(label)}:</span> ${valueHtml}</div>`;
}

function schoolPersonHtml(row) {
  const name = textValue(row.contact_name);
  const role = textValue(row.contact_role);
  const phone = textValue(row.mobile || row.phone);
  const mobileOnly = textValue(row.mobile);
  const email = textValue(row.email);
  const address = textValue(row.address);
  const notes = textValue(row.notes);
  if (!isValidContact(row)) return '';

  const editBtn = actionBtn('edit-unified', editPayload(row), '✎');

  return `<article class="sc-person sc-person--compact">
    <div class="sc-person__top">
      ${name ? `<div class="sc-person__name">${escapeHtml(name)}</div>` : ''}
      <span class="sc-person__actions">${editBtn}</span>
    </div>
    ${role ? `<div class="sc-person__role">${escapeHtml(role)}</div>` : ''}
    ${fieldLine('טלפון', phone, { dir: 'ltr' })}
    ${mobileOnly && mobileOnly !== phone ? fieldLine('נייד', mobileOnly, { dir: 'ltr' }) : ''}
    ${fieldLine('מייל', email, { copy: true, copyLabel: 'העתק מייל', dir: 'ltr' })}
    ${fieldLine('כתובת', address)}
    ${fieldLine('הערות', notes)}
  </article>`;
}

function schoolProfileHtml(row) {
  if (!isSchoolProfileRow(row) || !isValidContact(row)) return '';
  const editBtn = actionBtn('edit-unified', editPayload(row), '✎');
  const name = textValue(row.contact_name);
  const role = textValue(row.contact_role);
  const phone = textValue(row.phone);
  const address = textValue(row.address);
  const city = textValue(row.city);
  const district = textValue(row.district);
  const addressLine = [address, city, district].filter(Boolean).join(', ');

  return `<article class="sc-person sc-person--compact sc-person--school-profile">
    <div class="sc-person__top">
      ${name ? `<div class="sc-person__name">${escapeHtml(name)}</div>` : '<div class="sc-person__name">פרטי בית ספר</div>'}
      <span class="sc-person__actions">${editBtn}</span>
    </div>
    ${role ? `<div class="sc-person__role">${escapeHtml(role)}</div>` : ''}
    ${fieldLine('טלפון', phone, { dir: 'ltr' })}
    ${fieldLine('כתובת', addressLine)}
  </article>`;
}

const HE_ALPHA = ['א','ב','ג','ד','ה','ו','ז','ח','ט','י','כ','ל','מ','נ','ס','ע','פ','צ','ק','ר','ש','ת'];

function firstHebrewLetter(str) {
  const ch = String(str || '').trim().charAt(0);
  return HE_ALPHA.includes(ch) ? ch : '#';
}

function groupByAuthorityStructured(rows) {
  const authMap = new Map();
  for (const row of rows) {
    const authority = textValue(row.authority || row.authority_name || row.client_name) || '—';
    if (!authMap.has(authority)) authMap.set(authority, { schools: new Map(), authority: [], other: [] });
    const bucket = authMap.get(authority);
    const clientType = textValue(row.client_type).toLowerCase();
    const contactDomain = textValue(row.contact_domain).toLowerCase();
    const schoolName = textValue(row.school || row.school_name);
    if (contactDomain === 'other' || clientType === 'other') {
      bucket.other.push(row);
    } else if (schoolName && (contactDomain === 'school' || clientType === 'school' || isSchoolProfileRow(row))) {
      if (!bucket.schools.has(schoolName)) bucket.schools.set(schoolName, []);
      bucket.schools.get(schoolName).push(row);
    } else {
      bucket.authority.push(row);
    }
  }
  return new Map([...authMap.entries()].sort((a, b) => a[0].localeCompare(b[0], 'he')));
}

function renderSchoolAccordion(schoolName, rows) {
  const profileRow = rows.find(isSchoolProfileRow);
  const contactRows = rows.filter((row) => !isSchoolProfileRow(row) && isValidContact(row));
  const profileHtml = schoolProfileHtml(profileRow);
  const contactsHtml = contactRows.map(schoolPersonHtml).filter(Boolean).join('');
  if (!profileHtml && !contactsHtml) return '';

  const semelMosad = rows.map((r) => textValue(r.semel_mosad)).find(Boolean);
  const metaHtml = semelMosad
    ? `<div class="sc-school-meta"><span class="sc-school-meta__label">סמל מוסד:</span> <span class="sc-school-meta__val">${escapeHtml(semelMosad)}</span></div>`
    : '';
  return `<details class="sc-card sc-card--compact">
    <summary class="sc-card__head">
      <span class="sc-card__chevron" aria-hidden="true">›</span>
      <span class="sc-card__school-icon" aria-hidden="true">🏫</span>
      <span class="sc-card__name">${escapeHtml(schoolName)}</span>
    </summary>
    <div class="sc-card__body">
      ${metaHtml}
      <div class="sc-contact-list sc-contact-list--grid">${profileHtml}${contactsHtml}</div>
    </div>
  </details>`;
}

function authorityCodeFromBucket(bucket) {
  const rows = [];
  bucket.schools.forEach((schoolRows) => { rows.push(...schoolRows); });
  rows.push(...bucket.authority, ...bucket.other);
  return rows.map((row) => String(row.authority_code || '').trim()).find(Boolean) || '';
}

function renderAuthorityAccordion(authority, bucket) {
  const { schools, authority: authContacts, other } = bucket;
  const authorityCode = authorityCodeFromBucket(bucket);
  let schoolsHtml = '';
  const sortedSchools = [...schools.entries()]
    .filter(([schoolName, rows]) => String(schoolName || '').trim() && hasSchoolDirectoryEntry(rows))
    .sort((a, b) => a[0].localeCompare(b[0], 'he'));
  sortedSchools.forEach(([schoolName, rows]) => { schoolsHtml += renderSchoolAccordion(schoolName, rows); });

  const authValid = authContacts.filter(isValidContact);
  const otherValid = other.filter(isValidContact);
  const authPersonsHtml = authValid.map(schoolPersonHtml).filter(Boolean).join('');
  const otherPersonsHtml = otherValid.map(schoolPersonHtml).filter(Boolean).join('');
  if (!schoolsHtml && !authPersonsHtml && !otherPersonsHtml) return '';

  const schoolsSection = schoolsHtml
    ? `<section class="sc-sub-group sc-sub-group--schools">
        <div class="sc-sub-group__title"><span aria-hidden="true">🏫</span> בתי ספר</div>
        <div class="sc-school-grid">${schoolsHtml}</div>
      </section>`
    : '';
  const authoritySection = authPersonsHtml
    ? `<section class="sc-sub-group sc-sub-group--authority">
        <div class="sc-sub-group__title"><span aria-hidden="true">🏛️</span> רשות</div>
        <div class="sc-contact-list sc-contact-list--grid">${authPersonsHtml}</div>
      </section>`
    : '';
  const otherSection = otherPersonsHtml
    ? `<section class="sc-sub-group sc-sub-group--other">
        <div class="sc-sub-group__title"><span aria-hidden="true">📋</span> אחר</div>
        <div class="sc-contact-list sc-contact-list--grid">${otherPersonsHtml}</div>
      </section>`
    : '';

  return `<details class="sc-authority-accordion sc-authority-accordion--compact">
    <summary class="sc-authority-head sc-authority-head--accordion">
      <span class="sc-card__chevron" aria-hidden="true">›</span>
      <span class="sc-authority-icon" aria-hidden="true">🏛️</span>
      <span class="sc-authority-name">${escapeHtml(authority)}</span>
      ${authorityCode ? `<span class="sc-authority-code">מספר רשות: ${escapeHtml(authorityCode)}</span>` : ''}
    </summary>
    <div class="sc-authority-body">
      ${schoolsSection}${authoritySection}${otherSection}
    </div>
  </details>`;
}

function selectOptionsHtml(values, selected = '', placeholder = '—') {
  const safe = String(selected || '');
  const uniq = [...new Set((Array.isArray(values) ? values : []).map((v) => String(v || '').trim()).filter(Boolean))];
  const merged = safe && !uniq.includes(safe) ? [safe, ...uniq] : uniq;
  return [`<option value="">${escapeHtml(placeholder)}</option>`]
    .concat(merged.map((v) => `<option value="${escapeHtml(v)}"${v === safe ? ' selected' : ''}>${escapeHtml(v)}</option>`))
    .join('');
}

function instructorFormHtml(row = {}, managerOptions = []) {
  const employmentOptions = ['תעשיידע', 'מעוף', 'מנפוואר'];
  return `
    <div class="ds-perm-edit-form ds-contact-edit-form" dir="rtl">
      <div class="ds-perm-field"><span class="ds-muted">מזהה מדריך</span><input class="ds-input ds-input--sm" name="emp_id" value="${escapeHtml(String(row.emp_id || ''))}" ${row.emp_id ? 'readonly' : ''}></div>
      <div class="ds-perm-field"><span class="ds-muted">שם מלא</span><input class="ds-input ds-input--sm" name="full_name" value="${escapeHtml(String(row.full_name || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">נייד</span><input class="ds-input ds-input--sm" name="mobile" value="${escapeHtml(String(row.mobile || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">אימייל</span><input class="ds-input ds-input--sm" name="email" value="${escapeHtml(String(row.email || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">כתובת</span><input class="ds-input ds-input--sm" name="address" value="${escapeHtml(String(row.address || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">סוג העסקה</span><select class="ds-input ds-input--sm" name="employment_type">
        ${selectOptionsHtml(employmentOptions, String(row.employment_type || ''), 'בחרו סוג העסקה')}
      </select></div>
      <div class="ds-perm-field"><span class="ds-muted">מנהל ישיר</span><select class="ds-input ds-input--sm" name="direct_manager">
        ${selectOptionsHtml(managerOptions, String(row.direct_manager || ''), 'בחרו מנהל')}
      </select></div>
      <div class="ds-perm-field"><span class="ds-muted">פעיל</span><select class="ds-input ds-input--sm" name="active">
        <option value="yes" ${String(row.active || 'yes').toLowerCase() === 'yes' ? 'selected' : ''}>כן</option>
        <option value="no" ${String(row.active || '').toLowerCase() === 'no' ? 'selected' : ''}>לא</option>
      </select></div>
      <p class="ds-muted" data-contact-form-status role="status"></p>
    </div>
  `;
}

function schoolDetailsFormHtml(row = {}) {
  return `
    <div class="ds-perm-edit-form ds-contact-edit-form" dir="rtl">
      <input type="hidden" name="source_table" value="schools">
      <input type="hidden" name="source_id" value="${escapeHtml(String(row.source_id || ''))}">
      <div class="ds-perm-field"><span class="ds-muted">בית ספר</span><input class="ds-input ds-input--sm" value="${escapeHtml(String(row.school_name || row.school || ''))}" readonly></div>
      <div class="ds-perm-field"><span class="ds-muted">מנהל/ת בית ספר</span><input class="ds-input ds-input--sm" name="principal_name" value="${escapeHtml(String(row.contact_name || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">טלפון</span><input class="ds-input ds-input--sm" name="school_phone" value="${escapeHtml(String(row.phone || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">כתובת</span><input class="ds-input ds-input--sm" name="institution_address" value="${escapeHtml(String(row.address || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">עיר / יישוב</span><input class="ds-input ds-input--sm" name="city" value="${escapeHtml(String(row.city || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">מחוז</span><input class="ds-input ds-input--sm" name="district" value="${escapeHtml(String(row.district || ''))}"></div>
      <p class="ds-muted" data-contact-form-status role="status"></p>
    </div>
  `;
}

function schoolFormHtml(row = {}) {
  const clientType = String(row.client_type || 'school');
  return `
    <div class="ds-perm-edit-form ds-contact-edit-form" dir="rtl">
      <input type="hidden" name="source_table" value="contacts_schools">
      <input type="hidden" name="source_id" value="${escapeHtml(String(row.source_id || row.id || ''))}">
      <div class="ds-perm-field"><span class="ds-muted">סוג לקוח</span>
        <select class="ds-input ds-input--sm" name="client_type" data-school-client-type>
          <option value="school"${clientType === 'school' ? ' selected' : ''}>בית ספר</option>
          <option value="authority"${clientType === 'authority' ? ' selected' : ''}>רשות / מועצה / עירייה</option>
          <option value="other"${clientType === 'other' ? ' selected' : ''}>אחר</option>
        </select>
      </div>
      <input type="hidden" name="authority_id" value="${escapeHtml(String(row.authority_id || ''))}">
      <input type="hidden" name="school_id" value="${escapeHtml(String(row.school_id || ''))}">
      <input type="hidden" name="semel_mosad" value="${escapeHtml(String(row.semel_mosad || ''))}">
      <div class="ds-perm-field"><span class="ds-muted">רשות / עירייה / מועצה</span><input class="ds-input ds-input--sm" name="authority" value="${escapeHtml(String(row.authority || ''))}"></div>
      <div class="ds-perm-field" data-school-field${clientType === 'authority' ? ' hidden' : ''}><span class="ds-muted">בית ספר</span><input class="ds-input ds-input--sm" name="school" value="${escapeHtml(String(row.school || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">שם איש קשר</span><input class="ds-input ds-input--sm" name="contact_name" value="${escapeHtml(String(row.contact_name || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">תפקיד</span><input class="ds-input ds-input--sm" name="contact_role" value="${escapeHtml(String(row.contact_role || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">טלפון</span><input class="ds-input ds-input--sm" name="phone" value="${escapeHtml(String(row.phone || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">נייד</span><input class="ds-input ds-input--sm" name="mobile" value="${escapeHtml(String(row.mobile || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">אימייל</span><input class="ds-input ds-input--sm" name="email" value="${escapeHtml(String(row.email || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">כתובת</span><input class="ds-input ds-input--sm" name="address" value="${escapeHtml(String(row.address || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">הערות</span><textarea class="ds-input ds-input--sm" name="notes" rows="2">${escapeHtml(String(row.notes || ''))}</textarea></div>
      <p class="ds-muted" data-contact-form-status role="status"></p>
    </div>
  `;
}

function contactListHtml(tab, instrRows, schoolRows, filters, canViewInstr = true, canViewSchool = true, activeLetter = '') {
  if (tab === 'instr' && canViewInstr) return instrTabHtml(instrRows, filters).body;
  if (tab === 'school' && canViewSchool) return schoolTabHtml(schoolRows, filters, activeLetter).body;
  return dsEmptyState('לא נמצאו אנשי קשר');
}

function contactTabCounts(instrRows, schoolRows, filters, activeLetter = '') {
  const instrCount = applyInstrFilters(instrRows, filters).length;
  const schoolStats = computeSchoolTabStats(
    groupByAuthorityStructured(applyLocalFilters(schoolRows, filters, { filterFields: SCHOOL_FILTER_FIELDS })),
    activeLetter
  );
  return { instrCount, schoolContacts: schoolStats.contacts };
}

function schoolTabHtml(rows, filters, activeLetter = '') {
  const filtered = applyLocalFilters(rows, filters, { filterFields: SCHOOL_FILTER_FIELDS });
  const authorityMap = groupByAuthorityStructured(filtered);
  const stats = computeSchoolTabStats(authorityMap, activeLetter);

  if (!stats.authorities && !stats.contacts) {
    return { filtered, stats, body: contactEmptyState(rows, filters) };
  }

  const letterMap = new Map();
  authorityMap.forEach((bucket, authority) => {
    if (!countAuthorityBucket(bucket).schoolCount && !countAuthorityBucket(bucket).contactCount) return;
    const letter = firstHebrewLetter(authority);
    if (!letterMap.has(letter)) letterMap.set(letter, []);
    letterMap.get(letter).push(authority);
  });

  const availableLetters = new Set(letterMap.keys());
  const alphaBtns = HE_ALPHA.map((letter) =>
    `<button type="button" class="sc-alpha-btn${activeLetter === letter ? ' is-active' : ''}${availableLetters.has(letter) ? '' : ' is-empty'}" data-alpha-btn="${escapeHtml(letter)}" aria-expanded="${activeLetter === letter ? 'true' : 'false'}" title="${availableLetters.has(letter) ? '' : 'אין רשויות באות זו'}">${escapeHtml(letter)}</button>`
  ).join('');
  const alphaBar = `<div class="sc-alpha-bar sc-alpha-bar--compact" role="toolbar" aria-label="אלפון א-ת" dir="rtl">${alphaBtns}</div>`;

  const letterSections = new Map();
  authorityMap.forEach((bucket, authority) => {
    if (!activeLetter) return;
    const letter = firstHebrewLetter(authority);
    if (letter !== activeLetter) return;
    const authHtml = renderAuthorityAccordion(authority, bucket);
    if (!authHtml) return;
    if (!letterSections.has(letter)) letterSections.set(letter, '');
    letterSections.set(letter, letterSections.get(letter) + authHtml);
  });

  let sectionsHtml = '';
  const sortedLetters = [...letterSections.keys()].sort((a, b) => {
    if (a === '#') return 1;
    if (b === '#') return -1;
    return a.localeCompare(b, 'he');
  });
  sortedLetters.forEach((letter) => {
    const authHtml = letterSections.get(letter);
    if (!authHtml) return;
    sectionsHtml += `<div class="sc-letter-section" data-letter-section="${escapeHtml(letter)}">
      <div class="sc-auth-accordion-list">${authHtml}</div>
    </div>`;
  });

  const initialHint = !activeLetter
    ? '<div class="sc-alpha-hint" role="status">בחרו אות כדי להציג רשויות ואנשי קשר.</div>'
    : (sectionsHtml ? '' : '<div class="sc-alpha-hint" role="status">לא נמצאו רשויות באות שנבחרה.</div>');

  return { filtered, stats, body: `${alphaBar}${initialHint}${sectionsHtml}` };
}

/* ─── Screen ─── */

export const contactsScreen = {
  load: ({ api }) => api.contacts(),

  render(data, { state } = {}) {
    const instrRows  = Array.isArray(data?.instructor_rows) ? data.instructor_rows : [];
    const schoolRows = Array.isArray(data?.school_rows)     ? data.school_rows     : [];
    prepareRowsForSearch(instrRows, [
      'full_name', 'name', 'contact_name', 'emp_id', 'employee_id',
      'mobile', 'phone', 'email', 'authority', 'school',
      'role', 'contact_role', 'employment_type', 'direct_manager', 'active',
      'notes', 'address', 'activity_name', 'activity_type'
    ]);
    prepareRowsForSearch(schoolRows, [
      'full_name', 'name', 'contact_name', 'emp_id', 'employee_id',
      'mobile', 'phone', 'email', 'authority', 'authority_name', 'school', 'school_name',
      'role', 'contact_role', 'position', 'active', 'notes', 'address', 'city', 'district',
      'instructor_name', 'activity_name', 'activity_type', 'client_type', 'client_name',
      'authority_id', 'school_id', 'semel_mosad', 'authority_code', 'source_table', 'source_id', 'contact_domain'
    ]);
    const filters = ensureActivityListFilters(state, CONTACTS_SCOPE);
    const canViewInstr  = data?.can_view_instructors !== false;
    const canViewSchool = data?.can_view_schools     !== false;
    const tab     = state?.contactsTab || (canViewInstr ? 'instr' : 'school');
    const activeLetter = tab === 'school' ? String(state?.contactsAlphaLetter || '') : '';
    const tabBtns = [
      canViewInstr  && { key: 'instr',  label: 'אנשי קשר מדריכים'  },
      canViewSchool && { key: 'school', label: 'לקוחות ואנשי קשר' }
    ].filter(Boolean).map((t) =>
      `<button type="button" class="ds-chip--tab${tab === t.key ? ' is-active' : ''}" data-contacts-tab="${t.key}">${escapeHtml(t.label)}</button>`
    ).join('');

    const listHtml = contactListHtml(tab, instrRows, schoolRows, filters, canViewInstr, canViewSchool, activeLetter);

    const searchInput = tab === 'instr'
      ? instrToolbarHtml(CONTACTS_SCOPE, state)
      : filtersToolbarHtml(CONTACTS_SCOPE, schoolRows, state, {
        searchPlaceholder: 'חיפוש לפי שם / תפקיד / טלפון / מייל / רשות / מספר רשות / בית ספר / סמל מוסד…',
        filterFields: SCHOOL_FILTER_FIELDS,
        dependent: true,
        search: true
      });

    return dsScreenStack(`
      <div class="ds-chip-group contacts-tab-bar" dir="rtl">${tabBtns}</div>
      <div class="ds-screen-top-row contacts-toolbar-row">
        ${searchInput}
        <button type="button" class="ds-btn ds-btn--primary ds-btn--sm ds-btn--contact-add" data-contact-action="add-${tab === 'instr' ? 'instr' : 'school'}">+ הוסף</button>
      </div>
      <div class="contacts-list-wrap" dir="rtl">${listHtml}</div>
    `);
  },

  bind({ root, data, state, ui, rerender, api }) {
    const instrRows = Array.isArray(data?.instructor_rows) ? data.instructor_rows : [];
    const schoolRows = Array.isArray(data?.school_rows) ? data.school_rows : [];
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
    const managerOptions = getManagerUsers(state?.clientSettings || {});

    root.querySelectorAll('[data-contacts-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.contactsTab = btn.dataset.contactsTab;
        if (state.contactsTab !== 'school') state.contactsAlphaLetter = '';
        rerender();
      });
    });
    const bindCopyBtns = (container) => {
      container.querySelectorAll('[data-copy-email]').forEach((btn) => {
        if (btn._copyBound) return;
        btn._copyBound = true;
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const email = String(btn.dataset.copyEmail || '').trim();
          if (!email) { showToast('לא ניתן היה להעתיק', 'error', 1800); return; }
          copyEmailToClipboard(email)
            .then(() => showToast('המייל הועתק', 'success', 1500))
            .catch(() => showToast('לא ניתן היה להעתיק', 'error', 1800));
        });
      });
    };
    const openInstructorDrawer = (action) => {
      if (!action.startsWith('icontact:')) return;
      const empId = decodeURIComponent(action.slice('icontact:'.length));
      const hit = instrRows.find((r) => String(r.emp_id || '') === String(empId));
      if (!hit) return;
      ui.openDrawer({
        title: hit.full_name || hit.emp_id || 'איש קשר',
        content: instrDrawerHtml(hit, hideEmpIds)
      });
      requestAnimationFrame(() => {
        const drawer = document.querySelector('.ds-drawer__body, .ds-drawer, [data-drawer]');
        if (drawer) bindCopyBtns(drawer);
        else bindCopyBtns(document.body);
      });
    };

    const bindAlphaBtns = (container = root) => {
      container.querySelectorAll('[data-alpha-btn]').forEach((btn) => {
        if (btn.dataset.alphaBound === 'yes') return;
        btn.dataset.alphaBound = 'yes';
        btn.addEventListener('click', () => {
          const letter = btn.dataset.alphaBtn;
          const isOpen = state.contactsAlphaLetter === letter;
          state.contactsAlphaLetter = isOpen ? '' : letter;
          rerender();
        });
      });
    };

    const bindContactsListInteractions = (container = root) => {
      bindCopyBtns(container);
      bindAlphaBtns(container);
      ui?.bindInteractiveCards(container, openInstructorDrawer);
    };

    bindContactsListInteractions(root);

    bindLocalFilters(root, state, CONTACTS_SCOPE, rerender, {
      debounceMs: 200,
      onClear: () => { state.contactsAlphaLetter = ''; }
    });

    const decodePayload = (node) => {
      const raw = String(node?.dataset?.contactPayload || '');
      if (!raw) return {};
      try {
        return JSON.parse(decodeURIComponent(raw));
      } catch {
        return {};
      }
    };

    const openInstructorEditor = (row, isCreate = false) => {
      if (!ui) return;
      const target = row || {};
      const originalId = target.id != null ? target.id : null;
      ui.openModal({
        title: isCreate ? 'הוספת איש קשר מדריך' : 'עריכת איש קשר מדריך',
        content: instructorFormHtml(target, managerOptions),
        actions: `<button type="button" class="ds-btn ds-btn--primary" data-save-contact="instr">${isCreate ? 'הוספה' : 'שמירה'}</button>
                  <button type="button" class="ds-btn" data-ui-close-modal>ביטול</button>`
      });
      const saveBtn = document.querySelector('[data-save-contact="instr"]');
      if (!saveBtn) return;
      saveBtn.onclick = async () => {
        const modal = document.querySelector('.ds-modal__content');
        if (!modal) return;
        const statusEl = modal.querySelector('[data-contact-form-status]');
        const get = (name) => String(modal.querySelector(`[name="${name}"]`)?.value || '').trim();
        const payload = {
          emp_id: get('emp_id'),
          full_name: get('full_name'),
          mobile: get('mobile'),
          email: get('email'),
          address: get('address'),
          employment_type: get('employment_type'),
          direct_manager: get('direct_manager'),
          active: get('active') || 'yes'
        };
        if (!isCreate && originalId != null) payload.id = originalId;
        if (!payload.emp_id) {
          if (statusEl) statusEl.textContent = 'יש להזין מזהה מדריך';
          return;
        }
        try {
          saveBtn.disabled = true;
          if (statusEl) statusEl.textContent = 'שומר...';
          await (isCreate
            ? api.addContact({ kind: 'instructor', row: payload })
            : api.saveContact({ kind: 'instructor', row: payload }));
          showToast('✅ נשמר בהצלחה', 'success', 1800);
          ui.closeModal();
          rerender();
        } catch (err) {
          if (statusEl) statusEl.textContent = `שגיאה: ${String(err?.message || '')}`;
        } finally {
          saveBtn.disabled = false;
        }
      };
    };

    const findUnifiedRow = (payload = {}) => {
      const sourceTable = String(payload.source_table || '').trim();
      const sourceId = String(payload.source_id || '').trim();
      if (sourceTable && sourceId) {
        const hit = schoolRows.find((row) =>
          String(row.source_table || '') === sourceTable &&
          String(row.source_id || '') === sourceId
        );
        if (hit) return hit;
      }
      return schoolRows.find((row) =>
        String(row.authority || '') === String(payload.authority || '') &&
        String(row.school || '') === String(payload.school || '') &&
        String(row.contact_name || '') === String(payload.contact_name || '')
      ) || null;
    };

    const openUnifiedEditor = (row) => {
      if (!ui || !row) return;
      const isSchoolRecord = String(row.source_table || '') === 'schools';
      ui.openModal({
        title: isSchoolRecord ? 'עריכת פרטי בית ספר' : 'עריכת לקוח / איש קשר',
        content: isSchoolRecord ? schoolDetailsFormHtml(row) : schoolFormHtml(row),
        actions: `<button type="button" class="ds-btn ds-btn--primary" data-save-contact="unified">שמירה</button>
                  <button type="button" class="ds-btn" data-ui-close-modal>ביטול</button>`
      });
      const saveBtn = document.querySelector('[data-save-contact="unified"]');
      if (!saveBtn) return;
      const modalEl = document.querySelector('.ds-modal__content');
      const clientTypeSelectEl = modalEl?.querySelector('[data-school-client-type]');
      const schoolFieldEl = modalEl?.querySelector('[data-school-field]');
      clientTypeSelectEl?.addEventListener('change', () => {
        if (schoolFieldEl) schoolFieldEl.hidden = clientTypeSelectEl.value === 'authority';
      });
      saveBtn.onclick = async () => {
        const modal = document.querySelector('.ds-modal__content');
        if (!modal) return;
        const statusEl = modal.querySelector('[data-contact-form-status]');
        const get = (name) => String(modal.querySelector(`[name="${name}"]`)?.value || '').trim();
        const sourceTable = get('source_table');
        const sourceId = get('source_id');
        if (!sourceTable || !sourceId) {
          if (statusEl) statusEl.textContent = 'חסר מזהה מקור לעריכה';
          return;
        }

        let fields = {};
        if (sourceTable === 'schools') {
          fields = {
            principal_name: get('principal_name'),
            school_phone: get('school_phone'),
            institution_address: get('institution_address'),
            city: get('city'),
            district: get('district')
          };
        } else {
          const clientType = get('client_type') || 'school';
          const authority = get('authority');
          const school = clientType === 'authority' ? '' : get('school');
          fields = {
            client_type: clientType,
            client_name: clientType === 'school' ? school : (clientType === 'authority' ? authority : (school || authority)),
            authority_id: get('authority_id') || null,
            school_id: clientType === 'school' ? (get('school_id') || null) : null,
            semel_mosad: clientType === 'school' ? (get('semel_mosad') || null) : null,
            authority,
            school: school || null,
            contact_name: get('contact_name'),
            contact_role: get('contact_role'),
            phone: get('phone'),
            mobile: get('mobile'),
            email: get('email'),
            address: get('address'),
            notes: get('notes')
          };
        }

        try {
          saveBtn.disabled = true;
          if (statusEl) statusEl.textContent = 'שומר...';
          await api.updateUnifiedContactRecord({ source_table: sourceTable, source_id: sourceId, fields });
          showToast('✅ נשמר בהצלחה', 'success', 1800);
          ui.closeModal();
          rerender();
        } catch (err) {
          if (statusEl) statusEl.textContent = `שגיאה: ${String(err?.message || '')}`;
        } finally {
          saveBtn.disabled = false;
        }
      };
    };

    const openSchoolEditor = (row, isCreate = false) => {
      if (!ui) return;
      const target = row || {};
      const originalId = target.id != null ? target.id : null;
      ui.openModal({
        title: isCreate ? 'הוספת לקוח / איש קשר' : 'עריכת לקוח / איש קשר',
        content: schoolFormHtml(target),
        actions: `<button type="button" class="ds-btn ds-btn--primary" data-save-contact="school">${isCreate ? 'הוספה' : 'שמירה'}</button>
                  <button type="button" class="ds-btn" data-ui-close-modal>ביטול</button>`
      });
      const saveBtn = document.querySelector('[data-save-contact="school"]');
      if (!saveBtn) return;
      const modalEl = document.querySelector('.ds-modal__content');
      const clientTypeSelectEl = modalEl?.querySelector('[data-school-client-type]');
      const schoolFieldEl = modalEl?.querySelector('[data-school-field]');
      clientTypeSelectEl?.addEventListener('change', () => {
        if (schoolFieldEl) schoolFieldEl.hidden = clientTypeSelectEl.value === 'authority';
      });
      saveBtn.onclick = async () => {
        const modal = document.querySelector('.ds-modal__content');
        if (!modal) return;
        const statusEl = modal.querySelector('[data-contact-form-status]');
        const get = (name) => String(modal.querySelector(`[name="${name}"]`)?.value || '').trim();
        const clientType = get('client_type') || 'school';
        const authority = get('authority');
        const school = clientType === 'authority' ? '' : get('school');
        const clientName = clientType === 'school' ? school : (clientType === 'authority' ? authority : (school || authority));
        const payload = {
          client_type: clientType,
          client_name: clientName || null,
          authority_id: get('authority_id') || null,
          school_id: clientType === 'school' ? (get('school_id') || null) : null,
          semel_mosad: clientType === 'school' ? (get('semel_mosad') || null) : null,
          authority,
          school: school || null,
          contact_name: get('contact_name'),
          contact_role: get('contact_role'),
          phone: get('phone'),
          mobile: get('mobile'),
          email: get('email'),
          notes: get('notes')
        };
        if (!isCreate && originalId != null) payload.id = originalId;
        if (clientType === 'school' && (!authority || !school || !payload.contact_name)) {
          if (statusEl) statusEl.textContent = 'לבית ספר: יש להזין רשות, שם בית ספר ושם איש קשר';
          return;
        }
        if (clientType !== 'school' && (!authority || !payload.contact_name)) {
          if (statusEl) statusEl.textContent = 'יש להזין שם הרשות / הלקוח ושם איש קשר';
          return;
        }
        try {
          saveBtn.disabled = true;
          if (statusEl) statusEl.textContent = 'שומר...';
          await (isCreate
            ? api.addContact({ kind: 'school', row: payload })
            : api.saveContact({
                kind: 'school',
                row: payload,
                _supabase_orig: {
                  authority: String(target.authority || '').trim(),
                  school: String(target.school || '').trim(),
                  contact_name: String(target.contact_name || '').trim()
                }
              }));
          showToast('✅ נשמר בהצלחה', 'success', 1800);
          ui.closeModal();
          rerender();
        } catch (err) {
          if (statusEl) statusEl.textContent = `שגיאה: ${String(err?.message || '')}`;
        } finally {
          saveBtn.disabled = false;
        }
      };
    };

    root._contactsActionContext = {
      instrRows,
      schoolRows,
      decodePayload,
      openInstructorEditor,
      openSchoolEditor,
      openUnifiedEditor,
      findUnifiedRow
    };
    if (!root._contactsActionBound) {
      root._contactsActionBound = true;
      root.addEventListener('click', (ev) => {
        const btn = ev.target?.closest?.('[data-contact-action]');
        if (!btn || !root.contains(btn)) return;
        ev.preventDefault();
        ev.stopPropagation();
        const ctx = root._contactsActionContext || {};
        const action = btn.dataset.contactAction;
        if (action === 'add-instr') {
          ctx.openInstructorEditor?.({}, true);
          return;
        }
        if (action === 'add-school') {
          ctx.openSchoolEditor?.({}, true);
          return;
        }
        if (action === 'add-school-prefill') {
          const payload = ctx.decodePayload?.(btn) || {};
          ctx.openSchoolEditor?.({ ...payload, client_type: payload.client_type || 'school' }, true);
          return;
        }
        if (action === 'edit-instr') {
          const payload = ctx.decodePayload?.(btn) || {};
          const hit = (ctx.instrRows || []).find((r) => String(r.emp_id || '') === String(payload.emp_id || ''));
          if (hit) ctx.openInstructorEditor?.(hit, false);
          return;
        }
        if (action === 'edit-unified') {
          const payload = ctx.decodePayload?.(btn) || {};
          const hit = ctx.findUnifiedRow?.(payload);
          if (hit) ctx.openUnifiedEditor?.(hit);
          return;
        }
        if (action === 'edit-school') {
          const payload = ctx.decodePayload?.(btn) || {};
          const hit = ctx.findUnifiedRow?.(payload);
          if (hit) ctx.openUnifiedEditor?.(hit);
        }
      });
    }

  }
};

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  Object.assign(ta.style, { position: 'fixed', opacity: '0', top: '0', left: '0' });
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    const copied = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!copied;
  } catch (_) {
    document.body.removeChild(ta);
    return false;
  }
}

async function copyEmailToClipboard(email) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(email);
      return;
    } catch (_) {
      // fallback below
    }
  }
  if (!fallbackCopy(email)) throw new Error('copy-failed');
}
