export async function loadInstructorEmployeeFile(api, empId, schoolYear = '2027') {
  if (!api || typeof api.instructorEmployeeFile !== 'function') throw new Error('employee_file_api_unavailable');
  const payload = await api.instructorEmployeeFile({ empId, schoolYear });
  return payload && typeof payload === 'object' ? payload : { mapped: false, components: [] };
}
