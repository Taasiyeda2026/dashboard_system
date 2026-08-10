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

function presenceIcon(present) {
  return present
    ? '<span class="employee-file__presence employee-file__presence--present" aria-label="נמצא מסמך">✓</span>'
    : '<span class="employee-file__presence employee-file__presence--empty" aria-label="טרם נמצא מסמך"></span>';
}

export function employeeFileModalHtml(payload = {}) {
  const byKey = new Map((payload.components || []).map((item) => [item.component_key, item]));
  const rows = EMPLOYEE_FILE_COMPONENTS.map(([key, label]) => {
    const item = byKey.get(key) || {};
    const indicator = key === 'payroll_reports'
      ? `<span class="employee-file__payroll" aria-label="מספר דוחות שכר"><span aria-hidden="true">📄</span><b>${Math.max(0, Number(item.item_count) || 0)}</b></span>`
      : presenceIcon(item.present === true);
    return `<li class="employee-file__row"><span>${escapeHtml(label)}</span>${indicator}</li>`;
  }).join('');
  const link = payload.mapped && payload.folder_web_url
    ? `<a class="ds-btn ds-btn--primary employee-file__open" href="${escapeHtml(payload.folder_web_url)}" target="_blank" rel="noopener noreferrer">פתח תיק עובד ב־SharePoint</a>`
    : '';
  return `<div class="employee-file" dir="rtl"><ul class="employee-file__list">${rows}</ul>${link}</div>`;
}
