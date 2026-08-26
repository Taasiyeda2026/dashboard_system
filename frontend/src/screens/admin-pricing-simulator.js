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
  return Number.isFinite(Number(value))
    ? `${new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(Number(value))} ₪`
    : '—';
}

function percent(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : '—';
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
    .admin-pricing-overlay {
      position: fixed;
      inset: 0;
      z-index: 10020;
      display: grid;
      place-items: center;
      box-sizing: border-box;
      padding: 18px;
      background: rgba(15, 23, 42, .28);
      backdrop-filter: blur(2px);
      overflow: hidden;
    }
    .admin-pricing-simulator {
      width:min(820px,calc(100vw - 36px));
      max-height: min(90vh, 820px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--color-border, #dbe3ec);
      border-radius: 16px;
      background: var(--color-surface, #fff);
      color: var(--color-text, #172033);
      box-shadow: 0 20px 54px rgba(15, 23, 42, .22);
    }
    .admin-pricing-simulator__header {
      flex: 0 0 auto;
      min-height: 54px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--color-border, #e2e8f0);
    }
    .admin-pricing-simulator__title { margin: 0; font-size: 18px; font-weight: 850; }
    .admin-pricing-simulator__subtitle { margin: 3px 0 0; color: var(--color-text-secondary, #64748b); font-size: 11px; }
    .admin-pricing-simulator__actions,
    .admin-pricing-simulator__groups-tools { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
    .admin-pricing-simulator__button,
    .admin-pricing-simulator__close {
      appearance: none;
      border: 1px solid var(--color-border, #dbe3ec);
      background: var(--color-surface, #fff);
      color: var(--color-text-secondary, #64748b);
      cursor: pointer;
      font: inherit;
    }
    .admin-pricing-simulator__button { min-height: 30px; padding: 4px 9px; border-radius: 8px; font-size: 11px; font-weight: 750; }
    .admin-pricing-simulator__close { width: 30px; height: 30px; display: grid; place-items: center; padding: 0; border-radius: 8px; font-size: 18px; }
    .admin-pricing-simulator__body {
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 9px;
      padding: 10px;
      overflow-y: auto;
      overflow-x:hidden;
    }
    .admin-pricing-simulator__section,
    .admin-pricing-simulator__summary {
      flex: 0 0 auto;
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 11px;
      background: var(--color-surface, #fff);
      overflow: hidden;
    }
    .admin-pricing-simulator__section-head,
    .admin-pricing-simulator__summary-head {
      min-height: 34px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 9px;
      padding: 6px 10px;
      border-bottom: 1px solid var(--color-border, #edf2f7);
      background: var(--color-surface-muted, #f8fafc);
    }
    .admin-pricing-simulator__section-head h3,
    .admin-pricing-simulator__summary-head strong { margin: 0; font-size: 12px; font-weight: 850; }
    .admin-pricing-simulator__section-head small,
    .admin-pricing-simulator__summary-progress { color: var(--color-text-secondary, #64748b); font-size: 10px; }
    .admin-pricing-simulator__wage-row {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr)) 116px;
      gap: 7px;
      align-items: end;
      padding: 9px;
    }
    .admin-pricing-simulator__field { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .admin-pricing-simulator__field label { color: var(--color-text-secondary, #475569); font-size: 10px; font-weight: 750; }
    .admin-pricing-simulator__field input,
    .admin-pricing-simulator__group-count {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      height: 30px;
      border: 1px solid var(--color-border, #cbd5e1);
      border-radius: 7px;
      padding: 4px 6px;
      background: var(--color-surface, #fff);
      color: var(--color-text, #172033);
      font: inherit;
      font-size: 11.5px;
      outline: none;
    }
    .admin-pricing-simulator__field input:focus,
    .admin-pricing-simulator__group-count:focus {
      border-color: var(--color-primary, #0ea5e9);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary, #0ea5e9) 13%, transparent);
    }
    .admin-pricing-simulator__wage-total {
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 5px;
      padding: 0 8px;
      border: 1px solid var(--color-border, #dbe3ec);
      border-radius: 7px;
      background: var(--color-surface-muted, #f8fafc);
      white-space: nowrap;
    }
    .admin-pricing-simulator__wage-total span { color: var(--color-text-secondary, #64748b); font-size: 9.5px; }
    .admin-pricing-simulator__wage-total strong { font-size: 13px; font-weight: 900; }
    .admin-pricing-simulator__constants {
      display: flex;
      flex-wrap: wrap;
      gap: 3px 12px;
      padding: 0 9px 8px;
      color: var(--color-text-secondary, #64748b);
      font-size: 9.5px;
    }
    .admin-pricing-simulator__constants strong { color: var(--color-text, #334155); font-weight: 850; }
    .admin-pricing-simulator__groups-section { min-height: 0; flex: 0 0 auto; display: flex; flex-direction: column; }
    .admin-pricing-simulator__count-wrap { display: inline-flex; align-items: center; gap: 5px; color: var(--color-text-secondary, #475569); font-size: 10px; font-weight: 750; }
    .admin-pricing-simulator__group-count { width: 58px; height: 28px; text-align: center; }
    .admin-pricing-simulator__groups-head,
    .admin-pricing-simulator__group-row {
      display: grid;
      grid-template-columns: 52px 80px 62px 80px 78px 78px 70px 58px 92px 26px;
      gap: 5px;
      align-items: center;
    }
    .admin-pricing-simulator__groups-head {
      padding: 5px 7px;
      color: var(--color-text-secondary, #64748b);
      font-size: 9px;
      font-weight: 800;
      border-bottom: 1px solid var(--color-border, #edf2f7);
      background: #fbfcfe;
      text-align: center;
    }
    .admin-pricing-simulator__groups-list {
      min-height: 0;
      max-height: 330px;
      overflow-y: auto;
      overflow-x:hidden;
      scrollbar-gutter: stable;
    }
    .admin-pricing-simulator__group-item { border-bottom: 1px solid var(--color-border, #edf2f7); }
    .admin-pricing-simulator__group-item:last-child { border-bottom: 0; }
    .admin-pricing-simulator__group-row { min-height: 46px; padding: 5px 7px; }
    .admin-pricing-simulator__group-name { font-size: 10.5px; font-weight: 850; white-space: nowrap; text-align: center; }
    .admin-pricing-simulator__group-row input {
      box-sizing: border-box;
      width: 100%;
      height: 29px;
      border: 1px solid var(--color-border, #cbd5e1);
      border-radius: 7px;
      padding: 3px 5px;
      background: var(--color-surface, #fff);
      color: var(--color-text, #172033);
      font: inherit;
      font-size: 11px;
      text-align: center;
      outline: none;
    }
    .admin-pricing-simulator__group-row input:focus { border-color: var(--color-primary, #0ea5e9); }
    .admin-pricing-simulator__result { min-width: 0; font-size: 10.5px; font-weight: 850; text-align: center; white-space: nowrap; }
    .admin-pricing-simulator__badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 21px;
      border-radius: 999px;
      padding: 2px 6px;
      font-size: 8.5px;
      font-weight: 850;
      line-height: 1.1;
      white-space: nowrap;
    }
    .admin-pricing-simulator__badge.is-approved { color: #166534; background: #dcfce7; border: 1px solid #bbf7d0; }
    .admin-pricing-simulator__badge.is-rejected { color: #991b1b; background: #fee2e2; border: 1px solid #fecaca; }
    .admin-pricing-simulator__badge.is-pending { color: #64748b; background: #f1f5f9; border: 1px solid #e2e8f0; }
    .admin-pricing-simulator__details-toggle {
      appearance: none;
      width: 26px;
      height: 26px;
      display: grid;
      place-items: center;
      border: 1px solid var(--color-border, #dbe3ec);
      border-radius: 7px;
      background: var(--color-surface, #fff);
      color: var(--color-text-secondary, #64748b);
      cursor: pointer;
      font-size: 13px;
      line-height: 1;
    }
    .admin-pricing-simulator__group-details {
      display: none;
      grid-template-columns: repeat(5, 1fr);
      gap: 6px;
      padding: 0 7px 7px;
      background: #fbfcfe;
    }
    .admin-pricing-simulator__group-item.is-open .admin-pricing-simulator__group-details { display: grid; }
    .admin-pricing-simulator__detail {
      padding: 5px 6px;
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 6px;
      background: var(--color-surface, #fff);
      font-size: 9px;
    }
    .admin-pricing-simulator__detail span { display: block; color: var(--color-text-secondary, #64748b); margin-bottom: 2px; }
    .admin-pricing-simulator__detail strong { font-size: 10px; font-weight: 850; }
    .admin-pricing-simulator__summary { flex: 0 0 auto; }
    .admin-pricing-simulator__summary-row {
      display: grid;
      grid-template-columns: repeat(5, 1fr) 122px;
      gap: 1px;
      background: var(--color-border, #edf2f7);
    }
    .admin-pricing-simulator__summary-item,
    .admin-pricing-simulator__summary-status { background: var(--color-surface, #fff); }
    .admin-pricing-simulator__summary-item { min-width: 0; padding: 6px 7px; }
    .admin-pricing-simulator__summary-item span { display: block; margin-bottom: 1px; color: var(--color-text-secondary, #64748b); font-size: 9px; }
    .admin-pricing-simulator__summary-item strong { font-size: 12px; font-weight: 900; white-space: nowrap; }
    .admin-pricing-simulator__summary-status { display: grid; place-items: center; padding: 5px; }
    @media (max-width: 760px) {
      .admin-pricing-overlay { padding: 8px; }
      .admin-pricing-simulator { width: calc(100vw - 16px); max-height: 92vh; }
      .admin-pricing-simulator__subtitle { display: none; }
      .admin-pricing-simulator__wage-row { grid-template-columns: repeat(2, 1fr); }
      .admin-pricing-simulator__wage-total { grid-column: 1 / -1; }
      .admin-pricing-simulator__groups-head { display: none; }
      .admin-pricing-simulator__groups-list { max-height: 44vh; }
      .admin-pricing-simulator__group-row { grid-template-columns: 52px repeat(2, 1fr); align-items: end; }
      .admin-pricing-simulator__group-row > *:nth-child(n+4) { grid-column: auto; }
      .admin-pricing-simulator__result { padding: 4px; border: 1px solid var(--color-border, #edf2f7); border-radius: 6px; }
      .admin-pricing-simulator__group-details { grid-template-columns: repeat(2, 1fr); }
      .admin-pricing-simulator__summary-row { grid-template-columns: repeat(2, 1fr); }
      .admin-pricing-simulator__summary-status { grid-column: 1 / -1; }
    }
  `;
  document.head.appendChild(style);
}

function groupRowsHtml(groups) {
  return groups.map((group, index) => `
    <div class="admin-pricing-simulator__group-item" data-pricing-group-row="${index}">
      <div class="admin-pricing-simulator__group-row">
        <div class="admin-pricing-simulator__group-name">${index + 1}</div>
        <input type="number" min="0" step="1" aria-label="עלות מדריך קבוצה ${index + 1}" data-group-input="instructorCharge" value="${group.instructorCharge}">
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
        <div class="admin-pricing-simulator__detail"><span>מחיר לתלמיד</span><strong>${ADMIN_PRICING_CONFIG.studentPrice} ₪</strong></div>
        <div class="admin-pricing-simulator__detail"><span>עמלה 10%</span><strong data-group-result="commission">—</strong></div>
        <div class="admin-pricing-simulator__detail"><span>שכר מדריך</span><strong data-group-result="instructorWage">—</strong></div>
        <div class="admin-pricing-simulator__detail"><span>עלות מקום</span><strong data-group-result="venueCost">—</strong></div>
        <div class="admin-pricing-simulator__detail"><span>סה״כ הוצאות</span><strong data-group-result="totalExpenses">—</strong></div>
      </div>
    </div>`).join('');
}

function setResult(row, name, text) {
  const element = row?.querySelector?.(`[data-group-result="${name}"]`);
  if (element) element.textContent = text;
}

export function openAdminPricingSimulator() {
  if (!isAdmin() || typeof document === 'undefined') return;

  const existing = document.querySelector('[data-admin-pricing-simulator-overlay]');
  if (existing) {
    existing.querySelector('[data-group-input="instructorCharge"]')?.focus();
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
        <section class="admin-pricing-simulator__section">
          <div class="admin-pricing-simulator__section-head">
            <h3>שכר מדריך</h3>
            <small>מחושב פעם אחת ומשמש בכל הקבוצות</small>
          </div>
          <div class="admin-pricing-simulator__wage-row">
            <div class="admin-pricing-simulator__field"><label>שעות</label><input type="number" min="0" step="0.25" data-wage-input="hours" value="${DEFAULT_WAGE_INPUTS.hours}"></div>
            <div class="admin-pricing-simulator__field"><label>מחיר לשעה</label><input type="number" min="0" step="1" data-wage-input="hourlyRate" value="${DEFAULT_WAGE_INPUTS.hourlyRate}"></div>
            <div class="admin-pricing-simulator__field"><label>מכפיל שכר</label><input type="number" min="0" step="0.1" data-wage-input="wageMultiplier" value="${DEFAULT_WAGE_INPUTS.wageMultiplier}"></div>
            <div class="admin-pricing-simulator__field"><label>ק״מ</label><input type="number" min="0" step="1" data-wage-input="kilometers" value="${DEFAULT_WAGE_INPUTS.kilometers}"></div>
            <div class="admin-pricing-simulator__field"><label>מכפיל ק״מ</label><input type="number" min="0" step="0.1" data-wage-input="kilometerMultiplier" value="${DEFAULT_WAGE_INPUTS.kilometerMultiplier}"></div>
            <div class="admin-pricing-simulator__wage-total"><span>שכר מחושב</span><strong data-pricing-wage-total>—</strong></div>
          </div>
          <div class="admin-pricing-simulator__constants">
            <span>מחיר לתלמיד: <strong>${ADMIN_PRICING_CONFIG.studentPrice} ₪</strong></span>
            <span>עמלה: <strong>${ADMIN_PRICING_CONFIG.commissionRate * 100}%</strong></span>
            <span>יעד רווחיות: <strong>${ADMIN_PRICING_CONFIG.targetMargin * 100}%</strong></span>
            <span>עלות מקום: <strong>${ADMIN_PRICING_CONFIG.venueCost} ₪</strong></span>
          </div>
        </section>

        <section class="admin-pricing-simulator__section admin-pricing-simulator__groups-section">
          <div class="admin-pricing-simulator__section-head">
            <h3>קבוצות</h3>
            <div class="admin-pricing-simulator__groups-tools">
              <label class="admin-pricing-simulator__count-wrap">מספר קבוצות
                <input class="admin-pricing-simulator__group-count" type="number" min="1" max="${MAX_GROUPS}" step="1" value="1" data-pricing-group-count>
              </label>
              <button type="button" class="admin-pricing-simulator__button" data-pricing-copy-first hidden>העתק קבוצה 1 לכולן</button>
            </div>
          </div>
          <div class="admin-pricing-simulator__groups-head" aria-hidden="true">
            <span>קבוצה</span><span>עלות מדריך</span><span>תלמידים</span><span>הסעה</span><span>מחיר סופי</span><span>מינימום</span><span>רווח</span><span>רווחיות</span><span>סטטוס</span><span></span>
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
    </section>`;

  document.body.appendChild(overlay);

  const groupsBody = overlay.querySelector('[data-pricing-groups-body]');
  const groupCountInput = overlay.querySelector('[data-pricing-group-count]');
  const copyFirstButton = overlay.querySelector('[data-pricing-copy-first]');
  const wageTotal = overlay.querySelector('[data-pricing-wage-total]');
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

  const renderSummaryValue = (name, value) => {
    const element = overlay.querySelector(`[data-pricing-summary="${name}"]`);
    if (element) element.textContent = name === 'margin' ? percent(value) : money(value);
  };

  const renderCalculations = () => {
    const wageInputs = readWageInputs();
    const wageComplete = wageInputsComplete(wageInputs);
    const instructorWage = wageComplete ? calculateInstructorWage(wageInputs) : 0;
    wageTotal.textContent = wageComplete ? money(instructorWage) : '—';

    const completedResults = [];
    groups.forEach((group, index) => {
      const row = groupsBody.querySelector(`[data-pricing-group-row="${index}"]`);
      if (!row) return;
      const complete = wageComplete && groupComplete(group);
      const names = ['finalPrice', 'minimumPrice', 'profit', 'margin', 'commission', 'instructorWage', 'venueCost', 'totalExpenses'];

      if (!complete) {
        names.forEach((name) => setResult(row, name, '—'));
        const status = row.querySelector('[data-group-result="status"]');
        if (status) status.innerHTML = '<span class="admin-pricing-simulator__badge is-pending">חסרים נתונים</span>';
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
      setResult(row, 'profit', money(result.profit));
      setResult(row, 'margin', percent(result.margin));
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
      summaryStatus.innerHTML = `<span class="admin-pricing-simulator__badge is-pending">${wageComplete ? 'יש להשלים נתונים' : 'יש להשלים שכר מדריך'}</span>`;
      return;
    }

    const school = calculateSchoolPricing(completedResults);
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

  overlay.querySelectorAll('[data-wage-input]').forEach((input) => input.addEventListener('input', renderCalculations));

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

  copyFirstButton.addEventListener('click', () => {
    const source = { ...groups[0] };
    groups = groups.map((group, index) => index === 0 ? group : { ...source });
    renderGroups();
  });

  const resetSimulator = () => {
    Object.entries(DEFAULT_WAGE_INPUTS).forEach(([key, value]) => {
      const input = overlay.querySelector(`[data-wage-input="${key}"]`);
      if (input) input.value = value;
    });
    groups = [blankGroup()];
    groupCountInput.value = '1';
    renderGroups();
    groupsBody.querySelector('[data-group-input="instructorCharge"]')?.focus();
  };

  const close = () => overlay.remove();
  overlay.querySelector('[data-pricing-close]')?.addEventListener('click', close);
  overlay.querySelector('[data-pricing-reset]')?.addEventListener('click', resetSimulator);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });

  renderGroups();
  groupsBody.querySelector('[data-group-input="instructorCharge"]')?.focus();
}
