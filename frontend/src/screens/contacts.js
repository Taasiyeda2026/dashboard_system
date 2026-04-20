import { escapeHtml } from './shared/html.js';
import { hebrewColumn } from './shared/ui-hebrew.js';
import { dsPageHeader, dsCard, dsScreenStack, dsEmptyState } from './shared/layout.js';

const DETAIL_COLUMNS = ['authority', 'school', 'contact_name', 'phone', 'mobile', 'email'];

function cellVal(row, column) {
  return row?.[column] ?? '';
}

function contactDetailHtml(row) {
  return DETAIL_COLUMNS
    .map((col) => {
      const val = String(cellVal(row, col) || '');
      if (!val || val === '—') return '';
      return `<span class="ci-detail-item"><strong>${escapeHtml(hebrewColumn(col))}:</strong> ${escapeHtml(val)}</span>`;
    })
    .filter(Boolean)
    .join('');
}

function groupBySchool(rows) {
  const schools = new Map();
  for (const row of rows) {
    const school = String(row.school || '').trim();
    if (!school) continue;
    if (!schools.has(school)) schools.set(school, []);
    schools.get(school).push(row);
  }
  return schools;
}

function renderContactRow(row, idx) {
  const name = escapeHtml(row.contact_name || '—');
  const phone = escapeHtml(row.phone || row.mobile || '');
  const email = escapeHtml(row.email || '');
  const meta = [phone, email].filter(Boolean).join(' · ');
  return `
    <div class="ci-row" data-contact-idx="${idx}" role="button" tabindex="0" aria-expanded="false">
      <div class="ci-row__main">
        <span class="ci-row__name">${name}</span>
        ${meta ? `<span class="ci-row__meta">${meta}</span>` : ''}
        <span class="ci-row__toggle" aria-hidden="true">&#9658;</span>
      </div>
      <div class="ci-row__detail" hidden>
        <div class="ci-detail-grid">${contactDetailHtml(row)}</div>
      </div>
    </div>
  `;
}

function applySearch(rows, q) {
  if (!q) return rows;
  const lq = q.toLowerCase();
  return rows.filter(
    (r) =>
      String(r.contact_name || '').toLowerCase().includes(lq) ||
      String(r.school || '').toLowerCase().includes(lq) ||
      String(r.authority || '').toLowerCase().includes(lq) ||
      String(r.phone || '').includes(lq) ||
      String(r.mobile || '').includes(lq) ||
      String(r.email || '').toLowerCase().includes(lq)
  );
}

export const contactsScreen = {
  load: ({ api }) => api.contacts(),
  render(data, { state } = {}) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const searchQ = state?.contactsSearch || '';
    const schoolRows = allRows.filter((row) => String(row.school || '').trim());
    const rows = applySearch(schoolRows, searchQ);
    const schools = groupBySchool(rows);

    let bodyHtml = '';

    if (rows.length === 0) {
      bodyHtml = dsEmptyState('לא נמצאו אנשי קשר');
    } else {
      let globalIdx = 0;

      schools.forEach((schoolRows, schoolName) => {
        const rowsHtml = schoolRows.map((r) => renderContactRow(r, globalIdx++)).join('');
        bodyHtml += `
          <div class="ci-school-block">
            <div class="ci-school-head">&#127979; ${escapeHtml(schoolName)} <span class="ci-count">${schoolRows.length}</span></div>
            <div class="ci-school-rows">${rowsHtml}</div>
          </div>
        `;
      });
    }

    return dsScreenStack(`
      ${dsPageHeader('אנשי קשר בתי ספר', 'רשימת אנשי קשר לפי בית ספר')}
      <div class="ds-screen-top-row">
        <input
          id="contacts-search"
          type="search"
          class="ds-search-input"
          placeholder="חיפוש איש קשר..."
          value="${escapeHtml(searchQ)}"
          dir="rtl"
        />
      </div>
      ${dsCard({
        title: 'אנשי קשר בתי ספר',
        badge: `${rows.length} רשומות`,
        body: `<div class="ci-list">${bodyHtml}</div>`,
        padded: false
      })}
    `);
  },
  bind({ root, data, state, rerender, clearScreenDataCache }) {
    root.querySelector('#contacts-search')?.addEventListener('input', (ev) => {
      state.contactsSearch = ev.target.value || '';
      rerender();
    });

    root.querySelectorAll('.ci-row').forEach((rowEl) => {
      const toggle = () => {
        const expanded = rowEl.getAttribute('aria-expanded') === 'true';
        rowEl.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        const detail = rowEl.querySelector('.ci-row__detail');
        const icon = rowEl.querySelector('.ci-row__toggle');
        if (detail) detail.hidden = expanded;
        if (icon) icon.textContent = expanded ? '\u25B8' : '\u25BE';
      };
      rowEl.addEventListener('click', toggle);
      rowEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); }
      });
    });
  }
};
