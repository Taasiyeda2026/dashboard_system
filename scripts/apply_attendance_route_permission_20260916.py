from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)


edge_path = Path('supabase/functions/scheduling-route/index.ts')
edge = edge_path.read_text(encoding='utf-8')

edge = replace_once(
    edge,
    "    .select('role,is_active')\n",
    "    .select('role,is_active,permissions')\n",
    'read attendance-control permission'
)

edge = replace_once(
    edge,
    """  if (!['admin', 'operation_manager'].includes(String(appUser?.role || ''))) {
    return jsonResponse({ error: 'scheduling_permission_denied' }, 403);
  }

""",
    "",
    'remove unconditional scheduling role gate'
)

permission_block = """  const appRole = String(appUser?.role || '');
  const hasSchedulingRole = ['admin', 'operation_manager'].includes(appRole);
  const permissions = appUser?.permissions && typeof appUser.permissions === 'object'
    ? appUser.permissions as Record<string, unknown>
    : {};
  const permissionValue = text(permissions.view_attendance_control).toLowerCase();
  const attendanceEmployeeIds = Array.isArray(payload.employee_ids) ? payload.employee_ids : [];
  const isAttendanceRouteRequest = text(payload.scope).toLowerCase() === 'payroll_month'
    && attendanceEmployeeIds.length > 0
    && attendanceEmployeeIds.length <= 500
    && ['yes', 'true', '1'].includes(permissionValue);
  if (!hasSchedulingRole && !isAttendanceRouteRequest) {
    return jsonResponse({ error: 'scheduling_permission_denied' }, 403);
  }

"""

edge = replace_once(
    edge,
    "  const mode = String(payload.mode || 'route').toLowerCase();\n",
    permission_block + "  const mode = String(payload.mode || 'route').toLowerCase();\n",
    'insert scoped attendance-control permission gate'
)

edge_path.write_text(edge, encoding='utf-8')


test_path = Path('tests/attendance-route-autofill.test.mjs')
test = test_path.read_text(encoding='utf-8')
test += r'''

test('attendance-control permission may build only scoped payroll-month routes', () => {
  assert.match(edge, /select\('role,is_active,permissions'\)/);
  assert.match(edge, /view_attendance_control/);
  assert.match(edge, /text\(payload\.scope\)\.toLowerCase\(\) === 'payroll_month'/);
  assert.match(edge, /attendanceEmployeeIds\.length > 0/);
  assert.match(edge, /attendanceEmployeeIds\.length <= 500/);
  assert.match(edge, /if \(!hasSchedulingRole && !isAttendanceRouteRequest\)/);
});
'''
test_path.write_text(test, encoding='utf-8')
