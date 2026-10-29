import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Audits the migration that was deployed to Supabase. This is a contract test:
// the email scheduler must never select an activity excluded from the dashboard.
const sql = readFileSync(new URL('../supabase/migrations/20261029083000_feedback_staff_auto_align_with_assigned_activities.sql',import.meta.url),'utf8');
const screen = readFileSync(new URL('../frontend/src/screens/impact-feedback.js',import.meta.url),'utf8');

test('staff automated candidates exclude activities missing a locked instructor assignment',()=>{
  assert.match(sql,/CREATE OR REPLACE FUNCTION public\.feedback_staff_auto_candidates/);
  assert.match(sql,/a\.instructor_assignment_locked is true/);
  assert.match(sql,/a\.emp_id is not null or nullif\(btrim\(a\.emp_id_2\),'\'\) is not null/);
});

test('staff table reads the same academic-year activity groups instead of a second standalone list',()=>{
  assert.match(screen,/fetchGroups\(year\)/);
  assert.match(screen,/if \(scope === 'staff'\)/);
  assert.match(screen,/groupsTableHtml\(STAFF_SLOTS, 'staff'\)/);
});
