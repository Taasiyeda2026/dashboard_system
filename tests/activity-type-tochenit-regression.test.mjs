import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { catalogActivityChangesFromRows } from '../frontend/src/activity-catalog-identity.js';
import {
  activityTypeDisplayLabel,
  isCanonicalActivityTypeKey,
  normalizeActivityTypeKey
} from '../frontend/src/screens/shared/activity-options.js';
import { activityWorkDrawerHtml, patchDrawerDatesSection } from '../frontend/src/screens/shared/activity-detail-html.js';

test('legacy proposal label תוכנית normalizes to canonical course', () => {
  assert.equal(normalizeActivityTypeKey('תוכנית'), 'course');
  assert.equal(normalizeActivityTypeKey('program'), 'course');
  assert.equal(normalizeActivityTypeKey('קורס'), 'course');
  assert.equal(activityTypeDisplayLabel('תוכנית'), 'קורס');
  assert.equal(isCanonicalActivityTypeKey('תוכנית'), true);
  assert.equal(isCanonicalActivityTypeKey('unknown-type'), false);
});

test('catalog pricing item_type תוכנית resolves to course on save mapping', () => {
  const changes = catalogActivityChangesFromRows({
    selection: {
      activity_name: 'בינה מלאכותית',
      activity_no: '9545',
      gefen_number: '9545'
    },
    listRow: {
      activity_name: 'סודות ויסודות הבינה המלאכותית',
      activity_no: '9545',
      gefen_number: '9545',
      activity_type: 'course'
    },
    pricingRow: {
      activity_name: 'סודות ויסודות הבינה המלאכותית',
      activity_no: '9545',
      gefen_number: '9545',
      item_type: 'תוכנית',
      meetings_count: 8
    },
    courseRow: {
      short_name: 'בינה מלאכותית',
      gefen_number: '9545',
      meetings_count: 8
    }
  }, { normalizeActivityType: normalizeActivityTypeKey });

  assert.equal(changes.activity_type, 'course');
  assert.equal(changes.item_type, 'course');
});

test('legacy corrupted course drawer shows קורס and date section', () => {
  const dates = ['2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05', '2026-11-12', '2026-11-19', '2026-11-26'];
  const row = {
    RowID: 'school_2027_101',
    source_sheet: 'activities',
    activity_type: 'תוכנית',
    item_type: 'תוכנית',
    activity_name: 'בינה מלאכותית',
    activity_season: 'school_2027',
    sessions: 8,
    status: 'פתוח'
  };
  dates.forEach((value, index) => {
    row[`date_${index + 1}`] = value;
  });

  const html = activityWorkDrawerHtml(row, {
    canEdit: true,
    canDirectEdit: true,
    settings: { dropdown_options: { activity_names: [] } }
  });

  assert.match(html, /קורס/);
  assert.match(html, /data-dates-section/);
  assert.match(html, /מפגש 8/);
  assert.doesNotMatch(html, /<option value="תוכנית"/);
  assert.match(html, /<option value="course" selected>קורס<\/option>/);
});

test('activity type select never injects legacy value as an option', () => {
  const html = activityWorkDrawerHtml({
    RowID: 'LEGACY-TYPE',
    activity_type: 'תוכנית',
    item_type: 'תוכנית',
    activity_name: 'ביומימיקרי',
    activity_season: 'school_2027',
    status: 'פתוח'
  }, {
    canEdit: true,
    canDirectEdit: true,
    settings: { dropdown_options: { activity_names: [] } }
  });

  assert.doesNotMatch(html, /<option value="תוכנית"/);
  assert.match(html, /<option value="course" selected>קורס<\/option>/);
});

test('patchDrawerDatesSection treats legacy course label as course schedule', () => {
  const dom = new JSDOM('<section data-dates-section data-session-total="8"><div data-dates-progress-meta></div><div class="activity-drawer__progress-fill"></div><div data-dates-view-chips></div><div data-meeting-dates-edit></div></section>');
  const section = dom.window.document.querySelector('[data-dates-section]');
  const schedule = Array.from({ length: 8 }, (_, index) => ({
    date: `2026-10-${String(8 + index * 7).padStart(2, '0')}`,
    performed: 'no',
    note: ''
  }));

  patchDrawerDatesSection(section, {
    activity_type: 'תוכנית',
    item_type: 'תוכנית',
    sessions: 8,
    meeting_schedule: schedule
  });

  assert.equal(section.querySelector('[data-dates-view-chips]')?.children.length, 8);
  assert.match(section.querySelector('[data-dates-progress-meta]')?.textContent || '', /מתוך 8/);
  assert.equal(section.dataset.sessionTotal, '8');
});

test('save path strips activity_type unless user changed type', async () => {
  const bindSource = await readFile(new URL('../frontend/src/screens/shared/bind-activity-edit-form.js', import.meta.url), 'utf8');
  assert.match(bindSource, /!userChangedActivityType && !catalogSelectionChanged/);
  assert.match(bindSource, /delete changes\.activity_type/);
});

test('api sanitize maps legacy activity types to course', async () => {
  const apiSource = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  assert.match(apiSource, /raw === 'תוכנית'/);
  assert.match(apiSource, /normalizeActivityTypeValue\(rawValue\)/);
});

test('migration repairs only the three known corrupted rows with audit guard', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260819220000_fix_tochenit_activity_type_corruption.sql', import.meta.url), 'utf8');
  assert.match(sql, /school_2027_101/);
  assert.match(sql, /PAI-290c948a-6e3c-485b-879f-2a570ae87255/);
  assert.match(sql, /PAI-d2ad05ca-a437-4630-8feb-eeeb45309420/);
  assert.match(sql, /activities_audit_log/);
  assert.match(sql, /normalize_activities_type_fields/);
  assert.doesNotMatch(sql, /update public\.activities[\s\S]*where[\s\S]*activity_season = 'school_2027'/);
});
