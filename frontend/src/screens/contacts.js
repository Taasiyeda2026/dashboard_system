import { escapeHtml } from './shared/html.js';
import { actNavGridHtml, bindActNavGrid } from './shared/act-nav-grid.js';
import { hebrewColumn, hebrewEmploymentType } from './shared/ui-hebrew.js';
import { dsScreenStack, dsEmptyState, dsStatusChip } from './shared/layout.js';
import { showToast } from './shared/toast.js';

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

  const actions = `<span class="ci-person-card__actions">${actionBtn('edit-instr', { emp_id: row.emp_id }, '✎')}</span>`;
  return `
    <button type="button" class="ci-person-card${isInactive ? ' ci-person-card--inactive' : ''}"
      data-card-action="icontact:${encodeURIComponent(row.emp_id || '')}">
      <span class="ci-person-card__avatar" style="background:${bg}" aria-hidden="true">${initials}</span>
      <span class="ci-person-card__info">
        <span class="ci-person-card__name">${name}</span>
        <span class="ci-person-card__phone">${phone || '—'}</span>
      </span>
      ${actions}
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
    <div class="sc-card__body">
      <div class="sc-contact-section-title">אנשי קשר</div>
      <div class="sc-contact-list">${personsHtml}</div>
    </div>
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

function instructorFormHtml(row = {}) {
  return `
    <div class="ds-perm-edit-form" dir="rtl">
      <div class="ds-perm-field"><span class="ds-muted">מזהה מדריך</span><input class="ds-input ds-input--sm" name="emp_id" value="${escapeHtml(String(row.emp_id || ''))}" ${row.emp_id ? 'readonly' : ''}></div>
      <div class="ds-perm-field"><span class="ds-muted">שם מלא</span><input class="ds-input ds-input--sm" name="full_name" value="${escapeHtml(String(row.full_name || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">נייד</span><input class="ds-input ds-input--sm" name="mobile" value="${escapeHtml(String(row.mobile || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">אימייל</span><input class="ds-input ds-input--sm" name="email" value="${escapeHtml(String(row.email || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">כתובת</span><input class="ds-input ds-input--sm" name="address" value="${escapeHtml(String(row.address || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">סוג העסקה</span><select class="ds-input ds-input--sm" name="employment_type">
        <option value="">—</option>
        <option value="full_time" ${String(row.employment_type || '') === 'full_time' ? 'selected' : ''}>משרה מלאה</option>
        <option value="part_time" ${String(row.employment_type || '') === 'part_time' ? 'selected' : ''}>משרה חלקית</option>
      </select></div>
      <div class="ds-perm-field"><span class="ds-muted">מנהל ישיר</span><input class="ds-input ds-input--sm" name="direct_manager" value="${escapeHtml(String(row.direct_manager || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">פעיל</span><select class="ds-input ds-input--sm" name="active">
        <option value="yes" ${String(row.active || 'yes').toLowerCase() === 'yes' ? 'selected' : ''}>כן</option>
        <option value="no" ${String(row.active || '').toLowerCase() === 'no' ? 'selected' : ''}>לא</option>
      </select></div>
      <p class="ds-muted" data-contact-form-status role="status"></p>
    </div>
  `;
}

function schoolFormHtml(row = {}) {
  return `
    <div class="ds-perm-edit-form" dir="rtl">
      <div class="ds-perm-field"><span class="ds-muted">רשות</span><input class="ds-input ds-input--sm" name="authority" value="${escapeHtml(String(row.authority || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">בית ספר</span><input class="ds-input ds-input--sm" name="school" value="${escapeHtml(String(row.school || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">שם איש קשר</span><input class="ds-input ds-input--sm" name="contact_name" value="${escapeHtml(String(row.contact_name || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">תפקיד</span><input class="ds-input ds-input--sm" name="role" value="${escapeHtml(String(row.role || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">טלפון</span><input class="ds-input ds-input--sm" name="phone" value="${escapeHtml(String(row.phone || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">נייד</span><input class="ds-input ds-input--sm" name="mobile" value="${escapeHtml(String(row.mobile || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">אימייל</span><input class="ds-input ds-input--sm" name="email" value="${escapeHtml(String(row.email || ''))}"></div>
      <div class="ds-perm-field"><span class="ds-muted">הערות</span><textarea class="ds-input ds-input--sm" name="notes" rows="2">${escapeHtml(String(row.notes || ''))}</textarea></div>
      <p class="ds-muted" data-contact-form-status role="status"></p>
    </div>
  `;
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
        <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-contact-action="add-${tab === 'instr' ? 'instr' : 'school'}">➕ הוספה</button>
      </div>
      <div class="contacts-list-wrap" dir="rtl">${listHtml}</div>
    `);
  },

  bind({ root, data, state, ui, rerender, api }) {
    bindActNavGrid(root, { state, rerender });
    const instrRows = Array.isArray(data?.instructor_rows) ? data.instructor_rows : [];
    const schoolRows = Array.isArray(data?.school_rows) ? data.school_rows : [];
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
        const doToast = () => showToast('המייל הועתק ✓', 'success', 1200);
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(email).then(doToast).catch(() => fallbackCopy(email, doToast));
        } else {
          fallbackCopy(email, doToast);
        }
      });
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
      ui.openModal({
        title: isCreate ? 'הוספת איש קשר מדריך' : 'עריכת איש קשר מדריך',
        content: instructorFormHtml(target),
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
        if (!payload.emp_id) {
          if (statusEl) statusEl.textContent = 'יש להזין מזהה מדריך';
          return;
        }
        try {
          saveBtn.disabled = true;
          if (statusEl) statusEl.textContent = 'שומר...';
          await (isCreate
            ? api.addContact({ kind: 'instructor', row: payload })
            : api.saveContact({ kind: 'instructor', row_index: target._row_index, row: payload }));
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
      ui.openModal({
        title: isCreate ? 'הוספת איש קשר בית ספר' : 'עריכת איש קשר בית ספר',
        content: schoolFormHtml(target),
        actions: `<button type="button" class="ds-btn ds-btn--primary" data-save-contact="school">${isCreate ? 'הוספה' : 'שמירה'}</button>
                  <button type="button" class="ds-btn" data-ui-close-modal>ביטול</button>`
      });
      const saveBtn = document.querySelector('[data-save-contact="school"]');
      if (!saveBtn) return;
      saveBtn.onclick = async () => {
        const modal = document.querySelector('.ds-modal__content');
        if (!modal) return;
        const statusEl = modal.querySelector('[data-contact-form-status]');
        const get = (name) => String(modal.querySelector(`[name="${name}"]`)?.value || '').trim();
        const payload = {
          authority: get('authority'),
          school: get('school'),
          contact_name: get('contact_name'),
          role: get('role'),
          phone: get('phone'),
          mobile: get('mobile'),
          email: get('email'),
          notes: get('notes'),
          _row_index: target._row_index
        };
        if (!payload.authority || !payload.school || !payload.contact_name) {
          if (statusEl) statusEl.textContent = 'יש להזין לפחות רשות, בית ספר ושם איש קשר';
          return;
        }
        try {
          saveBtn.disabled = true;
          if (statusEl) statusEl.textContent = 'שומר...';
          await (isCreate
            ? api.addContact({ kind: 'school', row: payload })
            : api.saveContact({ kind: 'school', row_index: target._row_index, row: payload }));
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

    root.querySelectorAll('[data-contact-action]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const action = btn.dataset.contactAction;
        if (action === 'add-instr') {
          openInstructorEditor({}, true);
          return;
        }
        if (action === 'add-school') {
          openSchoolEditor({}, true);
          return;
        }
        if (action === 'edit-instr') {
          const payload = decodePayload(btn);
          const hit = instrRows.find((r) => String(r.emp_id || '') === String(payload.emp_id || ''));
          if (hit) openInstructorEditor(hit, false);
          return;
        }
        if (action === 'edit-school') {
          const payload = decodePayload(btn);
          const idx = Number(payload._row_index);
          const hit = Number.isFinite(idx)
            ? schoolRows.find((r) => Number(r._row_index) === idx)
            : null;
          if (hit) openSchoolEditor(hit, false);
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

