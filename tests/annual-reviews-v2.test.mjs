import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260723123000_simplify_annual_review_workflow.sql', import.meta.url), 'utf8');
const screen = await readFile(new URL('../frontend/src/screens/annual-reviews-v2.js', import.meta.url), 'utf8');
const entry = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');

test('simplified annual review module is loaded by the application entrypoint', () => {
  assert.match(entry, /import '\.\/screens\/annual-reviews-v2\.js';/);
});

test('employee and manager complete private parallel sections before atomic reveal', () => {
  assert.match(migration, /employee_section_submitted_at timestamptz/);
  assert.match(migration, /manager_section_submitted_at timestamptz/);
  assert.match(migration, /answers_revealed_at timestamptz/);
  assert.match(migration, /create or replace function public\.submit_employee_section/);
  assert.match(migration, /create or replace function public\.submit_manager_section/);
  assert.match(migration, /for update;/);
  assert.match(migration, /jsonb_build_object\('answers_revealed', reveal_now\)/);
  assert.match(screen, /התשובות ייחשפו רק לאחר אישור שני הצדדים/);
});

test('each side has ten parallel written questions and manager ratings', () => {
  const employeeBlock = screen.match(/const EMPLOYEE_QUESTIONS = \[([\s\S]*?)\n\];/)?.[1] || '';
  const managerBlock = screen.match(/const MANAGER_QUESTIONS = \[([\s\S]*?)\n\];/)?.[1] || '';
  assert.equal((employeeBlock.match(/^\s*\['/gm) || []).length, 10);
  assert.equal((managerBlock.match(/^\s*\['/gm) || []).length, 10);
  assert.match(screen, /data-ar2-answer-rating/);
  assert.match(screen, /manager_review_preparation/);
  assert.match(migration, /answers jsonb not null default '\{\}'::jsonb/);
});

test('only role-specific metrics remain in the manager professional section', () => {
  assert.match(migration, /select label, 'role'::text/);
  assert.match(migration, /delete from public\.manager_review_evaluations[\s\S]*metric_group = 'common'/);
  assert.match(screen, /\.eq\('metric_group', 'role'\)/);
  for (const key of ['tony_naim', 'hila_rozen', 'gil_neeman', 'eden_cohen']) {
    assert.match(migration, new RegExp(`when '${key}'`));
  }
});

test('shared conversation is read-only guidance and stores no content', () => {
  assert.match(screen, /מסך משותף לצפייה בלבד\. לא נשמר בו תוכן/);
  assert.equal((screen.match(/const CONVERSATION_GUIDE = \[([\s\S]*?)\n\];/)?.[1].match(/^\s*'/gm) || []).length, 8);
  assert.doesNotMatch(screen, /data-ar2-form="conversation/);
  assert.doesNotMatch(screen, /review_goals/);
  assert.match(migration, /revoke insert, update, delete on table public\.review_conversation_summary from authenticated/);
  assert.match(migration, /revoke insert, update, delete on table public\.review_goals from authenticated/);
});

test('manager summary is private until sent to the employee', () => {
  assert.match(migration, /create table if not exists public\.manager_review_summary/);
  assert.match(migration, /annual_review_manager_can_summarize/);
  assert.match(migration, /manager_summary_submitted_at is not null/);
  assert.match(migration, /create or replace function public\.submit_manager_summary/);
  assert.match(screen, /פרטי למנהל בזמן הכתיבה\. נחשף לעובד רק לאחר ההעברה/);
  assert.match(screen, /data-ar2-operation="submit_manager_summary"/);
});

test('employee signature completes and locks the review without a second manager approval', () => {
  assert.match(migration, /create or replace function public\.complete_review_as_employee/);
  assert.match(migration, /status = 'completed_locked'/);
  assert.match(migration, /employee_signed_at = now\(\)/);
  assert.match(migration, /locked_at = now\(\)/);
  assert.match(migration, /revoke execute on function public\.approve_review_as_manager/);
  assert.match(screen, /אישור וסיום המשוב/);
  assert.match(screen, /אינו מחייב הסכמה עם כל תוכנו/);
});

test('print action is manager-only and available after completion', () => {
  assert.match(screen, /const printButton = isManager && review\.status === 'completed_locked'/);
  assert.match(screen, /הדפסת המשוב המלא/);
  assert.match(screen, /employeeSectionHtml[\s\S]*managerSectionHtml[\s\S]*conversationHtml[\s\S]*summaryHtml[\s\S]*responseHtml/);
});

test('database permissions enforce private drafts and read-only shared stage', () => {
  assert.match(migration, /employee_preparation_select[\s\S]*answers_revealed_at is not null/);
  assert.match(migration, /manager_preparation_select[\s\S]*answers_revealed_at is not null/);
  assert.match(migration, /evaluations_participant_select[\s\S]*answers_revealed_at is not null/);
  assert.match(migration, /manager_summary_select[\s\S]*manager_summary_submitted_at is not null/);
  assert.match(migration, /response_participant_select[\s\S]*employee_signed_at is not null/);
  assert.match(migration, /revoke insert, update, delete on table public\.annual_reviews from authenticated/);
});

test('autosave uses optimistic child-row versions', () => {
  assert.match(screen, /\.eq\('version', version\)/);
  assert.match(screen, /המידע השתנה במקום אחר/);
  assert.match(screen, /data-version=/);
});

test('one click path opens exactly one review and releases the button after an error', async () => {
  const start = screen.indexOf('function bindGlobalClicks()');
  const end = screen.indexOf('\n\nlet enhanceQueued', start);
  assert.ok(start >= 0 && end > start, 'global click binding should exist');

  let clickHandler;
  const documentStub = {
    addEventListener(type, handler) {
      if (type === 'click') clickHandler = handler;
    }
  };
  let openCalls = 0;
  let rejectOpen;
  const openReviewStub = () => {
    openCalls += 1;
    return new Promise((resolve, reject) => { rejectOpen = reject; });
  };
  const runtimeState = { openingReview: null };
  const install = new Function('document', 'openReview', 'state', `${screen.slice(start, end)}; bindGlobalClicks();`);
  install(documentStub, openReviewStub, runtimeState);

  const attributes = new Map();
  const button = {
    dataset: { ar2Open: 'review-1' },
    textContent: 'פתיחת המשוב',
    disabled: false,
    isConnected: true,
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); }
  };
  const event = {
    target: { closest: (selector) => selector === '[data-ar2-open]' ? button : null },
    preventDefault() {},
    stopPropagation() {}
  };

  const firstClick = clickHandler(event);
  const secondClick = clickHandler(event);
  assert.equal(openCalls, 1);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'טוען…');
  rejectOpen(new Error('network failed'));
  await Promise.all([firstClick, secondClick]);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'פתיחת המשוב');
  assert.equal(attributes.has('aria-busy'), false);
});

test('annual review opener uses one local mechanism without changing authentication events', async () => {
  const personalReports = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');
  assert.doesNotMatch(personalReports, /data-ar-open=/);
  assert.match(personalReports, /data-ar2-open=/);
  assert.equal((screen.match(/document\.addEventListener\('click'/g) || []).length, 1);
  assert.doesNotMatch(screen, /EventTarget\.prototype\.addEventListener\s*=/);
  assert.doesNotMatch(entry, /annual-reviews-open-button-guard/);
  await assert.rejects(readFile(new URL('../frontend/src/annual-reviews-open-button-guard.js', import.meta.url), 'utf8'));
});
