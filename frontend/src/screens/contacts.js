import { escapeHtml } from './shared/html.js';
import { actNavGridHtml, bindActNavGrid } from './shared/act-nav-grid.js';
import { hebrewColumn, hebrewEmploymentType } from './shared/ui-hebrew.js';
import { dsCard, dsScreenStack, dsEmptyState, dsStatusChip } from './shared/layout.js';

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

function instrDrawerHtml(row, hideEmpIds) {
  const cols = ['emp_id', 'full_name', 'mobile', 'email', 'address', 'employment_type', 'direct_manager', 'active'];
  const lines = cols.map((col) => {
    if (hideEmpIds && col === 'emp_id') return '';
    const raw = row?.[col] ?? '';
    if (col === 'active') {
      const label = String(raw).toLowerCase() === 'yes' ? 'כן' : 'לא';
      const kind  = String(raw).toLowerCase() === 'yes' ? 'success' : 'neutral';
      return `<p><strong>${escapeHtml(hebrewColumn(col))}:</strong> ${dsStatusChip(label, kind)}</p>`;
    }
    const val = col === 'employment_type' ? hebrewEmploymentType(raw) : (raw || '—');
    return `<p><strong>${escapeHtml(hebrewColumn(col))}:</strong> ${escapeHtml(String(val))}</p>`;
  }).join('');
  return `<div class="ds-details-grid" dir="rtl">${lines}</div>`;
}

function renderInstrRow(row) {
  const name       = escapeHtml(row.full_name || row.emp_id || '—');
  const phone      = escapeHtml(row.mobile || '');
  const email      = escapeHtml(row.email  || '');
  const role       = escapeHtml(hebrewEmploymentType(row.employment_type) || '');
  const isInactive = String(row.active || '').toLowerCase() === 'no';
  const parts      = [phone, email].filter(Boolean).join(' · ');
  return `
    <div class="ci-row${isInactive ? ' ci-row--inactive' : ''}"
         data-contact-emp="${encodeURIComponent(row.emp_id || '')}" role="button" tabindex="0">
      <div class="ci-row__main">
        <span class="ci-row__name">${name}${isInactive ? ' <span class="ci-row__kind">לא פעיל</span>' : ''}</span>
        ${role  ? `<span class="ci-row__kind">${role}</span>` : ''}
        ${parts ? `<span class="ci-row__meta">${parts}</span>` : ''}
        <span class="ci-row__toggle" aria-hidden="true">&#9658;</span>
      </div>
    </div>`;
}

