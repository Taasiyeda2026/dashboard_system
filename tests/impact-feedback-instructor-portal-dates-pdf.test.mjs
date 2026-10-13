import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const screen = readFileSync(new URL('../frontend/src/screens/impact-feedback.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../frontend/src/impact-feedback/impact-feedback-admin.css', import.meta.url), 'utf8');
const api = readFileSync(new URL('../frontend/src/impact-feedback/feedback-api.js', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../supabase/migrations/20261013074500_feedback_instructor_portal_dates_and_pdf.sql', import.meta.url), 'utf8');

test('instructor student feedback shows meeting due date from current activity schedule', () => {
  assert.match(sql, /'due_date'/);
  assert.match(sql, /generate_series\(1, 35\)/);
  assert.match(sql, /scheduling_effective_end_time\(a\.row_id, m\.meeting_date, a\.end_time\)/);
  assert.match(sql, /course_meeting_cancellations/);
  assert.match(sql, /Asia\/Jerusalem/);
  assert.match(screen, /<th>מועד ביצוע<\/th>/);
  assert.match(screen, /item\.due_date/);
  assert.match(screen, /formatInstructorPortalDate\(item\.due_date\)/);
});

test('instructor personal feedback reads optional deadline without inventing an expiry', () => {
  assert.match(sql, /'expires_at', c\.expires_at/);
  assert.match(screen, /<th>לביצוע עד<\/th>/);
  assert.match(screen, /item\.expires_at \?/);
  assert.match(screen, /item\.completed \? 'הושלם'/);
});

test('PDF buttons exist only for current admin-uploaded elementary student PDFs', () => {
  assert.match(sql, /p\.education_level = 'elementary'/);
  assert.match(sql, /t\.current_version_id = fp\.version_id/);
  assert.match(sql, /c\.template_version_id = fp\.version_id/);
  assert.match(sql, /'paper_pdfs', case when/);
  assert.match(screen, /item\.paper_pdf_supported/);
  assert.match(screen, /\['he', 'ar'\]\.map/);
  assert.match(screen, /file \? '' : 'disabled'/);
  assert.match(screen, /data-ifb-instr-pdf/);
  assert.match(screen, /downloadSavedPaperPdf\(file\)/);
  assert.match(api, /createSignedUrl\(record\.storage_path, 60\)/);
  assert.doesNotMatch(screen.slice(screen.indexOf('function instructorFeedbackView'),screen.indexOf('function mountInstructorFeedback')), /uploadSavedPaperPdf|deleteSavedPaperPdf/);
});

test('instructor PDF storage read remains tightly scoped and cannot edit records', () => {
  assert.match(sql, /feedback_instructor_can_download_pdf/);
  assert.match(sql, /u\.auth_user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /u\.role = 'instructor'/);
  assert.match(sql, /a\.emp_id::text = u\.emp_id or a\.emp_id_2 = u\.emp_id/);
  assert.match(sql, /c\.opens_at <= now\(\)/);
  assert.match(sql, /for select to authenticated using/);
  assert.doesNotMatch(sql, /for insert to authenticated|for update to authenticated|for delete to authenticated/i);
  assert.doesNotMatch(sql, /grant select on public\.feedback_|feedback_responses|feedback_answers/);
});

test('only the instructor view gets quiet table styling; existing sharing remains intact', () => {
  assert.match(css, /\.ifb-admin\.is-feedback-instructor \.ifb-portal-table/);
  assert.match(css, /\.ifb-admin\.is-feedback-instructor \.ifb-pdf-action/);
  assert.match(screen, /data-ifb-instr-copy/);
  assert.match(screen, /data-ifb-instr-qr/);
  assert.match(screen, /data-ifb-instr-refresh/);
  assert.match(screen, /if \(isFeedbackInstructor\(state\?\.user\)\)/);
  assert.doesNotMatch(sql, /feedback_staff_auto_control|cron\.job|sendMail|graph\.microsoft/);
});

test('instructor sees student response totals, questionnaire preview, and own green completion', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261013205500_feedback_instructor_portal_progress_expiry.sql', import.meta.url), 'utf8');
  assert.match(migration, /'response_count'/);
  assert.match(migration, /count\(\*\) from public\.feedback_responses fr where fr\.campaign_id=c\.id/);
  assert.match(migration, /interval '14 days'/);
  assert.match(screen, /data-ifb-instr-preview/);
  assert.match(screen, /item\.response_count/);
  assert.match(screen, /ifb-portal-completed/);
  assert.match(screen, /window\.open\(url, '_blank', 'noopener,noreferrer'\)/);
  assert.doesNotMatch(migration, /feedback_answers/);
});

test('admin can schedule after-training messages by Israel-local timestamp, separately from opening', () => {
  const api = readFileSync(new URL('../frontend/src/impact-feedback/feedback-api.js', import.meta.url), 'utf8');
  assert.match(api, /feedback_auto_schedule_instructor_pre/);
  assert.match(screen, /שליחה מתוזמנת \(שעון ישראל\)/);
  assert.match(screen, /type="datetime-local" name="send_at"/);
  assert.match(screen, /scheduleInstructorTrainingFeedback\(/);
  assert.match(screen, /parseIsraelFeedbackTime\(input\)/);
  assert.match(screen, /event\.submitter\?\.value === 'schedule'/);
  assert.match(screen, /form\.dataset\.stage !== 'pre'/);
});
