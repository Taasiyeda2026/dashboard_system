from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)


edge_path = Path('supabase/functions/scheduling-route/index.ts')
edge = edge_path.read_text(encoding='utf-8')

old = """  const { data: appUser, error: appUserError } = await db
    .from('users')
    .select('role,is_active')
    .eq('auth_user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  if (appUserError) return jsonResponse({ error: 'authorization_check_failed' }, 500);
  if (!['admin', 'operation_manager'].includes(String(appUser?.role || ''))) {
    return jsonResponse({ error: 'scheduling_permission_denied' }, 403);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
"""

new = """  const { data: appUser, error: appUserError } = await db
    .from('users')
    .select('role,is_active,permissions')
    .eq('auth_user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  if (appUserError) return jsonResponse({ error: 'authorization_check_failed' }, 500);

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const appRole = String(appUser?.role || '');
  const hasSchedulingRole = ['admin', 'operation_manager'].includes(appRole);
  const permissionValue = text((appUser?.permissions as Record<string, unknown> | null)?.view_attendance_control).toLowerCase();
  const employeeIds = Array.isArray(payload.employee_ids) ? payload.employee_ids : [];
  const isAttendanceRouteRequest = text(payload.scope).toLowerCase() === 'payroll_month'
    && employeeIds.length > 0
    && employeeIds.length <= 500
    && ['yes', 'true', '1'].includes(permissionValue);
  if (!hasSchedulingRole && !isAttendanceRouteRequest) {
    return jsonResponse({ error: 'scheduling_permission_denied' }, 403);
  }
"""

edge = replace_once(edge, old, new, 'attendance-control permission scope')
edge_path.write_text(edge, encoding='utf-8')


test_path = Path('tests/attendance-route-autofill.test.mjs')
test = test_path.read_text(encoding='utf-8')
test += r'''

test('attendance-control permission may build only scoped payroll-month routes', () => {
  assert.match(edge, /select\('role,is_active,permissions'\)/);
  assert.match(edge, /view_attendance_control/);
  assert.match(edge, /text\(payload\.scope\)\.toLowerCase\(\) === 'payroll_month'/);
  assert.match(edge, /employeeIds\.length > 0/);
  assert.match(edge, /employeeIds\.length <= 500/);
  assert.match(edge, /if \(!hasSchedulingRole && !isAttendanceRouteRequest\)/);
});
'''
test_path.write_text(test, encoding='utf-8')
