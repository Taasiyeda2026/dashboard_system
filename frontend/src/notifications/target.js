const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function notificationTarget(row) {
  const key = String(row?.entity_key || '');
  if (row?.domain === 'personal_report' && uuid.test(key)) return { route: 'personal-reports', reportId: key };
  if (row?.domain === 'proposal' && uuid.test(key)) return { route: 'proposals-agreements', proposalId: key };
  if (row?.domain === 'attendance') {
    const match = /^(\d+)\|(\d{4}-(?:0[1-9]|1[0-2]))$/.exec(key);
    if (match) return { route: row.stage === 'employee' ? 'employee-attendance' : row.stage === 'payroll' ? 'finance' : ['final_review','dispatch'].includes(row.stage) ? 'admin-home' : 'attendance-control', employeeId: match[1], monthKey: match[2] };
  }
  return null;
}
export function consumeNotificationTarget(state, route) {
  const target = state?.notificationTarget;
  if (!target || target.route !== route || target.authUserId !== state.user?.auth_user_id) return null;
  state.notificationTarget = null;
  return target;
}
