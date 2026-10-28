import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { campaignUiStatus, groupHasFeedback } from '../frontend/src/impact-feedback/feedback-domain.js';

const file = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sql = file('supabase/migrations/20261028210000_feedback_exclude_four_student_pre_only.sql');
const screen = file('frontend/src/screens/impact-feedback.js');
const css = file('frontend/src/impact-feedback/impact-feedback-admin.css');

test('only the four named 2027 student opening campaigns were exempted', () => {
  const ids = [
    'school_2027_049',
    'ACT-d18c3eaa-e3fa-4d4f-ad9b-e293b4781d12',
    'school_2027_050',
    'school_2027_052'
  ];
  for (const id of ids) assert.match(sql, new RegExp(id));
  assert.match(sql, /c\.audience='student' and c\.stage='pre'/);
  assert.match(sql, /and new\.status='active'/);
  assert.match(sql, /feedback_student_pre_not_required/);
  assert.match(sql, /not exists\(select 1 from public\.feedback_responses/);
  assert.match(sql, /set status='closed'/);
  assert.doesNotMatch(sql, /delete from public\.feedback_campaigns/i);
});

test('excluded pre-surveys are not shown as outstanding and preserve staff and closing surveys', () => {
  const excluded = { audience:'student', stage:'pre', status:'closed', not_required:true, responses:0 };
  assert.deepEqual(campaignUiStatus(excluded), {
    key:'not_required', label:'לא נדרש', tone:'muted', responses:0
  });
  assert.equal(groupHasFeedback({ campaigns:[excluded] }),false);
  assert.equal(groupHasFeedback({ campaigns:[excluded,{ audience:'educational_staff', stage:'pre', status:'active' }] }),true);
  assert.equal(campaignUiStatus({ audience:'student', stage:'post', status:'active' }).key,'active');
  assert.match(screen, /campaign\?\.not_required === true/);
  assert.match(screen, /campaign\.not_required \|\|/);
});

test('email table stays compact while dashboard has no unrequested monitoring table or overrides', () => {
  assert.doesNotMatch(screen, /routineMonitoringHtml|ifb-monitoring-table|בקרה שוטפת - הפצה וסטטוס/);
  assert.doesNotMatch(css, /Compact, RTL operational tracking|ifb-monitoring-wrap/);
  assert.match(file('supabase/functions/feedback-expiry-weekly/index.ts'), /width="520"/);
  assert.match(file('supabase/functions/feedback-expiry-weekly/index.ts'), /direction:rtl/);
});
