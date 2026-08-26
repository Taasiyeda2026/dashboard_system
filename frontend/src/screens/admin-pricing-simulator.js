import { state } from '../state.js';
import {
  calculateInstructorWage,
  calculatePricingGroup,
  calculateSchoolPricing
} from './shared/admin-pricing-logic.js';

const MAX_GROUPS = 100;

const DEFAULT_WAGE_INPUTS = Object.freeze({
  hours: '3',
  hourlyRate: '80',
  wageMultiplier: '1.3',
  kilometers: '80',
  kilometerMultiplier: '1.5'
});

const DEFAULT_PRICING_INPUTS = Object.freeze({
  instructorPrice: '769.5',
  studentPrice: '111',
  commissionRate: '10',
  targetMargin: '30',
  venueCost: '800'
});

function isAdmin() {
  return String(state?.user?.role || state?.user?.display_role || '').trim() === 'admin';
}

function money(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return `${new Intl.NumberFormat('he-IL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value))} ₪`;
}

function percent(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : '—';
}

function hasValue(value) {
  return String(value ?? '').trim() !== '';
}

function groupComplete(group) {
  return hasValue(group?.studentCount)
    && Number(group?.studentCount) > 0
    && hasValue(group?.transportCost);
}

function wageInputsComplete(values) {
  return ['hours', 'hourlyRate', 'wageMultiplier', 'kilometers', 'kilometerMultiplier']
    .every((key) => hasValue(values?.[key]));
}

function pricingInputsComplete(values) {
  return ['instructorPrice', 'studentPrice', 'commissionRate', 'targetMargin', 'venueCost']
    .every((key) => hasValue(values?.[key]));
}

function blankGroup() {
  return { studentCount: '', transportCost: '' };
}

