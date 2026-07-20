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

const AVATAR_PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6',
  '#f43f5e', '#a855f7', '#0ea5e9', '#10b981'
];

const ICON_PHONE = `<svg class="ic-contact-card__icon-svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.2 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.3 1.1L6.6 10.8z"/></svg>`;
const ICON_EMAIL = `<svg class="ic-contact-card__icon-svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5L4 8V6l8 5 8-5v2z"/></svg>`;
const ICON_MANAGER = `<svg class="ic-contact-card__icon-svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z"/></svg>`;
const ICON_PIN = `<svg class="ic-contact-card__icon-svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5c-1.4 0-2.5-1.1-2.5-2.5S10.6 6.5 12 6.5s2.5 1.1 2.5 2.5S13.4 11.5 12 11.5z"/></svg>`;

function avatarColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0x7fffffff;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function avatarInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return parts[0][0] + parts[1][0];
  if (parts.length === 1) return parts[0].slice(0, 2);
  return '??';
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
      const label = String(raw).toLowerCase() === 'yes' ? 'כן' : 'לא';
      const kind = String(raw).toLowerCase() === 'yes' ? 'success' : 'neutral';
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

function detailRow(kind, icon, value, { dir = 'rtl', label = '' } = {}) {
  const safe = textValue(value);
  if (!safe) return '';
  const labelAttr = label ? ` aria-label="${escapeHtml(label)}"` : '';
  return `<span class="ic-contact-card__row ic-contact-card__row--${kind}"${labelAttr}>
    <span class="ic-contact-card__icon ic-contact-card__icon--${kind}" aria-hidden="true">${icon}</span>
    <span class="ic-contact-card__value" dir="${dir}">${escapeHtml(safe)}</span>
  </span>`;
}

function renderContactCard(row) {
  const nameRaw = textValue(row.full_name) || textValue(row.emp_id) || 'מדריך';
  const initials = avatarInitials(nameRaw);
  const color = avatarColor(row.emp_id || nameRaw);
  const isActive = String(row.active || '').toLowerCase() !== 'no';
  const mobile = textValue(row.mobile || row.phone);
  const email = textValue(row.email);
  const address = textValue(row.address);
  const manager = textValue(row.direct_manager);
  const empRaw = textValue(row.employment_type);
  const employment = empRaw ? textValue(hebrewEmploymentType(empRaw)) : '';

  const statusClass = isActive
    ? 'ic-contact-card__status--active'
    : 'ic-contact-card__status--inactive';
  const statusLabel = isActive ? 'פעיל' : 'לא פעיל';
  const inactiveClass = isActive ? '' : ' ic-contact-card--inactive';

  const employmentHtml = employment
    ? `<span class="ic-contact-card__emp">${escapeHtml(employment)}</span>`
    : '';

  const bodyParts = [
    detailRow('phone', ICON_PHONE, mobile, { dir: 'ltr', label: 'נייד' }),
    detailRow('email', ICON_EMAIL, email, { dir: 'ltr', label: 'דוא״ל' }),
    employmentHtml,
    detailRow('manager', ICON_MANAGER, manager, { label: 'מנהל ישיר' }),
    detailRow('address', ICON_PIN, address, { label: 'כתובת' })
  ].filter(Boolean).join('');

  const bodyHtml = bodyParts
    ? `<span class="ic-contact-card__body">${bodyParts}</span>`
    : '';

  return `
    <button
      type="button"
      class="ic-contact-card${inactiveClass}"
      data-card-action="icontact:${encodeURIComponent(row.emp_id || '')}"
      aria-label="פרטי מדריך: ${escapeHtml(nameRaw)}"
    >
      <span class="ic-contact-card__head">
        <span class="ic-contact-card__avatar" style="background:${color}" aria-hidden="true">${escapeHtml(initials)}</span>
        <span class="ic-contact-card__identity">
          <span class="ic-contact-card__name">${escapeHtml(nameRaw)}</span>
          <span class="ic-contact-card__status ${statusClass}">${statusLabel}</span>
        </span>
      </span>
      ${bodyHtml}
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
      rows = rows.filter((r) => String(r.active || '').toLowerCase() === activeFilter);
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
      : `<div class="ic-contact-grid" dir="rtl">${rows.map(renderContactCard).join('')}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('אנשי קשר מדריכים', 'פרטי הקשר והמידע המקצועי של צוות ההדרכה')}
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
