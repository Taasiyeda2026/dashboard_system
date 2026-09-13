import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { instructorAttendanceCardHtml, instructorAttendanceDisplayName } from '../frontend/src/screens/instructor-portal/attendance-card.js';

test('attendance card removes repeated labels and prefers the clean program snapshot', () => {
  const row = {
    activity_type: 'קורס',
    activity_name_snapshot: 'ביומימיקרי — מקיף אבו גוש — אבו גוש',
    program_name_snapshot: 'ביומימיקרי',
    start_time: '08:20:00',
    end_time: '10:10:00',
    total_hours: 1.83,
    school_name_snapshot: 'מקיף אבו גוש',
    authority_name_snapshot: 'אבו גוש',
    roundtrip_km: 95
  };
  assert.equal(instructorAttendanceDisplayName(row), 'ביומימיקרי');
  const html = instructorAttendanceCardHtml(row);
  assert.match(html, /ביומימיקרי/);
  assert.match(html, /קורס/);
  assert.match(html, /08:20–10:10 · 1\.83 שעות/);
  assert.match(html, /מקיף אבו גוש · אבו גוש/);
  assert.match(html, /95 ק״מ/);
  assert.doesNotMatch(html, /דיווח נוכחות|סוג פעילות|שם פעילות|שעת התחלה|שעת סיום|בית ספר|רשות/);
  assert.doesNotMatch(html, /ביומימיקרי — מקיף אבו גוש — אבו גוש/);
});

test('attendance display name strips duplicated location suffixes when program snapshot is missing', () => {
  assert.equal(instructorAttendanceDisplayName({
    activity_name_snapshot: 'ביומימיקרי — מקיף אבו גוש — אבו גוש',
    school_name_snapshot: 'מקיף אבו גוש',
    authority_name_snapshot: 'אבו גוש'
  }), 'ביומימיקרי');
});

test('instructor final polish keeps a single compact calendar toolbar and tighter drawer spacing', () => {
  const calendar = fs.readFileSync(new URL('../frontend/src/screens/instructor-portal/calendar.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../frontend/src/styles/instructor-portal-drawer-hotfix.css', import.meta.url), 'utf8');
  assert.match(calendar, /instr-calendar-toolbar/);
  assert.match(calendar, /instr-calendar-toolbar__title">לוח שנה/);
  assert.doesNotMatch(calendar, /dsPageHeader\('לוח שנה'/);
  assert.match(css, /route-instructor-calendar \.shell-top[\s\S]*display:\s*none\s*!important/);
  assert.match(css, /activity-drawer-inline__body[\s\S]*gap:\s*2px\s*!important/);
  assert.match(css, /activity-drawer-inline__body > \.activity-drawer-inline__core[\s\S]*margin-block:\s*0 2px\s*!important/);
  assert.match(css, /data-activity-layout="workshop"[\s\S]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)\s*!important/);
  assert.match(css, /portal-activities-desktop td:nth-child\(1\)[^}]+width:\s*18%/);
  assert.match(css, /portal-activities-desktop td:nth-child\(2\)[^}]+width:\s*18%/);
  assert.match(css, /portal-activities-desktop tbody tr[\s\S]*min-height:\s*48px/);
});
