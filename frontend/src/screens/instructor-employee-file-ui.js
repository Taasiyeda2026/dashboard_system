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

function completionButton(key, completed) {
  const state = completed ? 'true' : 'false';
  return `<button type="button" class="employee-file__presence employee-file__presence--${completed ? 'completed' : 'empty'}" data-employee-file-toggle="${escapeHtml(key)}" aria-pressed="${state}" aria-label="שינוי מצב">${completed ? '✓' : ''}</button>`;
}

export function employeeFileModalHtml(payload = {}) {
  const byKey = new Map((payload.components || []).map((item) => [item.component_key, item]));
  const rows = EMPLOYEE_FILE_COMPONENTS.map(([key, label]) => {
    const item = byKey.get(key) || {};
    const indicator = key === 'payroll_reports'
      ? `<span class="employee-file__payroll" aria-label="מספר דוחות שכר"><button type="button" data-employee-file-payroll="decrement" aria-label="הפחתת דוח">−</button><span aria-hidden="true">📄</span><b data-employee-file-payroll-count>${Math.max(0, Number(item.item_count) || 0)}</b><button type="button" data-employee-file-payroll="increment" aria-label="הוספת דוח">+</button></span>`
      : completionButton(key, item.completed === true);
    return `<li class="employee-file__row"><span>${escapeHtml(label)}</span>${indicator}</li>`;
  }).join('');
  const link = payload.folder_web_url
    ? `<a class="ds-btn ds-btn--primary employee-file__open" href="${escapeHtml(payload.folder_web_url)}" target="_blank" rel="noopener noreferrer">פתח תיק עובד ב־SharePoint</a>`
    : '<span class="employee-file__link-note">קישור התיק טרם הוגדר</span>';
  return `<div class="employee-file" dir="rtl"><ul class="employee-file__list">${rows}</ul><div class="employee-file__link-editor"><label><span>קישור לתיק ב־SharePoint</span><input class="ds-input" type="url" data-employee-file-folder-url value="${escapeHtml(payload.folder_web_url || '')}" dir="ltr"></label><button type="button" class="ds-btn ds-btn--sm" data-employee-file-save-url>שמירה</button></div><div data-employee-file-link-action>${link}</div><p class="employee-file__status" data-employee-file-status role="status"></p></div>`;
}
