import { escapeHtml } from './shared/html.js';
import { actNavGridHtml, bindActNavGrid } from './shared/act-nav-grid.js';
import { hebrewColumn, hebrewEmploymentType } from './shared/ui-hebrew.js';
import { dsScreenStack, dsEmptyState, dsStatusChip } from './shared/layout.js';

/* ─── Copy button ─── */

function copyBtn(email) {
  if (!email) return '';
  return `<button type="button" class="ci-copy-btn" data-copy-email="${escapeHtml(email)}" title="העתק כתובת מייל" aria-label="העתק מייל">⎘</button>`;
}

/* ─── Instructor contacts ─── */

function applyInstrSearch(rows, q) {
  if (!q) return rows;
  const lq = q.toLowerCase();
  return rows.filter((r) =>
    String(r.full_name || '').toLowerCase().includes(lq) ||
    String(r.emp_id   || '').toLowerCase().includes(lq) ||
    String(r.mobile   || '').toLowerCase().includes(lq) ||
    String(r.email    || '').toLowerCase().includes(lq)
  );
}

function instrDetailHtml(row, hideEmpIds) {
  const isActive = String(row.active || '').toLowerCase() !== 'no';
  const fields = [
    (!hideEmpIds && row.emp_id)  ? { icon: '#',  label: hebrewColumn('emp_id'),          val: row.emp_id }                               : null,
    row.employment_type           ? { icon: '💼', label: hebrewColumn('employment_type'), val: hebrewEmploymentType(row.employment_type) } : null,
    row.email                     ? { icon: '✉',  label: hebrewColumn('email'),           val: row.email, copy: true }                    : null,
    row.address                   ? { icon: '📍', label: hebrewColumn('address'),         val: row.address }                              : null,
    row.direct_manager            ? { icon: '👤', label: hebrewColumn('direct_manager'),  val: row.direct_manager }                       : null,
                                    { icon: '●',  label: hebrewColumn('active'),          status: true, isActive }
  ].filter(Boolean);

  const linesHtml = fields.map(({ icon, label, val, copy, status, isActive: active }) => {
    let valueHtml;
    if (status) {
      valueHtml = dsStatusChip(active ? 'פעיל' : 'לא פעיל', active ? 'success' : 'neutral');
    } else if (copy) {
      valueHtml = `<span class="ci-dv">${escapeHtml(String(val))}</span>${copyBtn(val)}`;
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

function renderInstrCard(row, hideEmpIds) {
  const name      = escapeHtml(row.full_name || row.emp_id || '—');
  const phone     = escapeHtml(row.mobile || '');
  const isInactive = String(row.active || '').toLowerCase() === 'no';

  return `
    <details class="ci-card${isInactive ? ' ci-card--inactive' : ''}">
      <summary class="ci-card__head">
        <span class="ci-card__chevron" aria-hidden="true">›</span>
        <span class="ci-card__name">${name}${isInactive ? ' <span class="ci-card__badge">לא פעיל</span>' : ''}</span>
        ${phone ? `<span class="ci-card__phone"><span aria-hidden="true">📱</span>${phone}</span>` : ''}
      </summary>
      ${instrDetailHtml(row, hideEmpIds)}
    </details>`;
}

function instrTabHtml(rows, searchQ, hideEmpIds) {
  const filtered = applyInstrSearch(rows, searchQ);
  const body = filtered.length === 0
    ? dsEmptyState('לא נמצאו אנשי קשר')
    : `<div class="ci-card-list">${filtered.map((r) => renderInstrCard(r, hideEmpIds)).join('')}</div>`;
  return { filtered, body };
}

/* ─── School contacts ─── */

function applySchoolSearch(rows, q) {
  if (!q) return rows;
  const lq = q.toLowerCase();
  return rows.filter((r) =>
    String(r.school       || '').toLowerCase().includes(lq) ||
    String(r.authority    || '').toLowerCase().includes(lq) ||
    String(r.contact_name || '').toLowerCase().includes(lq) ||
    String(r.mobile       || '').toLowerCase().includes(lq) ||
    String(r.email        || '').toLowerCase().includes(lq)
  );
}

function schoolPersonHtml(row) {
  const fields = [
    row.contact_name                          ? { icon: '👤', label: 'רכז/ת', val: row.contact_name }  : null,
    row.phone                                  ? { icon: '☎',  label: 'טלפון', val: row.phone }          : null,
    row.mobile && row.mobile !== row.phone     ? { icon: '📱', label: 'נייד',  val: row.mobile }         : null,
    row.email                                  ? { icon: '✉',  label: 'מייל',  val: row.email, copy: true } : null,
    row.notes                                  ? { icon: '📋', label: 'הערות', val: row.notes }          : null,
  ].filter(Boolean);

  if (!fields.length) return '';

  const linesHtml = fields.map(({ icon, label, val, copy }) => {
    const valueHtml = copy
      ? `<span class="ci-dv">${escapeHtml(String(val))}</span>${copyBtn(val)}`
      : `<span class="ci-dv">${escapeHtml(String(val))}</span>`;
    return `<div class="ci-df">
      <span class="ci-df__icon" aria-hidden="true">${icon}</span>
      <span class="ci-df__label">${escapeHtml(label)}</span>
      <span class="ci-df__value">${valueHtml}</span>
    </div>`;
  }).join('');

  return `<div class="sc-person">${linesHtml}</div>`;
}

function groupBySchool(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = String(row.school || '').trim() || '—';
    if (!map.has(key)) map.set(key, { authority: row.authority || '', rows: [] });
    map.get(key).rows.push(row);
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'he')));
}

function renderSchoolCard(schoolName, { authority, rows }) {
  const personsHtml = rows.map(schoolPersonHtml).filter(Boolean).join('');
  if (!personsHtml) return '';

  const countLabel = rows.length === 1 ? '1 איש קשר' : `${rows.length} אנשי קשר`;

  return `
    <details class="sc-card">
      <summary class="sc-card__head">
        <span class="sc-card__chevron" aria-hidden="true">›</span>
        <span class="sc-card__name"><span class="sc-card__school-icon" aria-hidden="true">🏫</span>${escapeHtml(schoolName)}</span>
        ${authority ? `<span class="sc-card__auth">${escapeHtml(String(authority))}</span>` : ''}
        <span class="sc-card__count">${escapeHtml(countLabel)}</span>
      </summary>
      <div class="sc-card__body">${personsHtml}</div>
    </details>`;
}

function schoolTabHtml(rows, searchQ) {
  const filtered = applySchoolSearch(rows, searchQ);
  if (filtered.length === 0) return { filtered, body: dsEmptyState('לא נמצאו אנשי קשר') };
  const groups = groupBySchool(filtered);
  let html = '';
  groups.forEach((g, name) => { html += renderSchoolCard(name, g); });
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
    const hideEmpIds    = !!state?.clientSettings?.hide_emp_id_on_screens;

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
      const { body } = instrTabHtml(instrRows, instrQ, hideEmpIds);
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

  bind({ root, state, rerender }) {
    bindActNavGrid(root, { state, rerender });

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
