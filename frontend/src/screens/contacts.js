import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewEmploymentType } from './shared/ui-hebrew.js';
import { dsScreenStack, dsEmptyState, dsStatusChip } from './shared/layout.js';
import { showToast } from './shared/toast.js';
import {
  ensureActivityListFilters,
  prepareRowsForSearch,
  applyLocalFilters,
  filtersToolbarHtml
} from './shared/activity-list-filters.js';
import { getManagerUsers } from './shared/activity-options.js';

const AVATAR_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6',
  '#f43f5e', '#a855f7'
];
const CONTACTS_SCOPE = 'contacts';

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
  const phone = escapeHtml(row.mobile || '');
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
          <span class="ci-person-card__phone">${phone || '—'}</span>
        </span>
      </button>
      <span class="ci-person-card__actions">${actionBtn('edit-instr', { emp_id: row.emp_id }, '✎')}</span>
    </div>`;
}

function instrTabHtml(rows, filters) {
  const filtered = applyLocalFilters(rows, filters, { filterFields: [] });
  const body = filtered.length === 0
    ? dsEmptyState('לא נמצאו אנשי קשר')
    : `<div class="ci-person-grid">${filtered.map((r) => renderInstrCard(r)).join('')}</div>`;
  return { filtered, body };
}

/* ─── School contacts ─── */

function schoolPersonHtml(row) {
  const name = row.contact_name ? escapeHtml(String(row.contact_name)) : '';
  const role = row.contact_role ? escapeHtml(String(row.contact_role)) : '';
  const mobile = row.mobile ? escapeHtml(String(row.mobile)) : '';
  const email = row.email ? escapeHtml(String(row.email)) : '';
  if (!name && !role && !mobile && !email) return '';

  const contactItems = [
    mobile ? `<span class="sc-person__contact-item sc-person__contact-item--mobile" dir="ltr">${mobile}</span>` : '',
    email ? `<span class="sc-person__contact-item sc-person__contact-item--email" dir="ltr"><span class="ci-dv">${email}</span>${copyBtn(email, 'העתק מייל')}</span>` : ''
  ].filter(Boolean).join('<span class="sc-person__contact-sep" aria-hidden="true">•</span>');

  const editBtn = actionBtn('edit-school', {
    _row_index: row._row_index,
    authority: row.authority,
    school: row.school,
    contact_name: row.contact_name
  }, '✎');

  return `<article class="sc-person">
    <div class="sc-person__top">
      ${name ? `<div class="sc-person__name">${name}</div>` : ''}
      <span class="sc-person__actions">${editBtn}</span>
    </div>
    ${role ? `<div class="sc-person__role">${role}</div>` : ''}
    ${contactItems ? `<div class="sc-person__contact-row">${contactItems}</div>` : ''}
  </article>`;
}

const HE_ALPHA = ['א','ב','ג','ד','ה','ו','ז','ח','ט','י','כ','ל','מ','נ','ס','ע','פ','צ','ק','ר','ש','ת'];

function firstHebrewLetter(str) {
  const ch = String(str || '').trim().charAt(0);
  return HE_ALPHA.includes(ch) ? ch : '#';
}

function groupByAuthorityThenSchool(rows) {
  const authMap = new Map();
  for (const row of rows) {
    const authority = String(row.authority || row.client_name || '').trim() || '—';
    if (!authMap.has(authority)) authMap.set(authority, []);
    authMap.get(authority).push(row);
  }
  const sorted = new Map([...authMap.entries()].sort((a, b) => a[0].localeCompare(b[0], 'he')));
  const result = new Map();
  sorted.forEach((authRows, authority) => {
    const schoolMap = new Map();
    for (const row of authRows) {
      const isAuthorityType = String(row.client_type || '').trim() === 'authority' || !String(row.school || '').trim();
      if (isAuthorityType) {
        if (!schoolMap.has('__direct__')) schoolMap.set('__direct__', []);
        schoolMap.get('__direct__').push(row);
      } else {
        const school = String(row.school || '').trim() || '—';
        if (!schoolMap.has(school)) schoolMap.set(school, []);
        schoolMap.get(school).push(row);
      }
    }
    result.set(authority, new Map([...schoolMap.entries()].sort((a, b) => {
      if (a[0] === '__direct__') return -1;
      if (b[0] === '__direct__') return 1;
      return a[0].localeCompare(b[0], 'he');
    })));
  });
  return result;
}

function groupByLetter(authorityGroupsMap) {
  const letterMap = new Map();
  authorityGroupsMap.forEach((schoolsMap, authority) => {
    const letter = firstHebrewLetter(authority);
    if (!letterMap.has(letter)) letterMap.set(letter, new Map());
    letterMap.get(letter).set(authority, schoolsMap);
  });
  return letterMap;
}

function renderSchoolCard(schoolName, rows) {
  const personsHtml = rows.map(schoolPersonHtml).filter(Boolean).join('');
  if (!personsHtml) return '';
  const countLabel = rows.length === 1 ? '1 איש קשר' : `${rows.length} אנשי קשר`;
  return `<details class="sc-card">
    <summary class="sc-card__head">
      <span class="sc-card__chevron" aria-hidden="true">›</span>
      <span class="sc-card__school-icon" aria-hidden="true">🏫</span>
      <span class="sc-card__name">${escapeHtml(schoolName)}</span>
      <span class="sc-card__count">${escapeHtml(countLabel)}</span>
    </summary>
    <div class="sc-card__body">
      <div class="sc-contact-section-title">אנשי קשר</div>
      <div class="sc-contact-list">${personsHtml}</div>
    </div>
  </details>`;
}

function renderAuthorityGroup(authority, schoolsMap) {
  let directPersonsHtml = '';
  let schoolsHtml = '';
  schoolsMap.forEach((rows, schoolName) => {
    if (schoolName === '__direct__') {
      directPersonsHtml = rows.map(schoolPersonHtml).filter(Boolean).join('');
    } else {
      schoolsHtml += renderSchoolCard(schoolName, rows);
    }
  });
  if (!directPersonsHtml && !schoolsHtml) return '';
  return `<div class="sc-authority-group">
    <div class="sc-authority-head">
      <span class="sc-authority-icon" aria-hidden="true">🏛️</span>
      <span class="sc-authority-name">${escapeHtml(authority)}</span>
    </div>
    ${directPersonsHtml ? `<div class="sc-contact-list">${directPersonsHtml}</div>` : ''}
    ${schoolsHtml ? `<div class="sc-school-stack">${schoolsHtml}</div>` : ''}
  </div>`;
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

function schoolFormHtml(row = {}) {
  const clientType = String(row.client_type || 'school');
  return `
    <div class="ds-perm-edit-form ds-contact-edit-form" dir="rtl">
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
      <div class="ds-perm-field"><span class="ds-muted">הערות</span><textarea class="ds-input ds-input--sm" name="notes" rows="2">${escapeHtml(String(row.notes || ''))}</textarea></div>
      <p class="ds-muted" data-contact-form-status role="status"></p>
    </div>
  `;
}

function renderLetterSection(letter, authoritiesMap) {
  let authHtml = '';
  authoritiesMap.forEach((schoolsMap, authority) => { authHtml += renderAuthorityGroup(authority, schoolsMap); });
  if (!authHtml) return '';
  return `<div class="sc-letter-section" data-letter-section="${escapeHtml(letter)}" hidden>
    <div class="sc-card-list">${authHtml}</div>
  </div>`;
}

function activeContactRows(tab, instrRows, schoolRows) {
  return tab === 'instr' ? instrRows : schoolRows;
}

function contactListHtml(tab, instrRows, schoolRows, filters, canViewInstr = true, canViewSchool = true) {
  if (tab === 'instr' && canViewInstr) return instrTabHtml(instrRows, filters).body;
  if (tab === 'school' && canViewSchool) return schoolTabHtml(schoolRows, filters).body;
  return dsEmptyState('לא נמצאו אנשי קשר');
}

function schoolTabHtml(rows, filters) {
  const filtered = applyLocalFilters(rows, filters, { filterFields: [] });
  if (filtered.length === 0) return { filtered, body: dsEmptyState('לא נמצאו אנשי קשר') };
  const authorityGroups = groupByAuthorityThenSchool(filtered);
  const byLetter = groupByLetter(authorityGroups);

  const alphaBtns = [...byLetter.keys()].map((letter) =>
    `<button type="button" class="sc-alpha-btn" data-alpha-btn="${escapeHtml(letter)}" aria-expanded="false">${escapeHtml(letter)}</button>`
  ).join('');
  const alphaBar = `<div class="sc-alpha-bar" role="toolbar" aria-label="אלפון א-ת" dir="rtl">${alphaBtns}</div>`;

  let sectionsHtml = '';
  byLetter.forEach((authoritiesMap, letter) => { sectionsHtml += renderLetterSection(letter, authoritiesMap); });

  return { filtered, body: `${alphaBar}${sectionsHtml}` };
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
      'mobile', 'phone', 'email', 'authority', 'school',
      'role', 'contact_role', 'position', 'active', 'notes', 'address',
      'instructor_name', 'activity_name', 'activity_type', 'client_type', 'client_name', 'authority_id', 'school_id', 'semel_mosad'
    ]);
    const filters = ensureActivityListFilters(state, CONTACTS_SCOPE);
    const canViewInstr  = data?.can_view_instructors !== false;
    const canViewSchool = data?.can_view_schools     !== false;
    const tab     = state?.contactsTab || (canViewInstr ? 'instr' : 'school');
    const tabBtns = [
      canViewInstr  && { key: 'instr',  label: `אנשי קשר מדריכים (${instrRows.length})`  },
      canViewSchool && { key: 'school', label: `לקוחות ואנשי קשר (${schoolRows.length})` }
    ].filter(Boolean).map((t) =>
      `<button type="button" class="ds-chip--tab${tab === t.key ? ' is-active' : ''}" data-contacts-tab="${t.key}">${escapeHtml(t.label)}</button>`
    ).join('');

    let searchInput = '';
    const listHtml = contactListHtml(tab, instrRows, schoolRows, filters, canViewInstr, canViewSchool);

    searchInput = filtersToolbarHtml(CONTACTS_SCOPE, activeContactRows(tab, instrRows, schoolRows), state, {
      searchPlaceholder: 'חיפוש לפי שם / תפקיד / טלפון / מייל / רשות / בית ספר…',
      filterFields: ['authority', 'school', 'client_type', 'contact_name'],
      search: true
    });

    return dsScreenStack(`
      <div class="ds-chip-group" dir="rtl">${tabBtns}</div>
      <div class="ds-screen-top-row">
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
          const isOpen = btn.getAttribute('aria-expanded') === 'true';
          root.querySelectorAll('[data-alpha-btn]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
          root.querySelectorAll('[data-alpha-btn]').forEach((b) => b.classList.remove('is-active'));
          root.querySelectorAll('[data-letter-section]').forEach((section) => { section.hidden = true; });
          if (!isOpen) {
            btn.setAttribute('aria-expanded', 'true');
            btn.classList.add('is-active');
            const section = root.querySelector(`[data-letter-section="${letter}"]`);
            if (section) section.hidden = false;
          }
        });
      });
    };

    const bindContactsListInteractions = (container = root) => {
      bindCopyBtns(container);
      bindAlphaBtns(container);
      ui?.bindInteractiveCards(container, openInstructorDrawer);
    };

    bindContactsListInteractions(root);

    const renderContactsListOnly = () => {
      const listWrap = root.querySelector('.contacts-list-wrap');
      if (!listWrap) return;
      const currentTab = state?.contactsTab || (data?.can_view_instructors !== false ? 'instr' : 'school');
      const filters = ensureActivityListFilters(state, CONTACTS_SCOPE);
      listWrap.innerHTML = contactListHtml(currentTab, instrRows, schoolRows, filters, data?.can_view_instructors !== false, data?.can_view_schools !== false);
      bindContactsListInteractions(listWrap);
    };

    const filters = ensureActivityListFilters(state, CONTACTS_SCOPE);
    const searchInput = root.querySelector(`[data-filter-search="${CONTACTS_SCOPE}"]`);
    const clearBtn = root.querySelector(`[data-filter-clear="${CONTACTS_SCOPE}"]`);
    let searchTimer;
    searchInput?.addEventListener('input', (ev) => {
      const nextValue = ev.target?.value || '';
      filters.q = nextValue;
      clearTimeout(searchTimer);
      const applySearch = () => {
        filters.appliedQ = nextValue;
        filters.visibleCount = 200;
        renderContactsListOnly();
      };
      if (!nextValue.trim()) {
        applySearch();
        return;
      }
      searchTimer = setTimeout(applySearch, 200);
    });
    clearBtn?.addEventListener('click', () => {
      clearTimeout(searchTimer);
      filters.q = '';
      filters.appliedQ = '';
      filters.visibleCount = 200;
      if (searchInput) searchInput.value = '';
      renderContactsListOnly();
      searchInput?.focus();
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
      openSchoolEditor
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
        if (action === 'edit-instr') {
          const payload = ctx.decodePayload?.(btn) || {};
          const hit = (ctx.instrRows || []).find((r) => String(r.emp_id || '') === String(payload.emp_id || ''));
          if (hit) ctx.openInstructorEditor?.(hit, false);
          return;
        }
        if (action === 'edit-school') {
          const payload = ctx.decodePayload?.(btn) || {};
          const hit = (ctx.schoolRows || []).find((r) =>
            String(r.authority || '') === String(payload.authority || '') &&
            String(r.school || '') === String(payload.school || '') &&
            String(r.contact_name || '') === String(payload.contact_name || '')
          ) || null;
          if (hit) ctx.openSchoolEditor?.(hit, false);
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
