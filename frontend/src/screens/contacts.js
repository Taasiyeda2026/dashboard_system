import { escapeHtml } from './shared/html.js';
import { actNavGridHtml, bindActNavGrid } from './shared/act-nav-grid.js';
import { hebrewColumn, hebrewEmploymentType } from './shared/ui-hebrew.js';
import { dsScreenStack, dsEmptyState, dsStatusChip } from './shared/layout.js';

const AVATAR_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6',
  '#f43f5e', '#a855f7'
];

/* ─── Copy button ─── */

function copyBtn(email, label = 'העתק מייל') {
  if (!email) return '';
  return `<button type="button" class="ci-copy-btn" data-copy-email="${escapeHtml(email)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">⎘</button>`;
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

function applyInstrSearch(rows, q) {
  if (!q) return rows;
  const lq = q.toLowerCase();
  return rows.filter((r) =>
    String(r.full_name || '').toLowerCase().includes(lq) ||
    String(r.mobile   || '').toLowerCase().includes(lq) ||
    String(r.email    || '').toLowerCase().includes(lq)
  );
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
    <button type="button" class="ci-person-card${isInactive ? ' ci-person-card--inactive' : ''}"
      data-card-action="icontact:${encodeURIComponent(row.emp_id || '')}">
      <span class="ci-person-card__avatar" style="background:${bg}" aria-hidden="true">${initials}</span>
      <span class="ci-person-card__info">
        <span class="ci-person-card__name">${name}</span>
        <span class="ci-person-card__phone">${phone || '—'}</span>
      </span>
    </button>`;
}

function instrTabHtml(rows, searchQ) {
  const filtered = applyInstrSearch(rows, searchQ);
  const body = filtered.length === 0
    ? dsEmptyState('לא נמצאו אנשי קשר')
    : `<div class="ci-person-grid">${filtered.map((r) => renderInstrCard(r)).join('')}</div>`;
  return { filtered, body };
}

/* ─── School contacts ─── */

function applySchoolSearch(rows, q) {
  if (!q) return rows;
  const lq = q.toLowerCase();
  return rows.filter((r) =>
    String(r.school       || '').toLowerCase().includes(lq) ||
    String(r.authority    || '').toLowerCase().includes(lq) ||
    String(r.contact_name || '').toLowerCase().includes(lq)
  );
}

function schoolPersonHtml(row) {
  const name = row.contact_name ? escapeHtml(String(row.contact_name)) : '—';
  const role = row.role ? escapeHtml(String(row.role)) : '';
  const phonePrimary = row.phone ? escapeHtml(String(row.phone)) : '';
  const mobile = row.mobile && row.mobile !== row.phone ? escapeHtml(String(row.mobile)) : '';
  const email = row.email ? escapeHtml(String(row.email)) : '';
  if (!name && !phonePrimary && !mobile && !email) return '';
  return `<div class="sc-person">
    <div class="sc-person__top">
      <span class="sc-person__name">${name}</span>
      ${role ? `<span class="sc-person__role">${role}</span>` : ''}
    </div>
    <div class="sc-person__phones">
      ${phonePrimary ? `<span class="sc-person__phone"><span aria-hidden="true">☎</span>${phonePrimary}</span>` : ''}
      ${mobile ? `<span class="sc-person__phone"><span aria-hidden="true">📱</span>${mobile}</span>` : ''}
    </div>
    ${email ? `<div class="sc-person__email"><span class="ci-dv">${email}</span>${copyBtn(email, 'העתק מייל')}</div>` : ''}
  </div>`;
}

function groupByAuthorityThenSchool(rows) {
  const authMap = new Map();
  for (const row of rows) {
    const authority = String(row.authority || '').trim() || '—';
    if (!authMap.has(authority)) authMap.set(authority, []);
    authMap.get(authority).push(row);
  }
  const sorted = new Map([...authMap.entries()].sort((a, b) => a[0].localeCompare(b[0], 'he')));
  const result = new Map();
  sorted.forEach((authRows, authority) => {
    const schoolMap = new Map();
    for (const row of authRows) {
      const school = String(row.school || '').trim() || '—';
      if (!schoolMap.has(school)) schoolMap.set(school, []);
      schoolMap.get(school).push(row);
    }
    result.set(authority, new Map([...schoolMap.entries()].sort((a, b) => a[0].localeCompare(b[0], 'he'))));
  });
  return result;
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
    <div class="sc-card__body">${personsHtml}</div>
  </details>`;
}

function renderAuthorityGroup(authority, schoolsMap) {
  let schoolsHtml = '';
  schoolsMap.forEach((rows, schoolName) => { schoolsHtml += renderSchoolCard(schoolName, rows); });
  if (!schoolsHtml) return '';
  const schoolCount = schoolsMap.size;
  const countLabel = schoolCount === 1 ? '1 בית ספר' : `${schoolCount} בתי ספר`;
  return `<div class="sc-authority-group">
    <div class="sc-authority-head">
      <span class="sc-authority-icon" aria-hidden="true">🏛️</span>
      <span class="sc-authority-name">${escapeHtml(authority)}</span>
      <span class="sc-authority-count">${escapeHtml(countLabel)}</span>
    </div>
    <div class="sc-school-grid">${schoolsHtml}</div>
  </div>`;
}

function schoolTabHtml(rows, searchQ) {
  const filtered = applySchoolSearch(rows, searchQ);
  if (filtered.length === 0) return { filtered, body: dsEmptyState('לא נמצאו אנשי קשר') };
  const authorityGroups = groupByAuthorityThenSchool(filtered);
  let html = '';
  authorityGroups.forEach((schoolsMap, authority) => { html += renderAuthorityGroup(authority, schoolsMap); });
  return { filtered, body: `<div class="sc-card-list">${html}</div>` };
}

/* ─── Screen ─── */

export const contactsScreen = {
  load: ({ api }) => api.contacts(),

  render(data, { state } = {}) {
    const instrRows  = Array.isArray(data?.instructor_rows) ? data.instructor_rows : [];
    const schoolRows = Array.isArray(data?.school_rows)     ? data.school_rows     : [];
    const canViewInstr  = data?.can_view_instructors !== false;
    const canViewSchool = data?.can_view_schools     !== false;
    const tab     = state?.contactsTab || (canViewInstr ? 'instr' : 'school');
    const instrQ  = state?.contactsInstrSearch  || '';
    const schoolQ = state?.contactsSchoolSearch || '';

    const tabBtns = [
      canViewInstr  && { key: 'instr',  label: `אנשי קשר מדריכים (${instrRows.length})`  },
      canViewSchool && { key: 'school', label: `אנשי קשר בתי ספר (${schoolRows.length})` }
    ].filter(Boolean).map((t) =>
      `<button type="button" class="ds-chip--tab${tab === t.key ? ' is-active' : ''}" data-contacts-tab="${t.key}">${escapeHtml(t.label)}</button>`
    ).join('');

    let searchInput = '';
    let listHtml    = '';

    if (tab === 'instr' && canViewInstr) {
      const { body } = instrTabHtml(instrRows, instrQ);
      searchInput = `<input id="contacts-instr-search" type="search" class="ds-search-input"
        placeholder="חיפוש לפי שם / טלפון / מייל…" value="${escapeHtml(instrQ)}" dir="rtl" />`;
      listHtml = body;
    } else if (tab === 'school' && canViewSchool) {
      const { body } = schoolTabHtml(schoolRows, schoolQ);
      searchInput = `<input id="contacts-school-search" type="search" class="ds-search-input"
        placeholder="חיפוש לפי בית ספר / רשות / איש קשר…" value="${escapeHtml(schoolQ)}" dir="rtl" />`;
      listHtml = body;
    }

    return dsScreenStack(`
      ${actNavGridHtml(state)}
      <div class="ds-chip-group" dir="rtl">${tabBtns}</div>
      <div class="ds-screen-top-row">
        ${searchInput}
      </div>
      <div class="contacts-list-wrap" dir="rtl">${listHtml}</div>
    `);
  },

  bind({ root, data, state, ui, rerender }) {
    bindActNavGrid(root, { state, rerender });
    const instrRows = Array.isArray(data?.instructor_rows) ? data.instructor_rows : [];
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;

    root.querySelectorAll('[data-contacts-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.contactsTab = btn.dataset.contactsTab;
        rerender();
      });
    });

    root.querySelector('#contacts-instr-search')?.addEventListener('input', (ev) => {
      state.contactsInstrSearch = ev.target.value || '';
      rerender();
    });

    root.querySelector('#contacts-school-search')?.addEventListener('input', (ev) => {
      state.contactsSchoolSearch = ev.target.value || '';
      rerender();
    });

    root.querySelectorAll('[data-copy-email]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const email = btn.dataset.copyEmail;
        const doToast = () => showToast('המייל הועתק ✓');
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(email).then(doToast).catch(() => fallbackCopy(email, doToast));
        } else {
          fallbackCopy(email, doToast);
        }
      });
    });

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('icontact:')) return;
      const empId = decodeURIComponent(action.slice('icontact:'.length));
      const hit = instrRows.find((r) => String(r.emp_id || '') === String(empId));
      if (!hit) return;
      ui.openDrawer({
        title: hit.full_name || hit.emp_id || 'איש קשר',
        content: instrDrawerHtml(hit, hideEmpIds)
      });
    });
  }
};

function fallbackCopy(text, cb) {
  const ta = document.createElement('textarea');
  ta.value = text;
  Object.assign(ta.style, { position: 'fixed', opacity: '0', top: '0', left: '0' });
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); } catch (_) { /* ignore */ }
  document.body.removeChild(ta);
  cb?.();
}

function showToast(msg) {
  const existing = document.querySelector('.contacts-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'contacts-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('contacts-toast--show'));
  setTimeout(() => {
    el.classList.remove('contacts-toast--show');
    setTimeout(() => el.remove(), 300);
  }, 1800);
}
