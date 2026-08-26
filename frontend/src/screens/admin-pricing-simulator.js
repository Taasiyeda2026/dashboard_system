import { state } from '../state.js';
import {
  ADMIN_PRICING_CONFIG,
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

function isAdmin() {
  return String(state?.user?.role || state?.user?.display_role || '').trim() === 'admin';
}

function money(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return `${new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(Number(value))} ₪`;
}

function percent(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function hasValue(value) {
  return String(value ?? '').trim() !== '';
}

function groupComplete(group) {
  return hasValue(group?.instructorCharge)
    && hasValue(group?.studentCount)
    && Number(group?.studentCount) > 0
    && hasValue(group?.transportCost);
}

function wageInputsComplete(values) {
  return ['hours', 'hourlyRate', 'wageMultiplier', 'kilometers', 'kilometerMultiplier']
    .every((key) => hasValue(values?.[key]));
}

function blankGroup() {
  return { instructorCharge: '', studentCount: '', transportCost: '' };
}

function ensureStyles() {
  if (document.getElementById('admin-pricing-simulator-styles')) return;
  const style = document.createElement('style');
  style.id = 'admin-pricing-simulator-styles';
  style.textContent = `
    .admin-pricing-simulator {
      width: min(96vw, 1220px);
      max-width: 1220px;
      margin: auto;
      padding: 0;
      border: 1px solid var(--color-border, #dbe3ec);
      border-radius: 18px;
      background: var(--color-surface, #fff);
      color: var(--color-text, #172033);
      box-shadow: 0 24px 68px rgba(15, 23, 42, .24);
      overflow: hidden;
    }
    .admin-pricing-simulator::backdrop {
      background: rgba(15, 23, 42, .28);
      backdrop-filter: blur(2px);
    }
    .admin-pricing-simulator__shell {
      display: flex;
      flex-direction: column;
      max-height: 90vh;
    }
    .admin-pricing-simulator__header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      padding: 20px 24px 16px;
      border-bottom: 1px solid var(--color-border, #e2e8f0);
    }
    .admin-pricing-simulator__title {
      margin: 0;
      font-size: 20px;
      line-height: 1.25;
      font-weight: 850;
    }
    .admin-pricing-simulator__subtitle {
      margin: 5px 0 0;
      color: var(--color-text-secondary, #64748b);
      font-size: 12.5px;
      line-height: 1.5;
    }
    .admin-pricing-simulator__header-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
    }
    .admin-pricing-simulator__reset,
    .admin-pricing-simulator__close,
    .admin-pricing-simulator__copy-first {
      appearance: none;
      border: 1px solid var(--color-border, #dbe3ec);
      background: var(--color-surface, #fff);
      color: var(--color-text-secondary, #64748b);
      cursor: pointer;
      font: inherit;
    }
    .admin-pricing-simulator__reset {
      min-height: 34px;
      padding: 6px 11px;
      border-radius: 9px;
      font-size: 12px;
      font-weight: 750;
    }
    .admin-pricing-simulator__close {
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      padding: 0;
      border-radius: 10px;
      background: var(--color-surface-muted, #f8fafc);
      font-size: 20px;
      line-height: 1;
    }
    .admin-pricing-simulator__reset:hover,
    .admin-pricing-simulator__close:hover,
    .admin-pricing-simulator__copy-first:hover {
      border-color: var(--color-primary, #64748b);
      color: var(--color-text, #172033);
    }
    .admin-pricing-simulator__body {
      padding: 20px 24px 24px;
      overflow: auto;
    }
    .admin-pricing-simulator__section {
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 14px;
      background: var(--color-surface, #fff);
      overflow: hidden;
    }
    .admin-pricing-simulator__section + .admin-pricing-simulator__section {
      margin-top: 16px;
    }
    .admin-pricing-simulator__section-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 13px 16px;
      background: var(--color-surface-muted, #f8fafc);
      border-bottom: 1px solid var(--color-border, #e2e8f0);
    }
    .admin-pricing-simulator__section-head h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 850;
    }
    .admin-pricing-simulator__section-head small {
      color: var(--color-text-secondary, #64748b);
      font-size: 11.5px;
    }
    .admin-pricing-simulator__wage-content {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 190px;
      gap: 18px;
      padding: 16px;
      align-items: stretch;
    }
    .admin-pricing-simulator__wage-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(105px, 1fr));
      gap: 10px;
    }
    .admin-pricing-simulator__field {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .admin-pricing-simulator__field label {
      font-size: 11.5px;
      font-weight: 750;
      color: var(--color-text-secondary, #475569);
    }
    .admin-pricing-simulator__field input,
    .admin-pricing-simulator__group-count,
    .admin-pricing-simulator__table input {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      height: 38px;
      border: 1px solid var(--color-border, #cbd5e1);
      border-radius: 9px;
      padding: 7px 9px;
      background: var(--color-surface, #fff);
      color: var(--color-text, #172033);
      font: inherit;
      outline: none;
    }
    .admin-pricing-simulator__field input:focus,
    .admin-pricing-simulator__group-count:focus,
    .admin-pricing-simulator__table input:focus {
      border-color: var(--color-primary, #0ea5e9);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #0ea5e9) 14%, transparent);
    }
    .admin-pricing-simulator__wage-total {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 7px;
      padding: 14px 16px;
      border-radius: 12px;
      background: var(--color-surface-muted, #f8fafc);
      border: 1px solid var(--color-border, #e2e8f0);
    }
    .admin-pricing-simulator__wage-total span {
      color: var(--color-text-secondary, #64748b);
      font-size: 11.5px;
      font-weight: 700;
    }
    .admin-pricing-simulator__wage-total strong {
      font-size: 26px;
      line-height: 1;
      font-weight: 900;
    }
    .admin-pricing-simulator__constants {
      display: flex;
      flex-wrap: wrap;
      gap: 7px 14px;
      padding: 0 16px 15px;
      color: var(--color-text-secondary, #64748b);
      font-size: 11.5px;
    }
    .admin-pricing-simulator__constant strong {
      color: var(--color-text, #334155);
      font-weight: 850;
    }
    .admin-pricing-simulator__groups-tools {
      display: flex;
      align-items: center;
      gap: 9px;
      flex-wrap: wrap;
    }
    .admin-pricing-simulator__count-wrap {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 11.5px;
      font-weight: 750;
      color: var(--color-text-secondary, #475569);
    }
    .admin-pricing-simulator__group-count {
      width: 76px;
      height: 34px;
      padding: 5px 8px;
      text-align: center;
    }
    .admin-pricing-simulator__copy-first {
      min-height: 34px;
      padding: 6px 10px;
      border-radius: 9px;
      font-size: 11.5px;
      font-weight: 750;
    }
    .admin-pricing-simulator__copy-first[hidden] {
      display: none;
    }
    .admin-pricing-simulator__table-wrap {
      overflow: auto;
      max-width: 100%;
    }
    .admin-pricing-simulator__table {
      width: 100%;
      min-width: 1570px;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 11.5px;
    }
    .admin-pricing-simulator__table th,
    .admin-pricing-simulator__table td {
      height: 48px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--color-border, #edf2f7);
      border-inline-start: 1px solid var(--color-border, #f1f5f9);
      vertical-align: middle;
      text-align: center;
      white-space: nowrap;
    }
    .admin-pricing-simulator__table thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      height: 40px;
      background: var(--color-surface-muted, #f8fafc);
      color: var(--color-text-secondary, #475569);
      font-weight: 850;
    }
    .admin-pricing-simulator__table th:first-child,
    .admin-pricing-simulator__table td:first-child {
      position: sticky;
      right: 0;
      z-index: 1;
      background: var(--color-surface, #fff);
      border-inline-start: 0;
      font-weight: 850;
    }
    .admin-pricing-simulator__table thead th:first-child {
      z-index: 3;
      background: var(--color-surface-muted, #f8fafc);
    }
    .admin-pricing-simulator__table tbody tr:last-child td {
      border-bottom: 0;
    }
    .admin-pricing-simulator__table input {
      width: 94px;
      height: 34px;
      text-align: center;
      padding: 5px 7px;
    }
    .admin-pricing-simulator__fixed {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-weight: 850;
      color: var(--color-text, #334155);
    }
    .admin-pricing-simulator__muted-result {
      color: var(--color-text-secondary, #94a3b8);
    }
    .admin-pricing-simulator__badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 94px;
      min-height: 26px;
      border-radius: 999px;
      padding: 4px 9px;
      font-size: 10.5px;
      font-weight: 850;
      line-height: 1.2;
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
      color: #64748b;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
    }
    .admin-pricing-simulator__formula-note {
      margin: 0;
      padding: 11px 16px 13px;
      border-top: 1px solid var(--color-border, #edf2f7);
      color: var(--color-text-secondary, #64748b);
      font-size: 11px;
      line-height: 1.5;
    }
    .admin-pricing-simulator__summary {
      margin-top: 16px;
      border: 1px solid var(--color-border, #dbe3ec);
      border-radius: 14px;
      overflow: hidden;
    }
    .admin-pricing-simulator__summary-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      background: var(--color-surface-muted, #f8fafc);
      border-bottom: 1px solid var(--color-border, #e2e8f0);
    }
    .admin-pricing-simulator__summary-head strong {
      font-size: 14px;
      font-weight: 850;
    }
    .admin-pricing-simulator__summary-progress {
      color: var(--color-text-secondary, #64748b);
      font-size: 11.5px;
    }
    .admin-pricing-simulator__summary-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }
    .admin-pricing-simulator__summary-item {
      padding: 13px 15px;
      border-inline-start: 1px solid var(--color-border, #edf2f7);
    }
    .admin-pricing-simulator__summary-item:first-child {
      border-inline-start: 0;
    }
    .admin-pricing-simulator__summary-item span {
      display: block;
      margin-bottom: 5px;
      color: var(--color-text-secondary, #64748b);
      font-size: 10.5px;
      font-weight: 700;
    }
    .admin-pricing-simulator__summary-item strong {
      font-size: 18px;
      font-weight: 900;
    }
    .admin-pricing-simulator__summary-status {
      display: flex;
      justify-content: center;
      padding: 13px 16px 15px;
      border-top: 1px solid var(--color-border, #edf2f7);
    }
    @media (max-width: 900px) {
      .admin-pricing-simulator__wage-content { grid-template-columns: 1fr; }
      .admin-pricing-simulator__wage-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .admin-pricing-simulator__summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .admin-pricing-simulator__summary-item { border-bottom: 1px solid var(--color-border, #edf2f7); }
    }
    @media (max-width: 560px) {
      .admin-pricing-simulator__header,
      .admin-pricing-simulator__body { padding-inline: 15px; }
      .admin-pricing-simulator__header { align-items: center; }
      .admin-pricing-simulator__subtitle { display: none; }
      .admin-pricing-simulator__reset { display: none; }
      .admin-pricing-simulator__wage-grid { grid-template-columns: 1fr; }
      .admin-pricing-simulator__section-head { align-items: flex-start; flex-direction: column; }
      .admin-pricing-simulator__summary-grid { grid-template-columns: 1fr 1fr; }
    }
  `;
  document.head.appendChild(style);
}

function groupRowsHtml(groups) {
  return groups.map((group, index) => `
    <tr data-pricing-group-row="${index}">
      <td>קבוצה ${index + 1}</td>
      <td><input type="number" min="0" step="1" inputmode="decimal" aria-label="עלות מדריך קבוצה ${index + 1}" data-group-input="instructorCharge" value="${group.instructorCharge}"></td>
      <td><input type="number" min="1" step="1" inputmode="numeric" aria-label="כמות תלמידים קבוצה ${index + 1}" data-group-input="studentCount" value="${group.studentCount}"></td>
      <td><span class="admin-pricing-simulator__fixed">${ADMIN_PRICING_CONFIG.studentPrice} ₪ <span aria-hidden="true">🔒</span></span></td>
      <td><input type="number" min="0" step="1" inputmode="decimal" aria-label="עלות הסעה קבוצה ${index + 1}" data-group-input="transportCost" value="${group.transportCost}"></td>
      <td data-group-result="finalPrice">—</td>
      <td data-group-result="minimumPrice">—</td>
      <td data-group-result="commission">—</td>
      <td data-group-result="instructorWage">—</td>
      <td data-group-result="venueCost">—</td>
      <td data-group-result="totalExpenses">—</td>
      <td data-group-result="profit">—</td>
      <td data-group-result="margin">—</td>
      <td data-group-result="status"><span class="admin-pricing-simulator__badge is-pending">חסרים נתונים</span></td>
    </tr>`).join('');
}

function setResult(row, name, text, muted = false) {
  const cell = row?.querySelector?.(`[data-group-result="${name}"]`);
  if (!cell) return;
  cell.textContent = text;
  cell.classList.toggle('admin-pricing-simulator__muted-result', muted);
}

export function openAdminPricingSimulator() {
  if (!isAdmin() || typeof document === 'undefined') return;

  const existing = document.querySelector('[data-admin-pricing-simulator-dialog]');
  if (existing) {
    existing.showModal?.();
    existing.querySelector('[data-wage-input="hours"]')?.focus();
    return;
  }

  ensureStyles();

  const dialog = document.createElement('dialog');
  dialog.className = 'admin-pricing-simulator';
  dialog.dir = 'rtl';
  dialog.dataset.adminPricingSimulatorDialog = 'true';
  dialog.innerHTML = `
    <div class="admin-pricing-simulator__shell">
      <header class="admin-pricing-simulator__header">
        <div>
          <h2 class="admin-pricing-simulator__title">סימולטור תמחור</h2>
          <p class="admin-pricing-simulator__subtitle">בדיקת רווחיות לקבוצה בודדת ולעסקה כוללת של בית ספר. הנתונים אינם נשמרים.</p>
        </div>
        <div class="admin-pricing-simulator__header-actions">
          <button type="button" class="admin-pricing-simulator__reset" data-pricing-reset>איפוס</button>
          <button type="button" class="admin-pricing-simulator__close" data-pricing-close aria-label="סגירה">×</button>
        </div>
      </header>
      <div class="admin-pricing-simulator__body">
        <section class="admin-pricing-simulator__section">
          <div class="admin-pricing-simulator__section-head">
            <h3>1. הוצאות שכר מדריך</h3>
            <small>הסכום המחושב מוזן אוטומטית כהוצאה בכל קבוצה.</small>
          </div>
          <div class="admin-pricing-simulator__wage-content">
            <div class="admin-pricing-simulator__wage-grid">
              <div class="admin-pricing-simulator__field">
                <label for="pricing-hours">שעות</label>
                <input id="pricing-hours" type="number" min="0" step="0.25" inputmode="decimal" data-wage-input="hours" value="${DEFAULT_WAGE_INPUTS.hours}">
              </div>
              <div class="admin-pricing-simulator__field">
                <label for="pricing-hourly-rate">מחיר לשעה</label>
                <input id="pricing-hourly-rate" type="number" min="0" step="1" inputmode="decimal" data-wage-input="hourlyRate" value="${DEFAULT_WAGE_INPUTS.hourlyRate}">
              </div>
              <div class="admin-pricing-simulator__field">
                <label for="pricing-wage-multiplier">מכפיל שכר</label>
                <input id="pricing-wage-multiplier" type="number" min="0" step="0.1" inputmode="decimal" data-wage-input="wageMultiplier" value="${DEFAULT_WAGE_INPUTS.wageMultiplier}">
              </div>
              <div class="admin-pricing-simulator__field">
                <label for="pricing-km">ק״מ</label>
                <input id="pricing-km" type="number" min="0" step="1" inputmode="decimal" data-wage-input="kilometers" value="${DEFAULT_WAGE_INPUTS.kilometers}">
              </div>
              <div class="admin-pricing-simulator__field">
                <label for="pricing-km-multiplier">מכפיל ק״מ</label>
                <input id="pricing-km-multiplier" type="number" min="0" step="0.1" inputmode="decimal" data-wage-input="kilometerMultiplier" value="${DEFAULT_WAGE_INPUTS.kilometerMultiplier}">
              </div>
            </div>
            <div class="admin-pricing-simulator__wage-total">
              <span>שכר מדריך מחושב</span>
              <strong data-pricing-wage-total>—</strong>
            </div>
          </div>
          <div class="admin-pricing-simulator__constants" aria-label="ערכים קבועים בסימולטור">
            <span class="admin-pricing-simulator__constant">מחיר לתלמיד: <strong>${ADMIN_PRICING_CONFIG.studentPrice} ₪</strong></span>
            <span class="admin-pricing-simulator__constant">עמלה: <strong>${ADMIN_PRICING_CONFIG.commissionRate * 100}%</strong></span>
            <span class="admin-pricing-simulator__constant">יעד רווחיות: <strong>${ADMIN_PRICING_CONFIG.targetMargin * 100}%</strong></span>
            <span class="admin-pricing-simulator__constant">עלות מקום: <strong>${ADMIN_PRICING_CONFIG.venueCost} ₪</strong></span>
          </div>
        </section>

        <section class="admin-pricing-simulator__section">
          <div class="admin-pricing-simulator__section-head">
            <h3>2. קבוצות ובדיקת רווחיות</h3>
            <div class="admin-pricing-simulator__groups-tools">
              <label class="admin-pricing-simulator__count-wrap">
                מספר קבוצות בבית הספר
                <input class="admin-pricing-simulator__group-count" type="number" min="1" max="${MAX_GROUPS}" step="1" value="1" inputmode="numeric" data-pricing-group-count>
              </label>
              <button type="button" class="admin-pricing-simulator__copy-first" data-pricing-copy-first hidden>העתק קבוצה 1 לכולן</button>
            </div>
          </div>
          <div class="admin-pricing-simulator__table-wrap">
            <table class="admin-pricing-simulator__table">
              <thead>
                <tr>
                  <th>קבוצה</th>
                  <th>עלות מדריך</th>
                  <th>כמות תלמידים</th>
                  <th>מחיר לתלמיד</th>
                  <th>עלות הסעה</th>
                  <th>מחיר סופי</th>
                  <th>מחיר מינימום</th>
                  <th>עמלה 10%</th>
                  <th>שכר מדריך</th>
                  <th>עלות מקום</th>
                  <th>סה״כ הוצאות</th>
                  <th>רווח</th>
                  <th>רווחיות</th>
                  <th>סטטוס</th>
                </tr>
              </thead>
              <tbody data-pricing-groups-body></tbody>
            </table>
          </div>
          <p class="admin-pricing-simulator__formula-note">מחיר מינימום = (שכר מדריך + עלות הסעה + עלות מקום) ÷ 60%, בעיגול כלפי מעלה. 60% הם היתרה לאחר עמלה של 10% ויעד רווח של 30%.</p>
        </section>

        <section class="admin-pricing-simulator__summary" aria-live="polite">
          <div class="admin-pricing-simulator__summary-head">
            <strong>סיכום בית הספר</strong>
            <span class="admin-pricing-simulator__summary-progress" data-pricing-summary-progress></span>
          </div>
          <div class="admin-pricing-simulator__summary-grid">
            <div class="admin-pricing-simulator__summary-item"><span>מחיר סופי</span><strong data-pricing-summary="finalPrice">—</strong></div>
            <div class="admin-pricing-simulator__summary-item"><span>מחיר מינימום</span><strong data-pricing-summary="minimumPrice">—</strong></div>
            <div class="admin-pricing-simulator__summary-item"><span>סה״כ הוצאות</span><strong data-pricing-summary="totalExpenses">—</strong></div>
            <div class="admin-pricing-simulator__summary-item"><span>רווח</span><strong data-pricing-summary="profit">—</strong></div>
            <div class="admin-pricing-simulator__summary-item"><span>רווחיות</span><strong data-pricing-summary="margin">—</strong></div>
          </div>
          <div class="admin-pricing-simulator__summary-status" data-pricing-summary-status>
            <span class="admin-pricing-simulator__badge is-pending">יש להשלים את נתוני הקבוצה</span>
          </div>
        </section>
      </div>
    </div>`;

  document.body.appendChild(dialog);

  const groupsBody = dialog.querySelector('[data-pricing-groups-body]');
  const groupCountInput = dialog.querySelector('[data-pricing-group-count]');
  const copyFirstButton = dialog.querySelector('[data-pricing-copy-first]');
  const wageTotal = dialog.querySelector('[data-pricing-wage-total]');
  const summaryProgress = dialog.querySelector('[data-pricing-summary-progress]');
  const summaryStatus = dialog.querySelector('[data-pricing-summary-status]');
  let groups = [blankGroup()];

  const readWageInputs = () => {
    const values = {};
    dialog.querySelectorAll('[data-wage-input]').forEach((input) => {
      values[input.dataset.wageInput] = input.value;
    });
    return values;
  };

  const renderSummaryValue = (name, value) => {
    const element = dialog.querySelector(`[data-pricing-summary="${name}"]`);
    if (!element) return;
    element.textContent = name === 'margin' ? percent(value) : money(value);
  };

  const renderCalculations = () => {
    const wageInputs = readWageInputs();
    const wageComplete = wageInputsComplete(wageInputs);
    const instructorWage = wageComplete ? calculateInstructorWage(wageInputs) : 0;
    wageTotal.textContent = wageComplete ? money(instructorWage) : '—';

    const completedResults = [];
    groups.forEach((group, index) => {
      const row = groupsBody.querySelector(`[data-pricing-group-row="${index}"]`);
      const complete = wageComplete && groupComplete(group);
      if (!row) return;

      if (!complete) {
        ['finalPrice', 'minimumPrice', 'commission', 'instructorWage', 'venueCost', 'totalExpenses', 'profit', 'margin']
          .forEach((name) => setResult(row, name, '—', true));
        const statusCell = row.querySelector('[data-group-result="status"]');
        if (statusCell) statusCell.innerHTML = '<span class="admin-pricing-simulator__badge is-pending">חסרים נתונים</span>';
        return;
      }

      const result = calculatePricingGroup({
        instructorCharge: group.instructorCharge,
        studentCount: group.studentCount,
        transportCost: group.transportCost,
        instructorWage
      });
      completedResults.push(result);
      setResult(row, 'finalPrice', money(result.finalPrice));
      setResult(row, 'minimumPrice', money(result.minimumPrice));
      setResult(row, 'commission', money(result.commission));
      setResult(row, 'instructorWage', money(result.instructorWage));
      setResult(row, 'venueCost', money(result.venueCost));
      setResult(row, 'totalExpenses', money(result.totalExpenses));
      setResult(row, 'profit', money(result.profit));
      setResult(row, 'margin', percent(result.margin));
      const statusCell = row.querySelector('[data-group-result="status"]');
      if (statusCell) {
        statusCell.innerHTML = result.approved
          ? '<span class="admin-pricing-simulator__badge is-approved">מאושר לקבוצה</span>'
          : '<span class="admin-pricing-simulator__badge is-rejected">לא מאושר</span>';
      }
    });

    const completeCount = completedResults.length;
    summaryProgress.textContent = `${completeCount} מתוך ${groups.length} קבוצות הושלמו`;

    if (!completeCount) {
      ['finalPrice', 'minimumPrice', 'totalExpenses', 'profit', 'margin'].forEach((name) => {
        const element = dialog.querySelector(`[data-pricing-summary="${name}"]`);
        if (element) element.textContent = '—';
      });
      summaryStatus.innerHTML = `<span class="admin-pricing-simulator__badge is-pending">${wageComplete ? 'יש להשלים את נתוני הקבוצה' : 'יש להשלים את נתוני שכר המדריך'}</span>`;
      return;
    }

    const school = calculateSchoolPricing(completedResults);
    renderSummaryValue('finalPrice', school.finalPrice);
    renderSummaryValue('minimumPrice', school.minimumPrice);
    renderSummaryValue('totalExpenses', school.totalExpenses);
    renderSummaryValue('profit', school.profit);
    renderSummaryValue('margin', school.margin);

    if (completeCount !== groups.length) {
      summaryStatus.innerHTML = '<span class="admin-pricing-simulator__badge is-pending">סיכום ביניים — יש להשלים את כל הקבוצות</span>';
      return;
    }

    summaryStatus.innerHTML = school.approved
      ? '<span class="admin-pricing-simulator__badge is-approved">מאושר לבית הספר</span>'
      : '<span class="admin-pricing-simulator__badge is-rejected">לא מאושר לבית הספר</span>';
  };

  const renderGroups = () => {
    groupsBody.innerHTML = groupRowsHtml(groups);
    copyFirstButton.hidden = groups.length < 2;
    renderCalculations();
  };

  const resizeGroups = (requestedCount) => {
    const count = Math.min(MAX_GROUPS, Math.max(1, Math.floor(Number(requestedCount) || 1)));
    while (groups.length < count) groups.push(blankGroup());
    if (groups.length > count) groups = groups.slice(0, count);
    groupCountInput.value = String(count);
    renderGroups();
  };

  dialog.querySelectorAll('[data-wage-input]').forEach((input) => {
    input.addEventListener('input', renderCalculations);
  });

  groupCountInput.addEventListener('change', () => resizeGroups(groupCountInput.value));
  groupCountInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      resizeGroups(groupCountInput.value);
    }
  });

  groupsBody.addEventListener('input', (event) => {
    const input = event.target.closest?.('[data-group-input]');
    const row = event.target.closest?.('[data-pricing-group-row]');
    if (!input || !row) return;
    const index = Number(row.dataset.pricingGroupRow);
    if (!Number.isInteger(index) || !groups[index]) return;
    groups[index][input.dataset.groupInput] = input.value;
    renderCalculations();
  });

  copyFirstButton.addEventListener('click', () => {
    if (!groups.length) return;
    const source = { ...groups[0] };
    groups = groups.map((group, index) => index === 0 ? group : { ...source });
    renderGroups();
  });

  const resetSimulator = () => {
    Object.entries(DEFAULT_WAGE_INPUTS).forEach(([key, value]) => {
      const input = dialog.querySelector(`[data-wage-input="${key}"]`);
      if (input) input.value = value;
    });
    groups = [blankGroup()];
    groupCountInput.value = '1';
    renderGroups();
    groupsBody.querySelector('[data-group-input="instructorCharge"]')?.focus();
  };

  const closeDialog = () => dialog.close?.();
  dialog.querySelector('[data-pricing-close]')?.addEventListener('click', closeDialog);
  dialog.querySelector('[data-pricing-reset]')?.addEventListener('click', resetSimulator);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDialog();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });

  renderGroups();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  groupsBody.querySelector('[data-group-input="instructorCharge"]')?.focus();
}