function ensureStyles() {
  if (document.getElementById('admin-pricing-simulator-styles')) return;

  const style = document.createElement('style');
  style.id = 'admin-pricing-simulator-styles';
  style.textContent = `
    .admin-pricing-overlay {
      position: fixed;
      inset: 0;
      z-index: 10020;
      display: grid;
      place-items: center;
      box-sizing: border-box;
      padding: 18px;
      background: rgba(15, 23, 42, .30);
      backdrop-filter: blur(2px);
      overflow: hidden;
    }

    .admin-pricing-simulator {
      width: min(820px, calc(100vw - 36px));
      max-height: min(92vh, 850px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid #cbd5e1;
      border-radius: 16px;
      background: #fff;
      color: #172033;
      box-shadow: 0 22px 58px rgba(15, 23, 42, .24);
    }

    .admin-pricing-simulator__header {
      flex: 0 0 auto;
      min-height: 54px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 10px 14px;
      border-bottom: 1px solid #e2e8f0;
      background: #fff;
    }

    .admin-pricing-simulator__title {
      margin: 0;
      font-size: 18px;
      font-weight: 900;
    }

    .admin-pricing-simulator__subtitle {
      margin: 3px 0 0;
      color: #64748b;
      font-size: 11px;
    }

    .admin-pricing-simulator__actions {
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .admin-pricing-simulator__button,
    .admin-pricing-simulator__close {
      appearance: none;
      border: 1px solid #cbd5e1;
      background: #fff;
      color: #475569;
      cursor: pointer;
      font: inherit;
    }

    .admin-pricing-simulator__button {
      min-height: 30px;
      padding: 4px 9px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 800;
    }

    .admin-pricing-simulator__close {
      width: 30px;
      height: 30px;
      display: grid;
      place-items: center;
      padding: 0;
      border-radius: 8px;
      font-size: 18px;
    }

    .admin-pricing-simulator__body {
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 9px;
      padding: 10px;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .admin-pricing-simulator__settings {
      display: grid;
      grid-template-columns: 1fr 1.25fr;
      gap: 7px;
      flex: 0 0 auto;
    }

    .admin-pricing-simulator__settings details {
      min-width: 0;
      border: 1px solid #dbe3ec;
      border-radius: 10px;
      background: #fff;
      overflow: hidden;
    }

    .admin-pricing-simulator__settings details[open] {
      grid-column: 1 / -1;
    }

    .admin-pricing-simulator__settings summary {
      list-style: none;
      min-height: 38px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      box-sizing: border-box;
      padding: 7px 10px;
      cursor: pointer;
      user-select: none;
      background: #f8fafc;
    }

    .admin-pricing-simulator__settings summary::-webkit-details-marker {
      display: none;
    }

    .admin-pricing-simulator__settings-title {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 11px;
      font-weight: 900;
      white-space: nowrap;
    }

    .admin-pricing-simulator__settings-summary {
      min-width: 0;
      color: #64748b;
      font-size: 9.5px;
      font-weight: 750;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .admin-pricing-simulator__settings-chevron {
      flex: 0 0 auto;
      color: #64748b;
      font-size: 13px;
      transition: transform .15s ease;
    }

    .admin-pricing-simulator__settings details[open] .admin-pricing-simulator__settings-chevron {
      transform: rotate(180deg);
    }

    .admin-pricing-simulator__settings-content {
      border-top: 1px solid #e2e8f0;
      background: #fff;
    }

    .admin-pricing-simulator__wage-row {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr)) 128px;
      gap: 7px;
      align-items: end;
      padding: 9px;
    }

    .admin-pricing-simulator__assumptions-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 7px;
      padding: 9px;
    }

    .admin-pricing-simulator__field {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .admin-pricing-simulator__field label {
      color: #475569;
      font-size: 10px;
      line-height: 1.2;
      font-weight: 800;
    }

    .admin-pricing-simulator__field input,
    .admin-pricing-simulator__group-count,
    .admin-pricing-simulator__group-row input {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      border: 1px solid #cbd5e1;
      border-radius: 7px;
      background: #fff;
      color: #172033;
      font: inherit;
      font-weight: 800;
      outline: none;
    }

    .admin-pricing-simulator__field input {
      height: 31px;
      padding: 4px 7px;
      font-size: 11.5px;
    }

    .admin-pricing-simulator__field input:focus,
    .admin-pricing-simulator__group-count:focus,
    .admin-pricing-simulator__group-row input:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 2px rgba(37, 99, 235, .10);
    }

    .admin-pricing-simulator__wage-total {
      min-height: 48px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 2px;
      padding: 5px 9px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: #f8fafc;
      white-space: nowrap;
    }

    .admin-pricing-simulator__wage-total span {
      color: #64748b;
      font-size: 9.5px;
      font-weight: 750;
    }

    .admin-pricing-simulator__wage-total strong {
      color: #0f172a;
      font-size: 18px;
      line-height: 1.1;
      font-weight: 950;
    }

    .admin-pricing-simulator__section,
    .admin-pricing-simulator__summary {
      flex: 0 0 auto;
      border: 1px solid #dbe3ec;
      border-radius: 11px;
      background: #fff;
      overflow: hidden;
    }

    .admin-pricing-simulator__groups-section {
      min-height: 0;
      display: flex;
      flex-direction: column;
      border-color: #cbd5e1;
    }

    .admin-pricing-simulator__section-head,
    .admin-pricing-simulator__summary-head {
      min-height: 36px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 9px;
      padding: 6px 10px;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
    }

    .admin-pricing-simulator__section-head h3,
    .admin-pricing-simulator__summary-head strong {
      margin: 0;
      font-size: 12px;
      font-weight: 950;
    }

    .admin-pricing-simulator__summary-progress {
      color: #64748b;
      font-size: 10px;
      font-weight: 750;
    }

    .admin-pricing-simulator__groups-tools {
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .admin-pricing-simulator__count-wrap {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: #475569;
      font-size: 10px;
      font-weight: 800;
    }

    .admin-pricing-simulator__group-count {
      width: 58px;
      height: 28px;
      padding: 3px 5px;
      text-align: center;
      font-size: 11px;
    }

    .admin-pricing-simulator__groups-head,
    .admin-pricing-simulator__group-row {
      display: grid;
      grid-template-columns: 52px 76px 90px 92px 92px 78px 62px 96px 28px;
      gap: 5px;
      align-items: center;
    }

    .admin-pricing-simulator__groups-head {
      padding: 6px 7px;
      color: #475569;
      font-size: 9px;
      font-weight: 900;
      border-bottom: 1px solid #e2e8f0;
      background: #fbfcfe;
      text-align: center;
    }

    .admin-pricing-simulator__groups-list {
      min-height: 0;
      max-height: 360px;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-gutter: stable;
      background: #fff;
    }

    .admin-pricing-simulator__group-item {
      border-bottom: 1px solid #edf2f7;
    }

    .admin-pricing-simulator__group-item:last-child {
      border-bottom: 0;
    }

    .admin-pricing-simulator__group-row {
      min-height: 44px;
      padding: 5px 7px;
    }

    .admin-pricing-simulator__group-name {
      font-size: 10.5px;
      font-weight: 950;
      white-space: nowrap;
      text-align: center;
    }

    .admin-pricing-simulator__group-row input {
      height: 29px;
      padding: 3px 5px;
      font-size: 11px;
      text-align: center;
    }

    .admin-pricing-simulator__result {
      min-width: 0;
      color: #172033;
      font-size: 11px;
      font-weight: 900;
      text-align: center;
      white-space: nowrap;
    }

    .admin-pricing-simulator__result[data-group-result="finalPrice"],
    .admin-pricing-simulator__result[data-group-result="margin"] {
      color: #0f172a;
      font-weight: 950;
    }

    .admin-pricing-simulator__badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 21px;
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 8.5px;
      font-weight: 900;
      line-height: 1.1;
      white-space: nowrap;
    }

    .admin-pricing-simulator__badge.is-approved {
      color: #166534;
      background: #dcfce7;
      border: 1px solid #bbf7d0;
    }

    .admin-pricing-simulator__badge.is-rejected {
      color: #991b1b;
      background: #fee2e2;
      border: 1px solid #fecaca;
    }

    .admin-pricing-simulator__badge.is-pending {
      color: #475569;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
    }

    .admin-pricing-simulator__details-toggle {
      appearance: none;
      width: 26px;
      height: 26px;
      display: grid;
      place-items: center;
      border: 1px solid #dbe3ec;
      border-radius: 7px;
      background: #fff;
      color: #64748b;
      cursor: pointer;
      font-size: 13px;
      line-height: 1;
    }

    .admin-pricing-simulator__group-details {
      display: none;
      grid-template-columns: repeat(6, 1fr);
      gap: 6px;
      padding: 0 7px 7px;
      background: #fbfcfe;
    }

    .admin-pricing-simulator__group-item.is-open .admin-pricing-simulator__group-details {
      display: grid;
    }

    .admin-pricing-simulator__detail {
      padding: 5px 6px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      background: #fff;
      font-size: 9px;
    }

    .admin-pricing-simulator__detail span {
      display: block;
      color: #64748b;
      margin-bottom: 2px;
    }

    .admin-pricing-simulator__detail strong {
      color: #172033;
      font-size: 10.5px;
      font-weight: 900;
    }

    .admin-pricing-simulator__summary {
      border-color: #cbd5e1;
    }

    .admin-pricing-simulator__summary-row {
      display: grid;
      grid-template-columns: repeat(5, 1fr) 124px;
      gap: 1px;
      background: #e2e8f0;
    }

    .admin-pricing-simulator__summary-item,
    .admin-pricing-simulator__summary-status {
      background: #fff;
    }

    .admin-pricing-simulator__summary-item {
      min-width: 0;
      padding: 8px;
    }

    .admin-pricing-simulator__summary-item span {
      display: block;
      margin-bottom: 2px;
      color: #64748b;
      font-size: 9.5px;
      font-weight: 750;
    }

    .admin-pricing-simulator__summary-item strong {
      color: #0f172a;
      font-size: 14px;
      font-weight: 950;
      white-space: nowrap;
    }

    .admin-pricing-simulator__summary-status {
      display: grid;
      place-items: center;
      padding: 5px;
    }

    @media (max-width: 760px) {
      .admin-pricing-overlay {
        padding: 8px;
      }

      .admin-pricing-simulator {
        width: calc(100vw - 16px);
        max-height: 94vh;
      }

      .admin-pricing-simulator__subtitle {
        display: none;
      }

      .admin-pricing-simulator__settings {
        grid-template-columns: 1fr;
      }

      .admin-pricing-simulator__settings details[open] {
        grid-column: auto;
      }

      .admin-pricing-simulator__wage-row,
      .admin-pricing-simulator__assumptions-grid {
        grid-template-columns: repeat(2, 1fr);
      }

      .admin-pricing-simulator__wage-total {
        grid-column: 1 / -1;
      }

      .admin-pricing-simulator__assumptions-grid .admin-pricing-simulator__field:last-child {
        grid-column: 1 / -1;
      }

      .admin-pricing-simulator__groups-head {
        display: none;
      }

      .admin-pricing-simulator__groups-list {
        max-height: 48vh;
      }

      .admin-pricing-simulator__group-row {
        grid-template-columns: 52px repeat(2, 1fr);
        align-items: end;
      }

      .admin-pricing-simulator__result {
        padding: 4px;
        border: 1px solid #edf2f7;
        border-radius: 6px;
      }

      .admin-pricing-simulator__group-details {
        grid-template-columns: repeat(2, 1fr);
      }

      .admin-pricing-simulator__summary-row {
        grid-template-columns: repeat(2, 1fr);
      }

      .admin-pricing-simulator__summary-status {
        grid-column: 1 / -1;
      }
    }
  `;

  document.head.appendChild(style);
}

