import test from 'node:test';
import assert from 'node:assert/strict';
import { canViewIsraaManagement } from '../frontend/src/permissions.js';
import { israaManagementScreen } from '../frontend/src/screens/israa-management.js';

test('admin role grants Israa access regardless of localized display role', () => {
  assert.equal(canViewIsraaManagement({ role: 'admin', display_role: 'מנהל מערכת' }), true);
});

test('Israa permission grants access and an unrelated display role cannot grant or deny it', () => {
  assert.equal(canViewIsraaManagement({ role: 'authorized_user', display_role: 'נציג', view_israa_management: 'yes' }), true);
  assert.equal(canViewIsraaManagement({ role: 'authorized_user', display_role: 'admin', view_israa_management: 'no' }), false);
});

test('user without the Israa role, permission, or existing exception is blocked', () => {
  assert.equal(canViewIsraaManagement({ role: 'instructor', display_role: 'מדריך' }), false);
});

test('authorized Israa screen continues loading tracking rows and rendering table and simulator tabs', async () => {
  let loads = 0;
  const state = { user: { role: 'admin', display_role: 'מנהל מערכת' }, clientSettings: {} };
  const data = await israaManagementScreen.load({
    state,
    api: { israaProgramTracking: async () => { loads += 1; return { rows: [{ id: 1, school_name: 'בית ספר' }] }; } },
  });
  const html = israaManagementScreen.render(data, { state });
  assert.equal(loads, 1);
  assert.match(html, /טבלת תוכניות/);
  assert.match(html, /data-israa-tab="simulator"[^>]*>סימולטור/);
  assert.doesNotMatch(html, /אין גישה לעמוד זה/);
});
