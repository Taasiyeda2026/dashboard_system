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

function completionIndicator(completed) {
  return `<span class="employee-file__presence employee-file__presence--${completed ? 'completed' : 'empty'}" aria-label="${completed ? 'קיים מסמך' : 'אין מסמך'}">${completed ? '✓' : ''}</span>`;
}

export function employeeFileModalHtml(payload = {}) {
  const byKey = new Map((payload.components || []).map((item) => [item.component_key, item]));
  const rows = EMPLOYEE_FILE_COMPONENTS.map(([key, label]) => {
    const item = byKey.get(key) || {};
    if (key === 'payroll_reports') {
      const count = Math.max(0, Number(item.item_count) || 0);
      return `<li class="employee-file__row"><span class="employee-file__doc" aria-hidden="true">📄</span><span class="employee-file__label">${escapeHtml(label)}</span><span class="employee-file__count" aria-label="${count} דוחות">${count}</span></li>`;
    }
    return `<li class="employee-file__row">${completionIndicator(item.completed === true)}<span class="employee-file__label">${escapeHtml(label)}</span></li>`;
  }).join('');

  const linkAction = payload.folder_web_url
    ? `<a class="ds-btn ds-btn--primary employee-file__open" href="${escapeHtml(payload.folder_web_url)}" target="_blank" rel="noopener noreferrer">פתח תיק עובד ב־SharePoint</a>`
    : '<span class="employee-file__link-note">קישור לתיק טרם הוגדר</span>';

  const adminEditor = payload.can_edit_folder_url === true
    ? `<details class="employee-file__admin-link"><summary>ניהול קישור</summary><div class="employee-file__link-editor"><input class="ds-input" type="url" data-employee-file-folder-url value="${escapeHtml(payload.folder_web_url || '')}" dir="ltr" aria-label="קישור לתיק ב־SharePoint"><button type="button" class="ds-btn ds-btn--sm" data-employee-file-save-url>שמירה</button></div></details>`
    : '';

  return `<div class="employee-file employee-file--compact" dir="rtl">
    <style>
      .employee-file--compact{display:grid;gap:14px;min-width:min(360px,78vw);max-width:430px}
      .employee-file--compact .employee-file__list{display:grid;gap:0;margin:0;padding:0;list-style:none;border:1px solid #e3e8ed;border-radius:12px;overflow:hidden;background:#fff}
      .employee-file--compact .employee-file__row{display:flex;align-items:center;justify-content:flex-start;gap:10px;min-height:42px;padding:8px 12px;border-bottom:1px solid #edf1f4;font-size:.9rem;color:#273444}
      .employee-file--compact .employee-file__row:last-child{border-bottom:0}
      .employee-file--compact .employee-file__presence{flex:0 0 22px;width:22px;height:22px;display:grid;place-items:center;border-radius:50%;box-sizing:border-box;font-size:.78rem;font-weight:800}
      .employee-file--compact .employee-file__presence--completed{border:0;background:#e8f4ef;color:#28715c}
      .employee-file--compact .employee-file__presence--empty{border:1.5px solid #b8c1ca;background:#fff;color:transparent}
      .employee-file--compact .employee-file__label{font-weight:600;line-height:1.25}
      .employee-file--compact .employee-file__doc{flex:0 0 22px;width:22px;text-align:center;font-size:1rem;line-height:1}
      .employee-file--compact .employee-file__count{display:inline-grid;place-items:center;min-width:25px;height:23px;padding:0 6px;border-radius:999px;background:#f0f3f6;color:#536170;font-size:.78rem;font-weight:700}
      .employee-file--compact [data-employee-file-link-action]{display:flex;justify-content:flex-start}
      .employee-file--compact .employee-file__open{width:100%;justify-content:center}
      .employee-file--compact .employee-file__link-note{font-size:.82rem;color:#7a8693}
      .employee-file--compact .employee-file__admin-link{border-top:1px solid #edf0f3;padding-top:8px}
      .employee-file--compact .employee-file__admin-link>summary{cursor:pointer;width:max-content;color:#6b7682;font-size:.78rem;font-weight:600}
      .employee-file--compact .employee-file__link-editor{display:flex;align-items:center;gap:7px;margin-top:8px}
      .employee-file--compact .employee-file__link-editor .ds-input{flex:1;min-width:0}
      .employee-file--compact .employee-file__status{min-height:16px;margin:0;font-size:.76rem;color:#65717d}
    </style>
    <ul class="employee-file__list">${rows}</ul>
    <div data-employee-file-link-action>${linkAction}</div>
    ${adminEditor}
    <p class="employee-file__status" data-employee-file-status role="status"></p>
  </div>`;
}
