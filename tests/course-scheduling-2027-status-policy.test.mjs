import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  isSchool2027CourseStatusContext,
  normalizeSchool2027CourseStatus
} from '../frontend/src/school-2027-course-status-policy.js';

const indexUrl = new URL('../index.html', import.meta.url);
const serviceWorkerUrl = new URL('../frontend/sw.js', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/20260804195619_purge_deleted_2027_courses_and_normalize_statuses.sql', import.meta.url);

test('2027 course context is recognized', () => {
  assert.equal(isSchool2027CourseStatusContext({ season: 'school_2027', activityType: 'course' }), true);
  assert.equal(isSchool2027CourseStatusContext({ season: 'school_2027', activityType: 'קורס' }), true);
  assert.equal(isSchool2027CourseStatusContext({ season: 'regular', activityType: 'course' }), false);
  assert.equal(isSchool2027CourseStatusContext({ season: 'school_2027', activityType: 'workshop' }), false);
});

test('only closed remains closed and every legacy stage becomes open', () => {
  assert.equal(normalizeSchool2027CourseStatus('סגור'), 'סגור');
  assert.equal(normalizeSchool2027CourseStatus('closed'), 'סגור');
  assert.equal(normalizeSchool2027CourseStatus('פתוח'), 'פתוח');
  assert.equal(normalizeSchool2027CourseStatus('בתהליך'), 'פתוח');
  assert.equal(normalizeSchool2027CourseStatus('מוכן לשיבוץ'), 'פתוח');
  assert.equal(normalizeSchool2027CourseStatus(''), 'פתוח');
});

test('dashboard entrypoint loads the status policy and refreshes the cache key', async () => {
  const [indexHtml, serviceWorker] = await Promise.all([
    readFile(indexUrl, 'utf8'),
    readFile(serviceWorkerUrl, 'utf8')
  ]);
  assert.match(indexHtml, /school-2027-course-status-policy\.js\?v=20260804-course-status-v1/);
  assert.match(indexHtml, /main-with-proposal-pdf-hotfix\.js\?v=20260804-course-status-v1/);
  assert.match(serviceWorker, /const CACHE_VERSION = 1395;/);
});

test('migration permanently purges deleted 2027 courses and enforces two statuses', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /delete from public\.activities a/i);
  assert.match(sql, /delete from public\.activities_audit_log l/i);
  assert.match(sql, /set status = 'פתוח'/);
  assert.match(sql, /activities_school_2027_course_status_check/);
  assert.match(sql, /in \('פתוח', 'סגור'\)/);
});
