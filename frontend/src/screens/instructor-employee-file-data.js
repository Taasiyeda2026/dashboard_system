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
