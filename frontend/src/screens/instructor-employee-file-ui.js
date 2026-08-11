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
      .ds-modal.ds-modal--employee-file{inset:auto;left:50%;bottom:auto;top:50%;width:fit-content;min-width:min(304px,calc(100vw - 20px));max-width:calc(100vw - 20px);max-height:calc(100vh - 20px);transform:translate(-50%,calc(-50% + 16px));opacity:0;border:1px solid #b8c8dc;border-radius:10px;background:#fdfdfd;overflow:hidden}
      .ds-ui-layer.is-modal-open .ds-modal.ds-modal--employee-file{transform:translate(-50%,-50%);opacity:1}
      .ds-modal--employee-file .ds-modal__header{padding:6px 11px;border-bottom:1px solid #dce4ee}
      .ds-modal--employee-file .ds-modal__title{font-size:.82rem;color:#17365d}
      .ds-modal--employee-file .ds-modal__content{width:fit-content;max-width:100%;padding:7px 10px 6px;overflow:visible;box-sizing:border-box}
      .ds-modal--employee-file .ds-modal__footer{display:none}
      .employee-file{display:grid;gap:6px;width:fit-content;max-width:100%;min-width:0;box-sizing:border-box;color:#202a35}
      .employee-file__group{display:flex;justify-content:center;gap:12px;width:fit-content;max-width:100%;margin-inline:auto}
      .employee-file__item{display:flex;align-items:center;justify-content:center;gap:5px;min-width:0;text-align:center}
      .employee-file__label{font-size:.68rem;font-weight:600;line-height:1.15;white-space:nowrap}
      .employee-file__card{display:grid;place-items:center;flex:0 0 12px;width:12px;height:12px;box-sizing:border-box;border:0;border-radius:50%;background:transparent}
      .employee-file__card.is-missing,.employee-file__payroll-cell.is-missing{background:#d94b57;box-shadow:0 0 0 2px #fff inset}
      .employee-file__card.is-completed{color:#24705d;font-size:.72rem;font-weight:800;line-height:1}
      .employee-file .employee-file__payroll{display:block;width:280px;max-width:100%;min-width:0;margin-inline:auto;border:1px solid #9bb5d5;border-radius:5px;overflow:hidden;box-sizing:border-box}
      .employee-file__payroll-title{width:100%;box-sizing:border-box;padding:3px;text-align:center;font-size:.72rem;font-weight:600;background:#fff}
      .employee-file__payroll-grid{display:grid;width:100%;min-width:0;grid-template-columns:repeat(6,minmax(0,1fr));direction:rtl}
      .employee-file__payroll-cell{display:grid;place-items:center;min-width:0;height:18px;box-sizing:border-box;border-top:1px solid #b6c9df;border-inline-start:1px solid #b6c9df;background:#f8fafc;color:#24705d;font-size:.66rem;font-weight:800}
      .employee-file__payroll-cell.is-missing{width:8px;height:8px;min-width:8px;align-self:center;justify-self:center;border:0;border-radius:50%}
      .employee-file__payroll-cell:nth-child(6n+1){border-inline-start:0}
      .employee-file__actions{display:grid;justify-items:center;gap:3px}
      .employee-file__open{width:max-content;min-height:25px;padding:3px 9px;border:2px solid #17478b;border-radius:8px;background:#fff;color:#e91e63;font-size:.7rem;font-weight:800}
      .employee-file__open:hover{background:#f7f9fc;color:#d81758}
      .employee-file__link-note{font-size:.8rem;color:#75808c}
      .employee-file__admin-link{width:min(360px,100%);text-align:center}
      .employee-file__admin-link>summary{margin-inline:auto;width:max-content;cursor:pointer;color:#7c8ca4;font-size:.62rem;font-weight:500}
      .employee-file__link-editor{display:flex;align-items:center;gap:5px;margin-top:4px}
      .employee-file__link-editor .ds-input{flex:1;min-width:0}
      .employee-file__status{min-height:8px;margin:0;text-align:center;font-size:.62rem;color:#65717d}
      @media(max-width:360px){.ds-modal.ds-modal--employee-file{min-width:0}.ds-modal--employee-file .ds-modal__content{padding-inline:7px}.employee-file__group{gap:7px}.employee-file__label{font-size:.64rem}.employee-file .employee-file__payroll{width:260px}}
    </style>
    ${groups}
    <section class="employee-file__payroll" aria-label="דוחות שכר: ${payrollCount} מתוך 12"><div class="employee-file__payroll-title">דוחות שכר</div><div class="employee-file__payroll-grid">${payrollCells}</div></section>
    <div class="employee-file__actions"><div data-employee-file-link-action>${linkAction}</div>${adminEditor}</div>
    <p class="employee-file__status" data-employee-file-status role="status"></p>
  </div>`;
}
