import { escapeHtml } from './shared/html.js';

export const EMPLOYEE_FILE_COMPONENTS = [
  ['signed_agreement', 'הסכם חתום'],
  ['supporting_documents', 'מסמכים נלווים'],
  ['intro_feedback', 'משוב היכרות'],
  ['midyear_feedback', 'משוב אמצע שנה'],
  ['year_end_feedback', 'משוב סוף שנה'],
  ['observation_1', 'תצפית 1'],
  ['observation_2', 'תצפית 2'],
  ['payroll_reports', 'דוחות שכר']
];

const DOCUMENT_GROUPS = [
  { className: 'employee-file__group--agreements', keys: ['signed_agreement', 'supporting_documents'] },
  { className: 'employee-file__group--feedback', keys: ['intro_feedback', 'midyear_feedback', 'year_end_feedback'] },
  { className: 'employee-file__group--observations', keys: ['observation_1', 'observation_2'] }
];

function documentCard(key, label, item = {}) {
  const completed = item.completed === true || Number(item.item_count) > 0;
  return `<div class="employee-file__item employee-file__item--${escapeHtml(key)}">
    <div class="employee-file__label">${escapeHtml(label)}</div>
    <div class="employee-file__card${completed ? ' is-completed' : ' is-missing'}" aria-label="${escapeHtml(label)}: ${completed ? 'קיים מסמך' : 'אין מסמך'}"><span aria-hidden="true">${completed ? '✓' : ''}</span></div>
  </div>`;
}

