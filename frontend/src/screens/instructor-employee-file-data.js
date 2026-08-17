import { supabase } from '../supabase-client.js';

const EMPLOYEE_FILE_COMPONENT_KEYS = [
  'signed_agreement',
  'supporting_documents',
  'intro_feedback',
  'midyear_feedback',
  'year_end_feedback',
  'observation_1',
  'observation_2',
  'payroll_reports'
];

function openEmployeeFileRoot(empId) {
  if (typeof document === 'undefined') return null;
  const numericEmpId = Number(empId);
  if (!Number.isSafeInteger(numericEmpId) || numericEmpId <= 0) return null;
  return document.querySelector(`.ds-modal.ds-modal--employee-file .employee-file[data-employee-file-emp-id="${numericEmpId}"]`);
}

export function applyEmployeeFileSnapshotToOpenModal(empId, payload = {}) {
  const root = openEmployeeFileRoot(empId);
  if (!root) return false;
  const byKey = new Map((payload.components || []).map((item) => [String(item?.component_key || ''), item]));

  for (const key of EMPLOYEE_FILE_COMPONENT_KEYS.filter((item) => item !== 'payroll_reports')) {
    const item = byKey.get(key) || {};
    const completed = item.completed === true || Number(item.item_count) > 0;
    const card = root.querySelector(`.employee-file__item--${key} .employee-file__card`);
    if (!card) continue;
    card.classList.toggle('is-completed', completed);
    card.classList.toggle('is-missing', !completed);
    const mark = card.querySelector('span');
    if (mark) mark.textContent = completed ? '✓' : '';
    const label = root.querySelector(`.employee-file__item--${key} .employee-file__label`)?.textContent?.trim() || key;
    card.setAttribute('aria-label', `${label}: ${completed ? 'קיים מסמך' : 'אין מסמך'}`);
  }

  const payrollCount = Math.min(12, Math.max(0, Number(byKey.get('payroll_reports')?.item_count) || 0));
  const payroll = root.querySelector('.employee-file__payroll');
  payroll?.setAttribute('aria-label', `דוחות שכר: ${payrollCount} מתוך 12`);
  root.querySelectorAll('.employee-file__payroll-cell').forEach((cell, index) => {
    const completed = index < payrollCount;
    cell.classList.toggle('is-completed', completed);
    cell.classList.toggle('is-missing', !completed);
    const mark = cell.querySelector('.employee-file__payroll-mark');
    if (mark) mark.textContent = completed ? '✓' : '';
  });

  const status = root.querySelector('[data-employee-file-status]');
  if (status) status.textContent = 'עודכן מ-SharePoint';
  return true;
}

function scheduleEmployeeFileRefresh(empId, schoolYear) {
  if (typeof setTimeout !== 'function') return;
  setTimeout(() => {
    refreshInstructorEmployeeFileSnapshot(empId, schoolYear)
      .then((fresh) => applyEmployeeFileSnapshotToOpenModal(empId, fresh || {}))
      .catch((error) => {
        const root = openEmployeeFileRoot(empId);
        const status = root?.querySelector('[data-employee-file-status]');
        if (status) status.textContent = 'לא ניתן לרענן כעת מ-SharePoint';
        globalThis.console?.error?.('[employee-file] automatic SharePoint refresh failed', error);
      });
  }, 0);
}

export async function loadInstructorEmployeeFile(api, empId, schoolYear = '2027') {
  if (!api || typeof api.instructorEmployeeFile !== 'function') throw new Error('employee_file_api_unavailable');
  const payload = await api.instructorEmployeeFile({ empId, schoolYear });
  const normalized = payload && typeof payload === 'object'
    ? { ...payload, emp_id: Number(payload.emp_id || empId) }
    : { mapped: false, components: [], emp_id: Number(empId) };
  scheduleEmployeeFileRefresh(empId, schoolYear);
  return normalized;
}

export async function refreshInstructorEmployeeFileSnapshot(empId, schoolYear = '2027') {
  const { data, error } = await supabase.functions.invoke('instructor-employee-file-live', {
    body: { empId, schoolYear, refresh: true }
  });
  if (error) throw new Error(error.message || 'employee_file_snapshot_refresh_failed');
  if (data?.error) throw new Error(data.error);
  return data;
}

// Kept as a compatibility shim for existing callers. Refreshing is now tied to
// opening the employee file itself, so returning from SharePoint must not start
// a second scan.
export function createEmployeeFileSharePointReturnSync() {
  return {
    markSharePointOpened() {},
    destroy() {}
  };
}

export async function refreshAfterEmployeeFileMutation(mutation, refresh) {
  const saved = await mutation();
  if (saved?.changed !== false) await refresh();
  return saved;
}

export function saveInstructorEmployeeFileComponent(api, empId, componentKey, { completed = false, itemCount = 0, schoolYear = '2027' } = {}) {
  return refreshAfterEmployeeFileMutation(
    () => api.updateInstructorEmployeeFileComponent({ empId, schoolYear, componentKey, completed, itemCount }),
    () => refreshInstructorEmployeeFileSnapshot(empId, schoolYear)
  );
}

export function saveInstructorEmployeeFolderUrl(api, empId, folderWebUrl, schoolYear = '2027') {
  return refreshAfterEmployeeFileMutation(
    () => api.updateInstructorEmployeeFolderUrl({ empId, schoolYear, folderWebUrl }),
    () => refreshInstructorEmployeeFileSnapshot(empId, schoolYear)
  );
}
