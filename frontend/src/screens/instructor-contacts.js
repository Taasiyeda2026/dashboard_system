import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewEmploymentType } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsEmptyState,
  dsStatusChip
} from './shared/layout.js';
import { showToast } from './shared/toast.js';
import { getManagerUsers } from './shared/activity-options.js';

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
const AVATAR_PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6',
  '#f43f5e', '#a855f7', '#0ea5e9', '#10b981'
];

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

function avatarInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`;
  if (parts.length === 1) return parts[0].slice(0, 2);
  return '??';
}

function avatarColor(seed) {
  const s = String(seed ?? '');
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function detailField(icon, label, value, { dir = 'rtl', href = '' } = {}) {
  const safe = textValue(value);
  if (!safe) return '';
  const valueHtml = href
    ? `<a href="${escapeHtml(href)}" style="color:#1d4ed8;text-decoration:none;font-weight:650" dir="${dir}">${escapeHtml(safe)}</a>`
    : `<span dir="${dir}" style="color:#263449;font-weight:620">${escapeHtml(safe)}</span>`;
  return `<div style="display:grid;grid-template-columns:38px 112px minmax(0,1fr);align-items:center;gap:10px;padding:11px 12px;border:1px solid #e1e8f1;border-radius:12px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.035)">
    <span aria-hidden="true" style="width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#edf5ff;font-size:18px">${icon}</span>
    <span style="color:#526174;font-size:.88rem;font-weight:700">${escapeHtml(label)}</span>
    <span style="min-width:0;overflow-wrap:anywhere">${valueHtml}</span>
  </div>`;
}

function drawerHtml(row, hideEmpIds, canEdit) {
  const name = textValue(row.full_name) || textValue(row.emp_id) || 'מדריך';
  const isActive = normalizeActiveFlag(row.active) === 'yes';
  const color = avatarColor(row.emp_id || name);
  const phone = textValue(row.mobile || row.phone);
  const email = textValue(row.email);
  const manager = textValue(row.direct_manager) || 'ללא';
  const fields = [
    detailField('📱', hebrewColumn('mobile'), phone, { dir: 'ltr', href: phone ? `tel:${phone.replace(/[^0-9+]/g, '')}` : '' }),
    detailField('✉️', hebrewColumn('email'), email, { dir: 'ltr', href: email ? `mailto:${email}` : '' }),
    detailField('📍', hebrewColumn('address'), row.address),
    detailField('💼', hebrewColumn('employment_type'), textValue(row.employment_type) ? hebrewEmploymentType(row.employment_type) : ''),
    detailField('👤', hebrewColumn('direct_manager'), manager),
    !hideEmpIds ? detailField('#️⃣', hebrewColumn('emp_id'), row.emp_id, { dir: 'ltr' }) : ''
  ].filter(Boolean).join('');

  const editButton = canEdit
    ? `<button type="button" class="ds-btn ds-btn--primary" data-edit-instructor-contact="${escapeHtml(String(row.emp_id || ''))}" style="min-width:120px">✎ עריכה</button>`
    : '';

  return `<div dir="rtl" style="display:grid;gap:14px">
    <section style="display:flex;align-items:center;gap:14px;padding:15px;border:1px solid #dce7f2;border-radius:16px;background:linear-gradient(135deg,#f7fbff 0%,#edf6ff 100%)">
      <span aria-hidden="true" style="width:58px;height:58px;flex:0 0 58px;border-radius:50%;display:grid;place-items:center;background:${color};color:#fff;font-size:1.08rem;font-weight:800;box-shadow:0 5px 14px rgba(15,23,42,.16)">${escapeHtml(avatarInitials(name))}</span>
      <span style="display:grid;gap:7px;min-width:0">
        <strong style="font-size:1.08rem;color:#162235;overflow-wrap:anywhere">${escapeHtml(name)}</strong>
        <span>${dsStatusChip(isActive ? 'פעיל' : 'לא פעיל', isActive ? 'success' : 'neutral')}</span>
      </span>
    </section>
    <div style="display:grid;gap:9px">${fields}</div>
    ${editButton ? `<div style="display:flex;justify-content:flex-start;padding-top:2px">${editButton}</div>` : ''}
  </div>`;
}

function selectOptionsHtml(values, selected = '', placeholder = '—') {
  const safe = String(selected || '');
  const unique = [...new Set((Array.isArray(values) ? values : []).map((v) => String(v || '').trim()).filter(Boolean))];
  const merged = safe && !unique.includes(safe) ? [safe, ...unique] : unique;
  return [`<option value="">${escapeHtml(placeholder)}</option>`]
    .concat(merged.map((value) => `<option value="${escapeHtml(value)}"${value === safe ? ' selected' : ''}>${escapeHtml(value)}</option>`))
    .join('');
}

function instructorFormHtml(row = {}, managerOptions = [], hideEmpIds = false) {
  const employmentOptions = ['תעשיידע', 'מעוף', 'מנפוואר'];
  const managers = ['ללא', ...managerOptions];
  const empIdField = hideEmpIds
    ? `<input type="hidden" name="emp_id" value="${escapeHtml(String(row.emp_id || ''))}">`
    : `<div class="ds-perm-field"><span class="ds-muted">מזהה מדריך</span><input class="ds-input ds-input--sm" name="emp_id" value="${escapeHtml(String(row.emp_id || ''))}" readonly></div>`;
  return `<div class="ds-perm-edit-form ds-contact-edit-form" dir="rtl">
    ${empIdField}
    <div class="ds-perm-field"><span class="ds-muted">שם מלא</span><input class="ds-input ds-input--sm" name="full_name" value="${escapeHtml(String(row.full_name || ''))}"></div>
    <div class="ds-perm-field"><span class="ds-muted">נייד</span><input class="ds-input ds-input--sm" name="mobile" value="${escapeHtml(String(row.mobile || ''))}" dir="ltr"></div>
    <div class="ds-perm-field"><span class="ds-muted">אימייל</span><input class="ds-input ds-input--sm" name="email" value="${escapeHtml(String(row.email || ''))}" dir="ltr"></div>
    <div class="ds-perm-field"><span class="ds-muted">כתובת</span><input class="ds-input ds-input--sm" name="address" value="${escapeHtml(String(row.address || ''))}"></div>
    <div class="ds-perm-field"><span class="ds-muted">סוג העסקה</span><select class="ds-input ds-input--sm" name="employment_type">${selectOptionsHtml(employmentOptions, String(row.employment_type || ''), 'בחרו סוג העסקה')}</select></div>
    <div class="ds-perm-field"><span class="ds-muted">מנהל ישיר</span><select class="ds-input ds-input--sm" name="direct_manager">${selectOptionsHtml(managers, String(row.direct_manager || 'ללא'), 'בחרו מנהל')}</select></div>
    <div class="ds-perm-field"><span class="ds-muted">סטטוס</span><select class="ds-input ds-input--sm" name="active">
      <option value="yes" ${normalizeActiveFlag(row.active) === 'yes' ? 'selected' : ''}>פעיל</option>
      <option value="no" ${normalizeActiveFlag(row.active) === 'no' ? 'selected' : ''}>לא פעיל</option>
    </select></div>
    <p class="ds-muted" data-contact-form-status role="status"></p>
  </div>`;
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

/** אנשי קשר של מדריכים — רשימה קומפקטית, צפייה ועריכה לפי הרשאה. */
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
    if (activeFilter) rows = rows.filter((r) => normalizeActiveFlag(r.active) === activeFilter);

    const activeChips = [
      { val: '', label: 'הכל' },
      { val: 'yes', label: 'פעיל' },
      { val: 'no', label: 'לא פעיל' }
    ].map((chip) =>
      `<button type="button" class="ds-chip ${chip.val === activeFilter ? 'is-active' : ''}" data-active-filter="${chip.val}">${escapeHtml(chip.label)}</button>`
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
  bind({ root, data, state, ui, rerender, clearScreenDataCache, api }) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
    const canEdit = String(state?.user?.role || '').trim() !== 'instructor';
    const managerOptions = getManagerUsers(state?.clientSettings || {});

    root.querySelector('[data-route="instructors"]')?.addEventListener('click', (event) => {
      event.preventDefault();
      document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'instructors' } }));
    });

    let searchTimer;
    root.querySelector('#instr-contacts-search')?.addEventListener('input', (event) => {
      const next = event.target.value || '';
      const cursorPos = event.target?.selectionStart ?? next.length;
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

      if (normalizeSearch(next).length === 0) {
        apply();
        return;
      }
      searchTimer = setTimeout(apply, SEARCH_DEBOUNCE_MS);
    });

    root.querySelectorAll('[data-active-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        state.instrContactsActiveFilter = button.dataset.activeFilter || '';
        rerender();
      });
    });

    const openEditor = (row) => {
      if (!ui || !row || !canEdit) return;
      const originalEmpId = String(row.emp_id || '').trim();
      ui.closeDrawer?.();
      ui.openModal({
        title: `עריכת איש קשר — ${row.full_name || originalEmpId}`,
        content: instructorFormHtml(row, managerOptions, hideEmpIds),
        actions: `<button type="button" class="ds-btn ds-btn--primary" data-save-instructor-contact>שמירה</button>
                  <button type="button" class="ds-btn" data-ui-close-modal>ביטול</button>`
      });

      const saveButton = document.querySelector('[data-save-instructor-contact]');
      if (!saveButton) return;
      saveButton.onclick = async () => {
        const modal = document.querySelector('.ds-modal__content');
        if (!modal) return;
        const statusElement = modal.querySelector('[data-contact-form-status]');
        const get = (name) => String(modal.querySelector(`[name="${name}"]`)?.value || '').trim();
        const payload = {
          emp_id: originalEmpId || get('emp_id'),
          full_name: get('full_name'),
          mobile: get('mobile'),
          email: get('email'),
          address: get('address'),
          employment_type: get('employment_type'),
          direct_manager: get('direct_manager') || 'ללא',
          active: get('active') || 'yes'
        };
        if (!payload.emp_id || !payload.full_name) {
          if (statusElement) statusElement.textContent = 'יש להזין שם מלא ומזהה מדריך.';
          return;
        }
        try {
          saveButton.disabled = true;
          if (statusElement) statusElement.textContent = 'שומר...';
          await api.saveContact({ kind: 'instructor', row: payload });
          Object.assign(row, payload);
          clearScreenDataCache?.();
          ui.closeModal();
          showToast('נשמר בהצלחה', 'success', 1800);
          rerender();
        } catch (error) {
          if (statusElement) statusElement.textContent = `שגיאה: ${String(error?.message || '')}`;
        } finally {
          saveButton.disabled = false;
        }
      };
    };

    const openRow = (empId) => {
      const hit = allRows.find((row) => String(row.emp_id) === String(empId));
      if (!hit || !ui) return;
      ui.openDrawer({
        title: hit.full_name || hit.emp_id,
        content: drawerHtml(hit, hideEmpIds, canEdit)
      });
      requestAnimationFrame(() => {
        const editButton = document.querySelector('[data-edit-instructor-contact]');
        if (editButton) editButton.onclick = () => openEditor(hit);
      });
    };

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('icontact:')) return;
      openRow(decodeURIComponent(action.slice('icontact:'.length)));
    });
  }
};
