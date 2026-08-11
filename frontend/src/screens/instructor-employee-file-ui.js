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
    <div class="employee-file__card" aria-label="${escapeHtml(label)}: ${completed ? 'קיים מסמך' : 'אין מסמך'}">${completed ? '<span class="employee-file__check" aria-hidden="true">✓</span>' : ''}</div>
  </div>`;
}

export function employeeFileModalHtml(payload = {}) {
  const byKey = new Map((payload.components || []).map((item) => [item.component_key, item]));
  const labels = new Map(EMPLOYEE_FILE_COMPONENTS);
  const groups = DOCUMENT_GROUPS.map(({ className, keys }) => `<div class="employee-file__group ${className}">${keys.map((key) => documentCard(key, labels.get(key), byKey.get(key))).join('')}</div>`).join('');
  const payrollCount = Math.min(12, Math.max(0, Number(byKey.get('payroll_reports')?.item_count) || 0));
  const payrollCells = Array.from({ length: 12 }, (_, index) => `<span class="employee-file__payroll-cell${index < payrollCount ? ' is-completed' : ''}" aria-hidden="true">${index < payrollCount ? '✓' : ''}</span>`).join('');

  const linkAction = payload.folder_web_url
    ? `<a class="ds-btn employee-file__open" href="${escapeHtml(payload.folder_web_url)}" target="_blank" rel="noopener noreferrer">פתח תיק עובד</a>`
    : '<span class="employee-file__link-note">קישור לתיק טרם הוגדר</span>';

  const adminEditor = payload.can_edit_folder_url === true
    ? `<details class="employee-file__admin-link"><summary>ניהול הקישור</summary><div class="employee-file__link-editor"><input class="ds-input" type="url" data-employee-file-folder-url value="${escapeHtml(payload.folder_web_url || '')}" dir="ltr" aria-label="קישור לתיק ב־SharePoint"><button type="button" class="ds-btn ds-btn--sm" data-employee-file-save-url>שמירה</button></div></details>`
    : '';

  return `<div class="employee-file" dir="rtl">
    <style>
      .ds-modal.ds-modal--employee-file{inset:auto;left:50%;bottom:auto;top:50%;width:min(410px,calc(100vw - 20px));max-height:calc(100vh - 20px);transform:translate(-50%,calc(-50% + 16px));opacity:0;border:1.5px solid #17478b;border-radius:12px;background:#fdfdfd;overflow:hidden}
      .ds-ui-layer.is-modal-open .ds-modal.ds-modal--employee-file{transform:translate(-50%,-50%);opacity:1}
      .ds-modal--employee-file .ds-modal__header{padding:6px 11px;border-bottom:1px solid #dce4ee}
      .ds-modal--employee-file .ds-modal__title{font-size:.82rem;color:#17365d}
      .ds-modal--employee-file .ds-modal__content{padding:8px 12px 7px;overflow:visible}
      .ds-modal--employee-file .ds-modal__footer{display:none}
      .employee-file{display:grid;gap:7px;width:100%;min-width:0;box-sizing:border-box;color:#202a35}
      .employee-file__group{display:grid;justify-content:center;gap:8px}
      .employee-file__group--agreements,.employee-file__group--observations{grid-template-columns:repeat(2,84px)}
      .employee-file__group--feedback{grid-template-columns:repeat(3,84px)}
      .employee-file__item{display:grid;gap:2px;min-width:0;text-align:center}
      .employee-file__label{font-size:.68rem;font-weight:600;line-height:1.15;white-space:nowrap}
      .employee-file__card{display:grid;place-items:center;height:31px;box-sizing:border-box;border:2px solid;border-radius:4px;background:#fff}
      .employee-file__group--agreements .employee-file__card{border-color:#e91e63}
      .employee-file__group--feedback .employee-file__card{border-color:#628fc8;background:#f5f9fc}
      .employee-file__group--observations .employee-file__card{border-color:#ffe2a9;background:#fffdfa}
      .employee-file__check{color:#24705d;font-size:1rem;font-weight:800;line-height:1}
      .employee-file .employee-file__payroll{display:block;width:min(300px,100%);min-width:0;margin-inline:auto;border:2px solid #628fc8;border-radius:5px;overflow:hidden;box-sizing:border-box}
      .employee-file__payroll-title{width:100%;box-sizing:border-box;padding:3px;text-align:center;font-size:.72rem;font-weight:600;background:#fff}
      .employee-file__payroll-grid{display:grid;width:100%;min-width:0;grid-template-columns:repeat(6,minmax(0,1fr));direction:rtl}
      .employee-file__payroll-cell{display:grid;place-items:center;min-width:0;height:20px;box-sizing:border-box;border-top:1px solid #628fc8;border-inline-start:1px solid #628fc8;background:#f5f9fc;color:#24705d;font-size:.7rem;font-weight:800}
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
      @media(max-width:360px){.ds-modal--employee-file .ds-modal__content{padding-inline:7px}.employee-file__group{gap:5px}.employee-file__group--agreements,.employee-file__group--observations{grid-template-columns:repeat(2,78px)}.employee-file__group--feedback{grid-template-columns:repeat(3,78px)}}
    </style>
    ${groups}
    <section class="employee-file__payroll" aria-label="דוחות שכר: ${payrollCount} מתוך 12"><div class="employee-file__payroll-title">דוחות שכר</div><div class="employee-file__payroll-grid">${payrollCells}</div></section>
    <div class="employee-file__actions"><div data-employee-file-link-action>${linkAction}</div>${adminEditor}</div>
    <p class="employee-file__status" data-employee-file-status role="status"></p>
  </div>`;
}
