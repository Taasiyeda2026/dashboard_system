import { escapeHtml } from './shared/html.js';
import { actNavGridHtml, bindActNavGrid } from './shared/act-nav-grid.js';
import { hebrewColumn, hebrewEmploymentType } from './shared/ui-hebrew.js';
import { dsCard, dsScreenStack, dsEmptyState, dsStatusChip } from './shared/layout.js';

function applySearch(rows, q) {
  if (!q) return rows;
  const lq = q.toLowerCase();
  return rows.filter((r) =>
    String(r.full_name || '').toLowerCase().includes(lq) ||
    String(r.emp_id || '').toLowerCase().includes(lq) ||
    String(r.mobile || '').toLowerCase().includes(lq) ||
    String(r.email || '').toLowerCase().includes(lq) ||
    String(r.address || '').toLowerCase().includes(lq) ||
    hebrewEmploymentType(r.employment_type).toLowerCase().includes(lq)
  );
}

function drawerHtml(row, hideEmpIds) {
  const cols = ['emp_id', 'full_name', 'mobile', 'email', 'address', 'employment_type', 'direct_manager', 'active'];
  const lines = cols.map((col) => {
    if (hideEmpIds && col === 'emp_id') return '';
    const raw = row?.[col] ?? '';
    if (col === 'active') {
      const label = String(raw).toLowerCase() === 'yes' ? 'כן' : 'לא';
      const kind = String(raw).toLowerCase() === 'yes' ? 'success' : 'neutral';
      return `<p><strong>${escapeHtml(hebrewColumn(col))}:</strong> ${dsStatusChip(label, kind)}</p>`;
    }
    const val = col === 'employment_type' ? hebrewEmploymentType(raw) : (raw || '—');
    return `<p><strong>${escapeHtml(hebrewColumn(col))}:</strong> ${escapeHtml(String(val))}</p>`;
  }).join('');
  return `<div class="ds-details-grid" dir="rtl">${lines}</div>`;
}

function renderContactRow(row) {
  const name = escapeHtml(row.full_name || row.emp_id || '—');
  const phone = escapeHtml(row.mobile || '');
  const email = escapeHtml(row.email || '');
  const role = escapeHtml(hebrewEmploymentType(row.employment_type) || '');
  const isInactive = String(row.active || '').toLowerCase() === 'no';
  const inactiveClass = isInactive ? ' ci-row--inactive' : '';
  const parts = [phone, email].filter(Boolean).join(' · ');
  return `
    <div class="ci-row${inactiveClass}" data-contact-emp="${encodeURIComponent(row.emp_id || '')}" role="button" tabindex="0">
      <div class="ci-row__main">
        <span class="ci-row__name">${name}${isInactive ? ' <span class="ci-row__kind">לא פעיל</span>' : ''}</span>
        ${role ? `<span class="ci-row__kind">${role}</span>` : ''}
        ${parts ? `<span class="ci-row__meta">${parts}</span>` : ''}
        <span class="ci-row__toggle" aria-hidden="true">&#9658;</span>
      </div>
    </div>`;
}

export const contactsScreen = {
  load: ({ api }) => api.instructorContacts(),
  render(data, { state } = {}) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const searchQ = state?.contactsInstrSearch || '';
    const rows = applySearch(allRows, searchQ);

    const bodyHtml = rows.length === 0
      ? dsEmptyState('לא נמצאו אנשי קשר')
      : `<div class="ci-list">${rows.map((r) => renderContactRow(r)).join('')}</div>`;

    return dsScreenStack(`
      ${actNavGridHtml(state)}
      <div class="ds-screen-top-row">
        <input
          id="contacts-instr-search"
          type="search"
          class="ds-search-input"
          placeholder="חיפוש לפי שם / טלפון / מייל..."
          value="${escapeHtml(searchQ)}"
          dir="rtl"
        />
      </div>
      ${dsCard({
        title: `אנשי קשר מדריכים · ${rows.length}`,
        body: bodyHtml,
        padded: rows.length === 0
      })}
    `);
  },
  bind({ root, data, state, ui, rerender }) {
    bindActNavGrid(root, { state, rerender });
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;

    root.querySelector('#contacts-instr-search')?.addEventListener('input', (ev) => {
      state.contactsInstrSearch = ev.target.value || '';
      rerender();
    });

    root.querySelectorAll('[data-contact-emp]').forEach((rowEl) => {
      const empId = decodeURIComponent(rowEl.dataset.contactEmp || '');
      const open = () => {
        const row = allRows.find((r) => String(r.emp_id || '') === empId);
        if (!row || !ui) return;
        ui.openDrawer({
          title: row.full_name || row.emp_id || '—',
          content: drawerHtml(row, hideEmpIds)
        });
      };
      rowEl.addEventListener('click', open);
      rowEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
      });
    });
  }
};
