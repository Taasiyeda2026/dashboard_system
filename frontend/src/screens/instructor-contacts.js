import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewEmploymentType } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsEmptyState,
  dsStatusChip
} from './shared/layout.js';

const MIN_SEARCH_CHARS = 1;
const SEARCH_DEBOUNCE_MS = 150;
const COMPACT_GRID_STYLE = [
  'display:grid',
  'grid-template-columns:repeat(auto-fill,minmax(180px,1fr))',
  'gap:10px',
  'align-items:stretch'
].join(';');
const COMPACT_CARD_STYLE = [
  'min-height:48px !important',
  'height:auto !important',
  'padding:10px 14px !important',
  'display:flex !important',
  'align-items:center !important',
  'justify-content:center !important',
  'text-align:center !important'
].join(';');

/** Normalizes the `active` column (stored as yes/no, but tolerates boolean/numeric) to 'yes' | 'no'. */
function normalizeActiveFlag(value) {
  if (value === false || value === 0) return 'no';
  if (value === true || value === 1) return 'yes';
  const s = String(value ?? '').trim().toLowerCase();
  return s === 'no' || s === 'false' || s === '0' ? 'no' : 'yes';
}

function textValue(value) {
  const s = String(value ?? '').trim();
  return s && s !== '—' ? s : '';
}

function drawerHtml(row, hideEmpIds) {
  const columns = ['emp_id', 'full_name', 'mobile', 'email', 'address', 'employment_type', 'direct_manager', 'active'];
  const lines = columns.map((col) => {
    if (hideEmpIds && col === 'emp_id') return '';
    const raw = row?.[col] ?? '';
    if (col === 'active') {
      const isYes = normalizeActiveFlag(raw) === 'yes';
      const label = isYes ? 'כן' : 'לא';
      const kind = isYes ? 'success' : 'neutral';
      return `<p><strong>${escapeHtml(hebrewColumn(col))}:</strong> ${dsStatusChip(label, kind)}</p>`;
    }
    const val = col === 'employment_type' ? hebrewEmploymentType(raw) : (raw || '—');
    return `<p><strong>${escapeHtml(hebrewColumn(col))}:</strong> ${escapeHtml(String(val))}</p>`;
  }).join('');
  return `<div class="ds-details-grid" dir="rtl">${lines}</div>`;
}

function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function applySearch(rows, q) {
  const lq = normalizeSearch(q);
  if (!lq) return rows;
  return rows.filter((r) => [
    r.full_name, r.name, r.emp_id, r.employee_id,
    r.email, r.mobile, r.phone, r.address,
    r.employment_type, hebrewEmploymentType(r.employment_type),
    r.direct_manager, r.active, r.authority, r.school, r.role, r.notes
  ].some((value) => normalizeSearch(value).includes(lq)));
}

function renderContactCard(row) {
  const nameRaw = textValue(row.full_name) || textValue(row.emp_id) || 'מדריך';
  const isActive = normalizeActiveFlag(row.active) === 'yes';
  const inactiveClass = isActive ? '' : ' ic-contact-card--inactive';

  return `
    <button
      type="button"
      class="ic-contact-card ic-contact-card--compact${inactiveClass}"
      style="${COMPACT_CARD_STYLE}"
      data-card-action="icontact:${encodeURIComponent(row.emp_id || '')}"
      aria-label="פתיחת פרטי מדריך: ${escapeHtml(nameRaw)}"
    >
      <span class="ic-contact-card__name" style="font-size:0.98rem;line-height:1.25">${escapeHtml(nameRaw)}</span>
    </button>`;
}

/** אנשי קשר של מדריכים — צפייה בלבד. */
export const instructorContactsScreen = {
  load: ({ api }) => api.instructorContacts(),
  render(data, { state } = {}) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const searchQ = state?.instrContactsSearch || '';
    if (!Object.prototype.hasOwnProperty.call(state, 'instrContactsAppliedSearch')) {
      state.instrContactsAppliedSearch = normalizeSearch(searchQ).length >= MIN_SEARCH_CHARS ? searchQ : '';
    }
    const appliedSearchQ = state?.instrContactsAppliedSearch || '';
    const activeFilter = state?.instrContactsActiveFilter || '';

    let rows = applySearch(allRows, appliedSearchQ);
    if (activeFilter) {
      rows = rows.filter((r) => normalizeActiveFlag(r.active) === activeFilter);
    }

    const activeChips = [
      { val: '', label: 'הכל' },
      { val: 'yes', label: 'פעיל' },
      { val: 'no', label: 'לא פעיל' }
    ].map((c) =>
      `<button type="button" class="ds-chip ${c.val === activeFilter ? 'is-active' : ''}" data-active-filter="${c.val}">${escapeHtml(c.label)}</button>`
    ).join('');

    const cardsHtml = rows.length === 0
      ? dsEmptyState('לא נמצאו אנשי קשר')
      : `<div class="ic-contact-grid ic-contact-grid--compact" style="${COMPACT_GRID_STYLE}" dir="rtl">${rows.map(renderContactCard).join('')}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('אנשי קשר מדריכים', 'לחצו על שם מדריך להצגת פרטי הקשר והמידע הנוסף')}
      <div class="ds-screen-top-row" style="display:flex;justify-content:flex-start;gap:8px;margin-bottom:8px">
        <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-route="instructors">← חזרה למדריכים</button>
      </div>
      <div class="ds-screen-top-row">
        <input
          id="instr-contacts-search"
          type="search"
          class="ds-search-input"
          placeholder="חיפוש..."
          value="${escapeHtml(searchQ)}"
          dir="rtl"
        />
      </div>
      <div class="ds-filter-bar" role="toolbar">${activeChips}</div>
      ${dsCard({
        title: `אנשי קשר מדריכים · ${rows.length}`,
        body: cardsHtml,
        padded: rows.length === 0
      })}
    `);
  },
  bind({ root, data, state, ui, rerender, clearScreenDataCache }) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;

    root.querySelector('[data-route="instructors"]')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'instructors' } }));
    });

    let searchTimer;
    root.querySelector('#instr-contacts-search')?.addEventListener('input', (ev) => {
      const next = ev.target.value || '';
      const cursorPos = ev.target?.selectionStart ?? next.length;
      clearTimeout(searchTimer);
      state.instrContactsSearch = next;

      const apply = () => {
        state.instrContactsAppliedSearch = next;
        rerender();
        const newInput = root.querySelector('#instr-contacts-search');
        if (newInput) {
          newInput.focus();
          try { newInput.setSelectionRange(cursorPos, cursorPos); } catch (_) {}
        }
      };

      const len = normalizeSearch(next).length;
      if (len === 0) {
        apply();
        return;
      }
      searchTimer = setTimeout(apply, SEARCH_DEBOUNCE_MS);
    });

    root.querySelectorAll('[data-active-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.instrContactsActiveFilter = btn.dataset.activeFilter || '';
        rerender();
      });
    });

    const openRow = (empId) => {
      const hit = allRows.find((r) => String(r.emp_id) === String(empId));
      if (!hit || !ui) return;
      ui.openDrawer({
        title: hit.full_name || hit.emp_id,
        content: drawerHtml(hit, hideEmpIds)
      });
    };

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('icontact:')) return;
      openRow(decodeURIComponent(action.slice('icontact:'.length)));
    });
  }
};
