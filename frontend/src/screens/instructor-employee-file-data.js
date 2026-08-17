import { supabase } from '../supabase-client.js';

export async function loadInstructorEmployeeFile(api, empId, schoolYear = '2027') {
  if (!api || typeof api.instructorEmployeeFile !== 'function') throw new Error('employee_file_api_unavailable');
  const payload = await api.instructorEmployeeFile({ empId, schoolYear });
  return payload && typeof payload === 'object' ? payload : { mapped: false, components: [] };
}

export async function refreshInstructorEmployeeFileSnapshot(empId, schoolYear = '2027') {
  const { data, error } = await supabase.functions.invoke('instructor-employee-file-live', {
    body: { empId, schoolYear, refresh: true }
  });
  if (error) throw new Error(error.message || 'employee_file_snapshot_refresh_failed');
  return data;
}

export function createEmployeeFileSharePointReturnSync({
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
  refresh = refreshInstructorEmployeeFileSnapshot,
  logger = globalThis.console
} = {}) {
  let pending = null;
  let dashboardWasLeft = false;

  const markDashboardLeft = () => {
    if (pending) dashboardWasLeft = true;
  };
  const refreshOnReturn = () => {
    if (!pending || !dashboardWasLeft) return;
    const refreshTarget = pending;
    pending = null;
    dashboardWasLeft = false;
    Promise.resolve()
      .then(() => refresh(refreshTarget.empId, refreshTarget.schoolYear))
      .catch((error) => logger?.error?.('[employee-file] SharePoint return refresh failed', error));
  };
  const onVisibilityChange = () => {
    if (documentTarget?.visibilityState === 'hidden') markDashboardLeft();
    else if (documentTarget?.visibilityState === 'visible') refreshOnReturn();
  };

  windowTarget?.addEventListener?.('blur', markDashboardLeft);
  windowTarget?.addEventListener?.('focus', refreshOnReturn);
  documentTarget?.addEventListener?.('visibilitychange', onVisibilityChange);

  return {
    markSharePointOpened(empId, schoolYear = '2027') {
      pending = { empId, schoolYear };
      dashboardWasLeft = false;
    },
    destroy() {
      pending = null;
      dashboardWasLeft = false;
      windowTarget?.removeEventListener?.('blur', markDashboardLeft);
      windowTarget?.removeEventListener?.('focus', refreshOnReturn);
      documentTarget?.removeEventListener?.('visibilitychange', onVisibilityChange);
    }
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
