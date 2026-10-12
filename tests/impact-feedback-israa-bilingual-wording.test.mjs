import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canEditImpactFeedbackWording } from '../frontend/src/impact-feedback/feedback-access.js';

const sql = readFileSync(new URL('../supabase/migrations/20261012175000_feedback_israa_bilingual_wording_only.sql', import.meta.url), 'utf8');
const api = readFileSync(new URL('../frontend/src/impact-feedback/feedback-api.js', import.meta.url), 'utf8');
const view = readFileSync(new URL('../frontend/src/impact-feedback/feedback-templates-view.js', import.meta.url), 'utf8');
const screen = readFileSync(new URL('../frontend/src/screens/impact-feedback.js', import.meta.url), 'utf8');

test('only the exact active Israa account receives Hebrew and Arabic template wording permission', () => {
  const isra = { user_id:'3030', role:'business_development_manager', is_active:true };
  assert.equal(canEditImpactFeedbackWording(isra), true);
  assert.equal(canEditImpactFeedbackWording({...isra,user_id:'3031'}), false);
  assert.equal(canEditImpactFeedbackWording({...isra,role:'instructor'}), false);
  assert.equal(canEditImpactFeedbackWording({...isra,is_active:false}), false);
  assert.equal(canEditImpactFeedbackWording({role:'admin'}), false);
  assert.match(sql, /u\.auth_user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /u\.user_id = '3030'/);
  assert.match(sql, /u\.role = 'business_development_manager'/);
  assert.match(sql, /coalesce\(u\.is_active, false\)/);
});

test('server only permits Hebrew or Arabic question text corrections in draft, with stale-write check', () => {
  assert.match(sql, /create or replace function public\.feedback_israa_update_wording/);
  assert.match(sql, /p_language not in \('he', 'ar'\)/);
  assert.match(sql, /v_key := case when p_language = 'he' then 'default' else 'ar' end/);
  assert.match(sql, /v_status <> 'draft'/);
  assert.match(sql, /v_wording->>v_key, ''\) is distinct from p_expected_text/);
  assert.match(sql, /jsonb_set\(coalesce\(v_wording, '\{\}'::jsonb\)/);
  assert.match(sql, /set wording = v_wording where q\.id = p_question_id/);
  assert.doesNotMatch(sql, /grant (update|insert|delete) on public\.feedback_/i);
  assert.doesNotMatch(sql, /create or replace function public\.feedback_admin_publish_draft/);
});

test('Israa works in shared drafts and cannot access template structure actions', () => {
  assert.match(sql, /feedback_israa_get_wording_draft/);
  assert.match(sql, /for update/);
  assert.match(sql, /status = 'draft'/);
  assert.match(api, /feedback_israa_get_wording_draft/);
  assert.match(api, /feedback_israa_update_wording/);
  assert.match(view, /function wordingOnlyQuestionHtml/);
  assert.match(view, /data-tpl-wording-edit/);
  assert.match(view, /wordingOnly \? true/);
  assert.match(view, /field === 'wording.default' \|\| field === 'wording.ar'/);
  assert.match(view, /readOnly && !t\.closest\(canEditWording/);
  assert.match(view, /if \(readOnly\) \{ event\.preventDefault\(\); return; \}/);
  assert.match(screen, /feedbackReadOnly = !isFeedbackAdmin/);
  assert.match(screen, /feedbackCanEditWording = canEditImpactFeedbackWording/);
});
