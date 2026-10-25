import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canShareEducationalStaffFeedback } from '../frontend/src/impact-feedback/feedback-access.js';

const screen = readFileSync(new URL('../frontend/src/screens/impact-feedback.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../frontend/src/impact-feedback/impact-feedback-admin.css', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261025120000_feedback_staff_manager_share_scope.sql', import.meta.url), 'utf8');

test('only active assigned activity managers and admins can share educational-staff feedback', () => {
  const row = { activity_manager: 'הילה רוזן' };
  assert.equal(canShareEducationalStaffFeedback({role: 'admin'}, row), true);
  assert.equal(canShareEducationalStaffFeedback({role: 'activities_manager', full_name: ' הילה   רוזן '}, row), true);
  assert.equal(canShareEducationalStaffFeedback({role: 'activities_manager', full_name: '', name: 'הילה רוזן'}, row), true);
  assert.equal(canShareEducationalStaffFeedback({role: 'activities_manager', full_name: 'גיל נאמן'}, row), false);
  assert.equal(canShareEducationalStaffFeedback({role: 'activities_manager', full_name: 'הילה רוזן', is_active: false}, row), false);
  assert.equal(canShareEducationalStaffFeedback({role: 'business_development_manager', full_name: 'הילה רוזן'}, row), false);
  assert.equal(canShareEducationalStaffFeedback({role: 'activities_manager'}, row), false);
  assert.equal(canShareEducationalStaffFeedback({role: 'activities_manager', full_name: 'הילה רוזן'}, {}), false);
});

test('educational-staff table contains an instructor column, including deduplicated course rows', () => {
  assert.match(screen, /scope === 'staff' \? '<th scope="col">מדריך\/ה בקורס<\/th>'/);
  assert.match(screen, /staff_instructor_names/);
  assert.match(screen, /instructorsByGroup\.get\(key\)\.add/);
  assert.match(screen, /col class="ifb-gw-instructor"/);
  assert.match(css, /\.ifb-groups-table--staff col\.ifb-gw-instructor/);
});

test('manager share controls apply only to staff slots; close and edit remain hidden', () => {
  assert.match(screen, /slot\.audience === 'educational_staff' && canShareEducationalStaffFeedback\(state\?\.user, group\)/);
  assert.match(screen, /data-ifb-staff-share-enabled="true"/);
  assert.match(screen, /allowedStaffShareClick/);
  assert.match(screen, /allowedStaffOpenForm/);
  assert.match(css, /\.is-feedback-readonly \[data-ifb-staff-share-enabled="true"\]/);
  assert.doesNotMatch(css.slice(css.indexOf('/* Scoped exception:')), /\[data-ifb-close\]|\[data-ifb-reopen\]|\[data-ifb-extend\]/);
});

test('backend permits only manager-owned staff opening and mark_shared', () => {
  assert.match(migration, /u\.role = 'activities_manager'/);
  assert.match(migration, /a\.row_id = p_activity_row_id/);
  assert.match(migration, /c\.audience = 'educational_staff'/);
  assert.match(migration, /p_audience = ''educational_staff'' and private\.feedback_can_share_staff_activity/);
  assert.match(migration, /p_action = ''mark_shared''/);
  assert.match(migration, /p_channel in \(''whatsapp'', ''email'', ''copy''\)/);
  assert.doesNotMatch(migration, /create or replace function private\.feedback_is_admin/);
});