function instrTabHtml(rows, searchQ) {
  const filtered = applyInstrSearch(rows, searchQ);
  const body = filtered.length === 0
    ? dsEmptyState('לא נמצאו אנשי קשר')
    : `<div class="ci-list">${filtered.map(renderInstrRow).join('')}</div>`;
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

function schoolDetailLines(row) {
  const pairs = [
    ['רכז/ת', row.contact_name],
    ['טלפון', row.phone || row.mobile],
    ['נייד',  row.mobile !== row.phone ? row.mobile : ''],
    ['מייל',  row.email],
    ['הערות', row.notes]
  ];
  return pairs
    .filter(([, v]) => v && String(v).trim())
    .map(([lbl, v]) => `<span class="sc-detail"><strong>${escapeHtml(lbl)}:</strong> ${escapeHtml(String(v))}</span>`)
    .join('');
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

function renderSchoolBlock(schoolName, { authority, rows }) {
  const rowsHtml = rows.map((row) => {
    const detail = schoolDetailLines(row);
    if (!detail) return '';
    return `<div class="sc-contact-entry">${detail}</div>`;
  }).join('');

  if (!rowsHtml) return '';

  return `
    <details class="sc-school-block">
      <summary class="sc-school-head">
        <span class="sc-school-name">${escapeHtml(schoolName)}</span>
        ${authority ? `<span class="sc-authority">${escapeHtml(String(authority))}</span>` : ''}
        <span class="sc-count">${rows.length}</span>
      </summary>
      <div class="sc-school-body">${rowsHtml}</div>
    </details>`;
}

function schoolTabHtml(rows, searchQ) {
  const filtered = applySchoolSearch(rows, searchQ);
  if (filtered.length === 0) return { filtered, body: dsEmptyState('לא נמצאו אנשי קשר') };
  const groups  = groupBySchool(filtered);
  let blocksHtml = '';
  groups.forEach((group, name) => {
    blocksHtml += renderSchoolBlock(name, group);
  });
  return { filtered, body: `<div class="sc-list">${blocksHtml}</div>` };
}

/* ─── Screen ─── */

export const contactsScreen = {
  load: ({ api }) => api.contacts(),

  render(data, { state } = {}) {
    const instrRows  = Array.isArray(data?.instructor_rows) ? data.instructor_rows : [];
    const schoolRows = Array.isArray(data?.school_rows)     ? data.school_rows     : [];
    const canViewInstr  = data?.can_view_instructors !== false;
    const canViewSchool = data?.can_view_schools     !== false;

    const tab      = state?.contactsTab || (canViewInstr ? 'instr' : 'school');
    const instrQ   = state?.contactsInstrSearch  || '';
    const schoolQ  = state?.contactsSchoolSearch || '';

    const tabBtns = [
      canViewInstr  && { key: 'instr',  label: `אנשי קשר מדריכים · ${instrRows.length}`  },
      canViewSchool && { key: 'school', label: `אנשי קשר בתי ספר · ${schoolRows.length}` }
    ].filter(Boolean).map((t) =>
      `<button type="button" class="ds-chip--tab${tab === t.key ? ' is-active' : ''}" data-contacts-tab="${t.key}">${escapeHtml(t.label)}</button>`
    ).join('');

    let searchInput = '';
    let cardTitle   = '';
    let cardBody    = '';

    if (tab === 'instr' && canViewInstr) {
      const { filtered, body } = instrTabHtml(instrRows, instrQ);
      searchInput = `<input id="contacts-instr-search" type="search" class="ds-search-input"
        placeholder="חיפוש לפי שם / טלפון / מייל..." value="${escapeHtml(instrQ)}" dir="rtl" />`;
      cardTitle = `אנשי קשר מדריכים · ${filtered.length}`;
      cardBody  = body;
    } else if (tab === 'school' && canViewSchool) {
      const { filtered, body } = schoolTabHtml(schoolRows, schoolQ);
      searchInput = `<input id="contacts-school-search" type="search" class="ds-search-input"
        placeholder="חיפוש לפי בית ספר / רשות / איש קשר..." value="${escapeHtml(schoolQ)}" dir="rtl" />`;
      cardTitle = `אנשי קשר בתי ספר · ${filtered.length}`;
      cardBody  = body;
    }

    return dsScreenStack(`
      ${actNavGridHtml(state)}
      <div class="ds-chip-group" dir="rtl">${tabBtns}</div>
      <div class="ds-screen-top-row">
        ${searchInput}
      </div>
      ${dsCard({ title: cardTitle, body: cardBody, padded: !cardBody.includes('<div') })}
    `);
  },

  bind({ root, data, state, ui, rerender }) {
    bindActNavGrid(root, { state, rerender });

    const instrRows  = Array.isArray(data?.instructor_rows) ? data.instructor_rows : [];
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

    root.querySelectorAll('[data-contact-emp]').forEach((rowEl) => {
      const empId = decodeURIComponent(rowEl.dataset.contactEmp || '');
      const open = () => {
        const row = instrRows.find((r) => String(r.emp_id || '') === empId);
        if (!row || !ui) return;
        ui.openDrawer({
          title:   row.full_name || row.emp_id || '—',
          content: instrDrawerHtml(row, hideEmpIds)
        });
      };
      rowEl.addEventListener('click', open);
      rowEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
      });
    });
  }
};