function groupRowsHtml(groups) {
  return groups.map((group, index) => `
    <div class="admin-pricing-simulator__group-item" data-pricing-group-row="${index}">
      <div class="admin-pricing-simulator__group-row">
        <div class="admin-pricing-simulator__group-name">${index + 1}</div>
        <input type="number" min="1" step="1" aria-label="כמות תלמידים קבוצה ${index + 1}" data-group-input="studentCount" value="${group.studentCount}">
        <input type="number" min="0" step="1" aria-label="עלות הסעה קבוצה ${index + 1}" data-group-input="transportCost" value="${group.transportCost}">
        <div class="admin-pricing-simulator__result" data-group-result="finalPrice">—</div>
        <div class="admin-pricing-simulator__result" data-group-result="minimumPrice">—</div>
        <div class="admin-pricing-simulator__result" data-group-result="profit">—</div>
        <div class="admin-pricing-simulator__result" data-group-result="margin">—</div>
        <div class="admin-pricing-simulator__result" data-group-result="status"><span class="admin-pricing-simulator__badge is-pending">חסרים נתונים</span></div>
        <button type="button" class="admin-pricing-simulator__details-toggle" data-group-details-toggle aria-label="פירוט הוצאות קבוצה ${index + 1}" title="פירוט הוצאות">⌄</button>
      </div>
      <div class="admin-pricing-simulator__group-details">
        <div class="admin-pricing-simulator__detail"><span>מחיר מדריך</span><strong data-group-result="instructorPrice">—</strong></div>
        <div class="admin-pricing-simulator__detail"><span>מחיר לתלמיד</span><strong data-group-result="studentPrice">—</strong></div>
        <div class="admin-pricing-simulator__detail"><span>עמלה</span><strong data-group-result="commission">—</strong></div>
        <div class="admin-pricing-simulator__detail"><span>שכר מדריך</span><strong data-group-result="instructorWage">—</strong></div>
        <div class="admin-pricing-simulator__detail"><span>עלות מקום</span><strong data-group-result="venueCost">—</strong></div>
        <div class="admin-pricing-simulator__detail"><span>סה״כ הוצאות</span><strong data-group-result="totalExpenses">—</strong></div>
      </div>
    </div>
  `).join('');
}

