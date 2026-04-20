import { escapeHtml } from './shared/html.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsEmptyState
} from './shared/layout.js';

const SCREEN_META = {
  dashboard:        { label: 'לוח בקרה',               icon: '📊' },
  activities:       { label: 'פעילויות',                icon: '📋' },
  finance:          { label: 'כספים',                   icon: '💰' },
  permissions:      { label: 'הרשאות',                  icon: '🔑' },
  exceptions:       { label: 'חריגות',                  icon: '⚠️' },
  instructors:      { label: 'מדריכים',                 icon: '👥' },
  'end-dates':      { label: 'תאריכי סיום',              icon: '📅' },
  'my-data':        { label: 'הנתונים שלי',              icon: '👤' },
  week:             { label: 'שבוע',                    icon: '📆' },
  month:            { label: 'חודש',                    icon: '🗓️' }
};

const ALL_ROUTES = ['dashboard', 'activities', 'finance', 'exceptions', 'permissions'];

const SYSTEM_SHEET_LABELS = {
  data_short:               'פעילויות (קצרות)',
  data_long:                'פעילויות (ארוכות)',
  permissions:              'הרשאות משתמשים',
  settings:                 'הגדרות מערכת',
  lists:                    'רשימות בחירה',
  activity_meetings:        'מפגשי פעילות',
  contacts_instructors:     'אנשי קשר – מדריכים',
  contacts_schools:         'אנשי קשר – בתי ספר',
  edit_requests:            'בקשות עריכה',
  operations_private_notes: 'הערות פרטיות'
};

function renderSheetDiagnostics(data) {
  if (!data) return '<p class="ds-muted">לא התקבלו נתונים.</p>';

  const { sheets = [], missing_required_sheets = [], data_start_row, activities_data_sources = [] } = data;

  const missingBanner = missing_required_sheets.length
    ? `<div class="ds-alert ds-alert--warn" style="margin-bottom:1rem" dir="rtl">
        <strong>גיליונות חסרים:</strong> ${missing_required_sheets.map(escapeHtml).join(', ')}
       </div>`
    : '';

  const metaInfo = `<p class="ds-muted" dir="rtl" style="margin-bottom:.75rem">
    שורת נתונים מתחילה בשורה ${escapeHtml(String(data_start_row))} ·
    מקורות פעילויות: ${activities_data_sources.map(escapeHtml).join(', ') || '—'}
  </p>`;

  const systemSheets = sheets.filter((s) => s.is_system_sheet);
  const otherSheets = sheets.filter((s) => !s.is_system_sheet);

  function sheetCard(s) {
    const label = SYSTEM_SHEET_LABELS[s.name] || s.name;
    const statusIcon = s.ok ? '✅' : s.missing_cols && s.missing_cols.length ? '⚠️' : '📄';
    const missingColsHtml = s.missing_cols && s.missing_cols.length
      ? `<p style="margin:.25rem 0 0;color:var(--ds-color-warn,#d97706)">עמודות חסרות: ${s.missing_cols.map(escapeHtml).join(', ')}</p>`
      : '';
    const extraColsHtml = s.extra_cols && s.extra_cols.length
      ? `<p style="margin:.25rem 0 0" class="ds-muted">עמודות נוספות: ${s.extra_cols.map(escapeHtml).join(', ')}</p>`
      : '';
    const headersHtml = `<p class="ds-muted" style="margin:.3rem 0 0;font-size:.8rem;word-break:break-all">${s.headers.filter(Boolean).map(escapeHtml).join(' · ')}</p>`;
    return `<div class="ds-sheet-diag-row" dir="rtl">
      <div style="display:flex;align-items:baseline;gap:.4rem">
        <span>${statusIcon}</span>
        <strong>${escapeHtml(label)}</strong>
        <code class="ds-muted" style="font-size:.75rem">${escapeHtml(s.name)}</code>
        <span class="ds-muted" style="font-size:.8rem">(${escapeHtml(String(s.row_count))} שורות נתונים)</span>
      </div>
      ${headersHtml}${missingColsHtml}${extraColsHtml}
    </div>`;
  }

  const systemHtml = systemSheets.length
    ? systemSheets.map(sheetCard).join('')
    : '<p class="ds-muted">לא נמצאו גיליונות מערכת.</p>';

  const otherHtml = otherSheets.length
    ? `<details style="margin-top:.75rem">
        <summary class="ds-muted" style="cursor:pointer">גיליונות נוספים (${otherSheets.length})</summary>
        <div style="margin-top:.5rem">${otherSheets.map(sheetCard).join('')}</div>
       </details>`
    : '';

  return `${missingBanner}${metaInfo}<div class="ds-sheet-diag-list">${systemHtml}</div>${otherHtml}`;
}

export const adminHomeScreen = {
  load: () => Promise.resolve({}),

  render(data, { state } = {}) {
    const routes = Array.isArray(state?.routes) ? state.routes : [];

    const cards = ALL_ROUTES
      .filter((r) => routes.includes(r))
      .map((route) => {
        const meta = SCREEN_META[route] || { label: route, icon: '▶' };
        return `<button type="button" class="ds-admin-ctrl-card ds-admin-ctrl-card--link" data-admin-nav="${escapeHtml(route)}">
          <span class="ds-admin-ctrl-icon">${meta.icon}</span>
          <span class="ds-admin-ctrl-title">${escapeHtml(meta.label)}</span>
        </button>`;
      })
      .join('');

    const body = cards
      ? `<div class="ds-admin-ctrl-grid ds-admin-ctrl-grid--3col">${cards}</div>`
      : dsEmptyState('אין מסכים נגישים');

    const diagBody = `
      <div dir="rtl">
        <p class="ds-muted" style="margin-bottom:.75rem">
          בדיקת גיליונות האקסל המחוברים — שמות הגיליונות, העמודות שלהם, ואם הם תואמים למה שהמערכת מצפה.
        </p>
        <button type="button" class="ds-btn ds-btn--primary" data-check-sheets>בדיקת גיליונות</button>
        <div id="sheet-diag-result" style="margin-top:1rem"></div>
      </div>
    `;

    return dsScreenStack(`
      ${dsPageHeader('לוח בקרה – מנהל מערכת')}
      <div style="display:flex;justify-content:center;">
        ${dsCard({ title: '', body, padded: !!cards })}
      </div>
      ${dsCard({ title: 'אבחון גיליונות', body: diagBody, padded: true })}
    `);
  },

  bind({ root, api }) {
    root.querySelectorAll('[data-admin-nav]').forEach((card) => {
      card.addEventListener('click', () => {
        const target = card.dataset.adminNav;
        if (!target) return;
        document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: target } }));
      });
    });

    const checkBtn = root.querySelector('[data-check-sheets]');
    const resultEl = root.querySelector('#sheet-diag-result');
    if (checkBtn && resultEl) {
      checkBtn.addEventListener('click', async () => {
        checkBtn.disabled = true;
        checkBtn.textContent = 'בודק...';
        resultEl.innerHTML = '<p class="ds-muted">טוען נתוני גיליונות...</p>';
        try {
          const data = await api.listSheets();
          resultEl.innerHTML = renderSheetDiagnostics(data);
        } catch (err) {
          resultEl.innerHTML = `<p style="color:var(--ds-color-error,#dc2626)">${escapeHtml(err?.message || 'שגיאה בטעינת הגיליונות')}</p>`;
        } finally {
          checkBtn.disabled = false;
          checkBtn.textContent = 'בדיקת גיליונות';
        }
      });
    }
  }
};
