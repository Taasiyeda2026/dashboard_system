import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { canShareEducationalStaffFeedback, canShareAssignedActivityFeedback } from '../frontend/src/impact-feedback/feedback-access.js';

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
  assert.match(screen, /slot\.audience === 'educational_staff' && canShareEducationalStaffFeedback\(user, group\)/);
  assert.match(screen, /feedbackViewerUser = state\?\.user \?\? null/);
  assert.match(screen, /groupViewHtml\(findGroup\(ui\.groupRowId\), feedbackViewerUser\)/);
  assert.match(screen, /visibleSlots\.map\(\(slot\) => slotCardHtml\(group, slot, user\)\)/);
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


test('staff feedback slot renders for manager and admin without an undefined state reference', () => {
  const start = screen.indexOf('function slotCardHtml(');
  const end = screen.indexOf('\nfunction prePostMetricTableHtml(', start);
  assert.ok(start >= 0 && end > start, 'slot renderer should be present');
  const renderSlot = runInNewContext(screen.slice(start, end) + '\nslotCardHtml;', {
    canShareEducationalStaffFeedback,
    canShareAssignedActivityFeedback,
    slotCampaign: () => null,
    campaignUiStatus: () => ({ key: 'not_started' }),
    campaignStatusHtml: () => '',
    openFormHtml: () => '',
    esc: (value) => String(value)
  });
  const group = { activity_manager: 'הילה רוזן' };
  const staffSlot = { audience: 'educational_staff', key: 'educational_staff:pre', label: 'משוב פתיחה' };
  const authorized = renderSlot(group, staffSlot, { role: 'activities_manager', full_name: 'הילה רוזן', is_active: true });
  assert.match(authorized, /data-ifb-staff-share-enabled="true"/);
  const anotherManager = renderSlot(group, staffSlot, { role: 'activities_manager', full_name: 'גיל נאמן', is_active: true });
  assert.doesNotMatch(anotherManager, /data-ifb-staff-share-enabled/);
  const admin = renderSlot(group, staffSlot, { role: 'admin' });
  assert.match(admin, /data-ifb-staff-share-enabled="true"/);
  const student = renderSlot(group, { audience: 'student', key: 'student:pre', label: 'תלמידים פתיחה' }, { role: 'admin' });
  assert.doesNotMatch(student, /data-ifb-staff-share-enabled/);
});

test('assigned managers can present and copy existing student links, but cannot manage campaigns', () => {
  const own = { activity_manager: 'הילה רוזן' };
  const another = { activity_manager: 'גיל נאמן' };
  const manager = { role: 'activities_manager', full_name: 'הילה רוזן', is_active: true };
  assert.equal(canShareAssignedActivityFeedback(manager, own), true);
  assert.equal(canShareAssignedActivityFeedback(manager, another), false);
  assert.equal(canShareAssignedActivityFeedback({ role: 'operation_manager', full_name: 'הילה רוזן' }, own), false);
  assert.equal(canShareAssignedActivityFeedback({ role: 'activities_manager', full_name: 'הילה רוזן', is_active: false }, own), false);
  assert.match(screen, /slot\.audience === 'student' && canShareAssignedActivityFeedback\(user, group\)/);
  assert.match(screen, /data-ifb-student-share-enabled="true"/);
  assert.match(screen, /allowedStudentShareClick/);
  assert.match(screen, /!allowedStaffShareClick && !allowedStudentShareClick/);
  assert.match(css, /is-feedback-readonly \[data-ifb-student-share-enabled="true"\]/);
  assert.match(css, /\[data-ifb-qr\], \[data-ifb-copy\]/);
  const start = screen.indexOf('function slotCardHtml(');
  const end = screen.indexOf('\nfunction prePostMetricTableHtml(', start);
  const render = runInNewContext(screen.slice(start, end) + '\nslotCardHtml;', {
    canShareEducationalStaffFeedback,
    canShareAssignedActivityFeedback,
    slotCampaign: () => ({ id: 'test-id', audience: 'student', stage: 'pre', status: 'active', opens_at: '2026-10-26T08:15:00Z', expires_at: '2026-11-09T21:59:00Z' }),
    campaignUiStatus: () => ({ key: 'active' }),
    campaignStatusHtml: () => '',
    fmtDate: () => '',
    esc: (value) => String(value)
  });
  const slot = { audience: 'student', stage: 'pre', key: 'student:pre', label: 'תלמידים – פתיחה' };
  const allowed = render(own, slot, manager);
  assert.match(allowed, /data-ifb-student-share-enabled="true"/);
  assert.match(allowed, /data-ifb-qr="test-id"/);
  assert.match(allowed, /data-ifb-copy="test-id"/);
  assert.doesNotMatch(render(another, slot, manager), /data-ifb-student-share-enabled/);
  assert.doesNotMatch(render(own, slot, { role: 'operation_manager', full_name: 'הילה רוזן' }), /data-ifb-student-share-enabled/);
});