function setResult(row, name, text) {
  const element = row?.querySelector?.(`[data-group-result="${name}"]`);
  if (element) element.textContent = text;
}

export function openAdminPricingSimulator() {
  if (!isAdmin() || typeof document === 'undefined') return;

  const existing = document.querySelector('[data-admin-pricing-simulator-overlay]');
  if (existing) {
    existing.querySelector('[data-group-input="studentCount"]')?.focus();
    return;
  }

  ensureStyles();

  const overlay = document.createElement('div');
  overlay.className = 'admin-pricing-overlay';
  overlay.dir = 'rtl';
  overlay.dataset.adminPricingSimulatorOverlay = 'true';

  overlay.innerHTML = `
    <section class="admin-pricing-simulator" role="dialog" aria-modal="true" aria-labelledby="admin-pricing-title">
      <header class="admin-pricing-simulator__header">
        <div>
          <h2 class="admin-pricing-simulator__title" id="admin-pricing-title">סימולטור סיורים</h2>
          <p class="admin-pricing-simulator__subtitle">בדיקת רווחיות לקבוצה ולעסקה בית־ספרית · הנתונים אינם נשמרים</p>
        </div>
        <div class="admin-pricing-simulator__actions">
          <button type="button" class="admin-pricing-simulator__button" data-pricing-reset>איפוס</button>
          <button type="button" class="admin-pricing-simulator__close" data-pricing-close aria-label="סגירה">×</button>
        </div>
      </header>

      <div class="admin-pricing-simulator__body">
        <div class="admin-pricing-simulator__settings" aria-label="הגדרות סימולציה">
          <details data-settings-details="wage">
            <summary>
              <span class="admin-pricing-simulator__settings-title">
                שכר מדריך
                <span class="admin-pricing-simulator__settings-summary" data-wage-summary>432 ₪</span>
              </span>
              <span class="admin-pricing-simulator__settings-chevron">⌄</span>
            </summary>
            <div class="admin-pricing-simulator__settings-content">
              <div class="admin-pricing-simulator__wage-row">
                <div class="admin-pricing-simulator__field"><label>שעות</label><input type="number" min="0" step="0.25" data-wage-input="hours" value="${DEFAULT_WAGE_INPUTS.hours}"></div>
                <div class="admin-pricing-simulator__field"><label>מחיר לשעה</label><input type="number" min="0" step="1" data-wage-input="hourlyRate" value="${DEFAULT_WAGE_INPUTS.hourlyRate}"></div>
                <div class="admin-pricing-simulator__field"><label>מכפיל שכר</label><input type="number" min="0" step="0.1" data-wage-input="wageMultiplier" value="${DEFAULT_WAGE_INPUTS.wageMultiplier}"></div>
                <div class="admin-pricing-simulator__field"><label>ק״מ</label><input type="number" min="0" step="1" data-wage-input="kilometers" value="${DEFAULT_WAGE_INPUTS.kilometers}"></div>
                <div class="admin-pricing-simulator__field"><label>מכפיל ק״מ</label><input type="number" min="0" step="0.1" data-wage-input="kilometerMultiplier" value="${DEFAULT_WAGE_INPUTS.kilometerMultiplier}"></div>
                <div class="admin-pricing-simulator__wage-total"><span>שכר מחושב</span><strong data-pricing-wage-total>—</strong></div>
              </div>
            </div>
          </details>

          <details data-settings-details="assumptions">
            <summary>
              <span class="admin-pricing-simulator__settings-title">
                הנחות סימולציה
                <span class="admin-pricing-simulator__settings-summary" data-assumptions-summary>769.5 ₪ · 111 ₪ · 10% · 30% · 800 ₪</span>
              </span>
              <span class="admin-pricing-simulator__settings-chevron">⌄</span>
            </summary>
            <div class="admin-pricing-simulator__settings-content">
              <div class="admin-pricing-simulator__assumptions-grid">
                <div class="admin-pricing-simulator__field"><label>מחיר מדריך (₪)</label><input type="number" min="0" step="0.5" data-config-input="instructorPrice" value="${DEFAULT_PRICING_INPUTS.instructorPrice}"></div>
                <div class="admin-pricing-simulator__field"><label>מחיר לתלמיד (₪)</label><input type="number" min="0" step="1" data-config-input="studentPrice" value="${DEFAULT_PRICING_INPUTS.studentPrice}"></div>
                <div class="admin-pricing-simulator__field"><label>עמלה (%)</label><input type="number" min="0" max="99" step="0.1" data-config-input="commissionRate" value="${DEFAULT_PRICING_INPUTS.commissionRate}"></div>
                <div class="admin-pricing-simulator__field"><label>יעד רווחיות (%)</label><input type="number" min="0" max="99" step="0.1" data-config-input="targetMargin" value="${DEFAULT_PRICING_INPUTS.targetMargin}"></div>
                <div class="admin-pricing-simulator__field"><label>עלות מקום (₪)</label><input type="number" min="0" step="1" data-config-input="venueCost" value="${DEFAULT_PRICING_INPUTS.venueCost}"></div>
              </div>
            </div>
          </details>
        </div>

        <section class="admin-pricing-simulator__section admin-pricing-simulator__groups-section">
          <div class="admin-pricing-simulator__section-head">
            <h3>קבוצות</h3>
            <div class="admin-pricing-simulator__groups-tools">
              <label class="admin-pricing-simulator__count-wrap">מספר קבוצות
                <input class="admin-pricing-simulator__group-count" type="number" min="1" max="${MAX_GROUPS}" step="1" value="1" data-pricing-group-count>
              </label>
            </div>
          </div>
          <div class="admin-pricing-simulator__groups-head" aria-hidden="true">
            <span>קבוצה</span><span>תלמידים</span><span>הסעה</span><span>מחיר סופי</span><span>מינימום</span><span>רווח</span><span>רווחיות</span><span>סטטוס</span><span></span>
          </div>
          <div class="admin-pricing-simulator__groups-list" data-pricing-groups-body></div>
        </section>

        <section class="admin-pricing-simulator__summary" aria-live="polite">
          <div class="admin-pricing-simulator__summary-head">
            <strong>סיכום בית הספר</strong>
            <span class="admin-pricing-simulator__summary-progress" data-pricing-summary-progress></span>
          </div>
          <div class="admin-pricing-simulator__summary-row">
            <div class="admin-pricing-simulator__summary-item"><span>מחיר סופי</span><strong data-pricing-summary="finalPrice">—</strong></div>
            <div class="admin-pricing-simulator__summary-item"><span>מחיר מינימום</span><strong data-pricing-summary="minimumPrice">—</strong></div>
            <div class="admin-pricing-simulator__summary-item"><span>הוצאות</span><strong data-pricing-summary="totalExpenses">—</strong></div>
            <div class="admin-pricing-simulator__summary-item"><span>רווח</span><strong data-pricing-summary="profit">—</strong></div>
            <div class="admin-pricing-simulator__summary-item"><span>רווחיות</span><strong data-pricing-summary="margin">—</strong></div>
            <div class="admin-pricing-simulator__summary-status" data-pricing-summary-status><span class="admin-pricing-simulator__badge is-pending">יש להשלים נתונים</span></div>
          </div>
        </section>
      </div>
    </section>
  `;

  document.body.appendChild(overlay);

  const groupsBody = overlay.querySelector('[data-pricing-groups-body]');
  const groupCountInput = overlay.querySelector('[data-pricing-group-count]');
  const wageTotal = overlay.querySelector('[data-pricing-wage-total]');
  const wageSummary = overlay.querySelector('[data-wage-summary]');
  const assumptionsSummary = overlay.querySelector('[data-assumptions-summary]');
  const summaryProgress = overlay.querySelector('[data-pricing-summary-progress]');
  const summaryStatus = overlay.querySelector('[data-pricing-summary-status]');

  let groups = [blankGroup()];

  const readWageInputs = () => {
    const values = {};
    overlay.querySelectorAll('[data-wage-input]').forEach((input) => {
      values[input.dataset.wageInput] = input.value;
    });
    return values;
  };

  const readPricingInputs = () => {
    const values = {};
    overlay.querySelectorAll('[data-config-input]').forEach((input) => {
      values[input.dataset.configInput] = input.value;
    });
    return values;
  };

  const getPricingConfig = (values) => ({
    instructorPrice: Number(values.instructorPrice),
    studentPrice: Number(values.studentPrice),
    commissionRate: Number(values.commissionRate) / 100,
    targetMargin: Number(values.targetMargin) / 100,
    venueCost: Number(values.venueCost)
  });

  const updateCompactSummaries = (wageInputs, pricingInputs, instructorWage) => {
    wageSummary.textContent = wageInputsComplete(wageInputs) ? money(instructorWage) : 'חסרים נתונים';

    if (!pricingInputsComplete(pricingInputs)) {
      assumptionsSummary.textContent = 'חסרים נתונים';
      return;
    }

    assumptionsSummary.textContent = [
      money(pricingInputs.instructorPrice),
      money(pricingInputs.studentPrice),
      `${Number(pricingInputs.commissionRate)}%`,
      `${Number(pricingInputs.targetMargin)}%`,
      money(pricingInputs.venueCost)
    ].join(' · ');
  };

  const renderSummaryValue = (name, value) => {
    const element = overlay.querySelector(`[data-pricing-summary="${name}"]`);
    if (element) element.textContent = name === 'margin' ? percent(value) : money(value);
  };

  const clearResults = (message) => {
    groups.forEach((group, index) => {
      const row = groupsBody.querySelector(`[data-pricing-group-row="${index}"]`);
      if (!row) return;

      [
        'finalPrice',
        'minimumPrice',
        'profit',
        'margin',
        'instructorPrice',
        'studentPrice',
        'commission',
        'instructorWage',
        'venueCost',
        'totalExpenses'
      ].forEach((name) => setResult(row, name, '—'));

      const status = row.querySelector('[data-group-result="status"]');
      if (status) status.innerHTML = '<span class="admin-pricing-simulator__badge is-pending">חסרים נתונים</span>';
    });

    ['finalPrice', 'minimumPrice', 'totalExpenses', 'profit', 'margin'].forEach((name) => {
      const element = overlay.querySelector(`[data-pricing-summary="${name}"]`);
      if (element) element.textContent = '—';
    });

    summaryProgress.textContent = `0/${groups.length} קבוצות`;
    summaryStatus.innerHTML = `<span class="admin-pricing-simulator__badge is-pending">${message}</span>`;
  };

  const renderCalculations = () => {
    const wageInputs = readWageInputs();
    const pricingInputs = readPricingInputs();
    const wageComplete = wageInputsComplete(wageInputs);
    const pricingComplete = pricingInputsComplete(pricingInputs);
    const instructorWage = wageComplete ? calculateInstructorWage(wageInputs) : 0;

    wageTotal.textContent = wageComplete ? money(instructorWage) : '—';
    updateCompactSummaries(wageInputs, pricingInputs, instructorWage);

    if (!wageComplete) {
      clearResults('יש להשלים שכר מדריך');
      return;
    }

    if (!pricingComplete) {
      clearResults('יש להשלים הנחות סימולציה');
      return;
    }

    const config = getPricingConfig(pricingInputs);
    if (
      !Number.isFinite(config.instructorPrice)
      || !Number.isFinite(config.studentPrice)
      || !Number.isFinite(config.commissionRate)
      || !Number.isFinite(config.targetMargin)
      || !Number.isFinite(config.venueCost)
      || config.instructorPrice < 0
      || config.studentPrice < 0
      || config.commissionRate < 0
      || config.targetMargin < 0
      || config.venueCost < 0
      || config.commissionRate + config.targetMargin >= 1
    ) {
      clearResults('יש לבדוק את הנחות הסימולציה');
      return;
    }

    const completedResults = [];

    groups.forEach((group, index) => {
      const row = groupsBody.querySelector(`[data-pricing-group-row="${index}"]`);
      if (!row) return;

      if (!groupComplete(group)) {
        [
          'finalPrice',
          'minimumPrice',
          'profit',
          'margin',
          'instructorPrice',
          'studentPrice',
          'commission',
          'instructorWage',
          'venueCost',
          'totalExpenses'
        ].forEach((name) => setResult(row, name, '—'));

        const status = row.querySelector('[data-group-result="status"]');
        if (status) status.innerHTML = '<span class="admin-pricing-simulator__badge is-pending">חסרים נתונים</span>';
        return;
      }

      const result = calculatePricingGroup({
        studentCount: group.studentCount,
        transportCost: group.transportCost,
        instructorWage
      }, config);

      completedResults.push(result);

      setResult(row, 'finalPrice', money(result.finalPrice));
      setResult(row, 'minimumPrice', money(result.minimumPrice));
      setResult(row, 'profit', money(result.profit));
      setResult(row, 'margin', percent(result.margin));
      setResult(row, 'instructorPrice', money(result.instructorPrice));
      setResult(row, 'studentPrice', money(result.studentPrice));
      setResult(row, 'commission', money(result.commission));
      setResult(row, 'instructorWage', money(result.instructorWage));
      setResult(row, 'venueCost', money(result.venueCost));
      setResult(row, 'totalExpenses', money(result.totalExpenses));

      const status = row.querySelector('[data-group-result="status"]');
      if (status) {
        status.innerHTML = result.approved
          ? '<span class="admin-pricing-simulator__badge is-approved">מאושר</span>'
          : '<span class="admin-pricing-simulator__badge is-rejected">לא מאושר</span>';
      }
    });

    const completeCount = completedResults.length;
    summaryProgress.textContent = `${completeCount}/${groups.length} קבוצות`;

    if (!completeCount) {
      ['finalPrice', 'minimumPrice', 'totalExpenses', 'profit', 'margin'].forEach((name) => {
        const element = overlay.querySelector(`[data-pricing-summary="${name}"]`);
        if (element) element.textContent = '—';
      });

      summaryStatus.innerHTML = '<span class="admin-pricing-simulator__badge is-pending">יש להשלים נתונים</span>';
      return;
    }

    const school = calculateSchoolPricing(completedResults, config);
    renderSummaryValue('finalPrice', school.finalPrice);
    renderSummaryValue('minimumPrice', school.minimumPrice);
    renderSummaryValue('totalExpenses', school.totalExpenses);
    renderSummaryValue('profit', school.profit);
    renderSummaryValue('margin', school.margin);

    if (completeCount !== groups.length) {
      summaryStatus.innerHTML = '<span class="admin-pricing-simulator__badge is-pending">סיכום ביניים</span>';
      return;
    }

    summaryStatus.innerHTML = school.approved
      ? '<span class="admin-pricing-simulator__badge is-approved">מאושר לבית הספר</span>'
      : '<span class="admin-pricing-simulator__badge is-rejected">לא מאושר לבית הספר</span>';
  };

  const renderGroups = () => {
    groupsBody.innerHTML = groupRowsHtml(groups);
    renderCalculations();
  };

  const resizeGroups = (requestedCount) => {
    const count = Math.min(MAX_GROUPS, Math.max(1, Math.floor(Number(requestedCount) || 1)));

    while (groups.length < count) groups.push(blankGroup());
    if (groups.length > count) groups = groups.slice(0, count);

    groupCountInput.value = String(count);
    renderGroups();
  };

  overlay.querySelectorAll('[data-wage-input], [data-config-input]').forEach((input) => {
    input.addEventListener('input', renderCalculations);
  });

  groupCountInput.addEventListener('input', () => resizeGroups(groupCountInput.value));

  groupsBody.addEventListener('input', (event) => {
    const input = event.target.closest?.('[data-group-input]');
    const row = event.target.closest?.('[data-pricing-group-row]');
    if (!input || !row) return;

    const index = Number(row.dataset.pricingGroupRow);
    if (!Number.isInteger(index) || !groups[index]) return;

    groups[index][input.dataset.groupInput] = input.value;
    renderCalculations();
  });

  groupsBody.addEventListener('click', (event) => {
    const toggle = event.target.closest?.('[data-group-details-toggle]');
    if (!toggle) return;

    const row = toggle.closest('[data-pricing-group-row]');
    row?.classList.toggle('is-open');
    toggle.textContent = row?.classList.contains('is-open') ? '⌃' : '⌄';
  });

  const resetSimulator = () => {
    Object.entries(DEFAULT_WAGE_INPUTS).forEach(([key, value]) => {
      const input = overlay.querySelector(`[data-wage-input="${key}"]`);
      if (input) input.value = value;
    });

    Object.entries(DEFAULT_PRICING_INPUTS).forEach(([key, value]) => {
      const input = overlay.querySelector(`[data-config-input="${key}"]`);
      if (input) input.value = value;
    });

    overlay.querySelectorAll('[data-settings-details]').forEach((details) => {
      details.open = false;
    });

    groups = [blankGroup()];
    groupCountInput.value = '1';
    renderGroups();
    groupsBody.querySelector('[data-group-input="studentCount"]')?.focus();
  };

  const close = () => overlay.remove();

  overlay.querySelector('[data-pricing-close]')?.addEventListener('click', close);
  overlay.querySelector('[data-pricing-reset]')?.addEventListener('click', resetSimulator);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  renderGroups();
  groupsBody.querySelector('[data-group-input="studentCount"]')?.focus();
}