export function employeeFileModalHtml(payload = {}) {
  const byKey = new Map((payload.components || []).map((item) => [item.component_key, item]));
  const labels = new Map(EMPLOYEE_FILE_COMPONENTS);
  const groups = DOCUMENT_GROUPS.map(({ className, keys }) => `<div class="employee-file__group ${className}">${keys.map((key) => documentCard(key, labels.get(key), byKey.get(key))).join('')}</div>`).join('');
  const payrollCount = Math.min(12, Math.max(0, Number(byKey.get('payroll_reports')?.item_count) || 0));
  const payrollCells = Array.from({ length: 12 }, (_, index) => `<span class="employee-file__payroll-cell ${index < payrollCount ? 'is-completed' : 'is-missing'}" aria-hidden="true">${index < payrollCount ? '✓' : ''}</span>`).join('');

  const linkAction = payload.folder_web_url
    ? `<a class="ds-btn employee-file__open" href="${escapeHtml(payload.folder_web_url)}" target="_blank" rel="noopener noreferrer">פתח תיק עובד</a>`
    : '<span class="employee-file__link-note">קישור לתיק טרם הוגדר</span>';

  const adminEditor = payload.can_edit_folder_url === true
    ? `<details class="employee-file__admin-link"><summary>ניהול הקישור</summary><div class="employee-file__link-editor"><input class="ds-input" type="url" data-employee-file-folder-url value="${escapeHtml(payload.folder_web_url || '')}" dir="ltr" aria-label="קישור לתיק ב־SharePoint"><button type="button" class="ds-btn ds-btn--sm" data-employee-file-save-url>שמירה</button></div></details>`
    : '';

  return `<div class="employee-file" dir="rtl">
    <style>
      .ds-modal.ds-modal--employee-file{inset:auto;left:50%;bottom:auto;top:50%;width:fit-content;min-width:min(304px,calc(100vw - 24px));max-width:min(430px,calc(100vw - 24px));max-height:calc(100vh - 24px);transform:translate(-50%,calc(-50% + 16px));opacity:0;border:1px solid #c8d1dc;border-radius:14px;background:#fff;box-shadow:0 20px 46px rgba(31,42,55,.20);overflow:hidden}
      .ds-ui-layer.is-modal-open .ds-modal.ds-modal--employee-file{transform:translate(-50%,-50%);opacity:1}
      .ds-modal--employee-file .ds-modal__header{padding:9px 14px;border-bottom:1px solid #e2e7ed;background:#fff}
      .ds-modal--employee-file .ds-modal__title{font-size:.9rem;color:#26384d;font-weight:750}
      .ds-modal--employee-file .ds-modal__content{width:fit-content;max-width:100%;padding:14px 18px 12px;overflow:visible;box-sizing:border-box}
      .ds-modal--employee-file .ds-modal__footer{display:none}
      .employee-file{display:grid;gap:12px;width:fit-content;max-width:100%;min-width:0;box-sizing:border-box;color:#26313d}
      .employee-file__group{display:grid;justify-content:center;gap:14px;width:fit-content;max-width:100%;margin-inline:auto}
      .employee-file__group--agreements,.employee-file__group--observations{grid-template-columns:repeat(2,104px)}
      .employee-file__group--feedback{grid-template-columns:repeat(3,104px)}
      .employee-file__item{display:grid;gap:4px;min-width:0;text-align:center}
      .employee-file__label{font-size:.74rem;font-weight:650;line-height:1.2;white-space:nowrap;color:#344152}
      .employee-file__card{position:relative;display:grid;place-items:center;height:42px;box-sizing:border-box;border:1px solid #c8d1dc;border-radius:8px;background:linear-gradient(180deg,#fff 0%,#f7f9fb 100%);box-shadow:0 2px 7px rgba(31,42,55,.08),inset 0 1px 0 rgba(255,255,255,.85)}
      .employee-file__card.is-missing::after{content:'';position:absolute;top:6px;inset-inline-end:6px;width:7px;height:7px;border-radius:50%;background:#d94b57;box-shadow:0 0 0 2px #fff}
      .employee-file__card.is-completed span{color:#28705b;font-size:1rem;font-weight:800;line-height:1}
      .employee-file .employee-file__payroll{display:block;width:340px;max-width:100%;min-width:0;margin-inline:auto;border:1px solid #c8d1dc;border-radius:8px;overflow:hidden;box-sizing:border-box;background:#fff;box-shadow:0 2px 7px rgba(31,42,55,.06)}
      .employee-file__payroll-title{width:100%;box-sizing:border-box;padding:5px 7px;text-align:center;font-size:.76rem;font-weight:650;color:#465568;background:#f5f7f9;border-bottom:1px solid #d9e0e7}
      .employee-file__payroll-grid{display:grid;width:100%;min-width:0;grid-template-columns:repeat(6,minmax(0,1fr));direction:rtl}
      .employee-file__payroll-cell{display:grid;place-items:center;min-width:0;height:24px;box-sizing:border-box;border-top:1px solid #e0e5ea;border-inline-start:1px solid #e0e5ea;background:#fbfcfd;color:#28705b;font-size:.72rem;font-weight:800}
      .employee-file__payroll-cell:nth-child(-n+6){border-top:0}
      .employee-file__payroll-cell:nth-child(6n+1){border-inline-start:0}
      .employee-file__payroll-cell.is-missing{background:#fbfcfd;color:transparent}
      .employee-file__actions{display:grid;justify-items:center;gap:4px;margin-top:1px}
      .employee-file__open{width:max-content;min-height:30px;padding:4px 12px;border:1px solid #294d73;border-radius:8px;background:#294d73;color:#fff;font-size:.74rem;font-weight:750;box-shadow:0 2px 5px rgba(31,42,55,.10)}
      .employee-file__open:hover{background:#213f60;color:#fff}
      .employee-file__link-note{font-size:.75rem;color:#75808c}
      .employee-file__admin-link{width:min(340px,100%);text-align:center}
      .employee-file__admin-link>summary{margin-inline:auto;width:max-content;cursor:pointer;color:#778597;font-size:.66rem;font-weight:500}
      .employee-file__link-editor{display:flex;align-items:center;gap:6px;margin-top:5px}
      .employee-file__link-editor .ds-input{flex:1;min-width:0}
      .employee-file__status{min-height:9px;margin:0;text-align:center;font-size:.64rem;color:#65717d}
      @media(max-width:390px){.ds-modal.ds-modal--employee-file{min-width:0}.ds-modal--employee-file .ds-modal__content{padding:11px 10px 9px}.employee-file{gap:10px}.employee-file__group{gap:8px}.employee-file__group--agreements,.employee-file__group--observations{grid-template-columns:repeat(2,minmax(0,96px))}.employee-file__group--feedback{grid-template-columns:repeat(2,minmax(0,96px))}.employee-file__group--feedback .employee-file__item:last-child{grid-column:1/-1;width:96px;justify-self:center}.employee-file__label{font-size:.68rem}.employee-file .employee-file__payroll{width:300px}}
    </style>
    ${groups}
    <section class="employee-file__payroll" aria-label="דוחות שכר: ${payrollCount} מתוך 12"><div class="employee-file__payroll-title">דוחות שכר</div><div class="employee-file__payroll-grid">${payrollCells}</div></section>
    <div class="employee-file__actions"><div data-employee-file-link-action>${linkAction}</div>${adminEditor}</div>
    <p class="employee-file__status" data-employee-file-status role="status"></p>
  </div>`;
}
