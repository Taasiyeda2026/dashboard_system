import { supabase } from '../supabase-client.js';

export async function loadInstructorEmployeeFile(api, empId, schoolYear = '2027') {
  try {
    const { data, error } = await supabase.functions.invoke('instructor-employee-file-live', {
      body: { empId, schoolYear }
    });
    if (!error && data && typeof data === 'object') return data;
  } catch (_) {
    // Fall back to the secured snapshot RPC while Microsoft Graph is not configured or temporarily unavailable.
  }

  if (!api || typeof api.instructorEmployeeFile !== 'function') throw new Error('employee_file_api_unavailable');
  const payload = await api.instructorEmployeeFile({ empId, schoolYear });
  return payload && typeof payload === 'object' ? payload : { mapped: false, components: [] };
}

export function saveInstructorEmployeeFileComponent(api, empId, componentKey, { completed = false, itemCount = 0, schoolYear = '2027' } = {}) {
  return api.updateInstructorEmployeeFileComponent({ empId, schoolYear, componentKey, completed, itemCount });
}

export function saveInstructorEmployeeFolderUrl(api, empId, folderWebUrl, schoolYear = '2027') {
  return api.updateInstructorEmployeeFolderUrl({ empId, schoolYear, folderWebUrl });
}
