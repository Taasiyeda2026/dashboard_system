import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { photoConsentSchoolKey, photoConsentDocumentsBySchool, photoConsentSchoolManagementGroups } from '../frontend/src/screens/shared/photo-consent-school.js';

const SCREEN = new URL('../frontend/src/screens/photo-consent-workspace.js', import.meta.url);

test('photo consent school grouping includes other activities of the same school only', () => {
  const activities = [
    { id: 5, school: '  בית   ספר  א ', authority: 'חיפה', activity_name: 'ביומימיקרי' },
    { id: 7, school: 'בית ספר א', authority: ' חיפה ', activity_name: 'טכנולוגיות החלל' },
    { id: 9, school: 'בית ספר א', authority: 'נתניה', activity_name: 'יישומי AI' },
    { id: 11, school: 'בית ספר ב', authority: 'חיפה', activity_name: 'מנהיגות ירוקה' }
  ];
  const files = [
    { id: 'first', activity_id: 5, uploaded_at: '2026-10-10T10:00:00Z' },
    { id: 'second', activity_id: 7, uploaded_at: '2026-10-11T10:00:00Z' },
    { id: 'another-city', activity_id: 9, uploaded_at: '2026-10-11T11:00:00Z' },
    { id: 'another-school', activity_id: 11, uploaded_at: '2026-10-11T12:00:00Z' },
    { id: 'outside-year', activity_id: 999, uploaded_at: '2026-10-11T13:00:00Z' }
  ];

  assert.equal(photoConsentSchoolKey(activities[0]), photoConsentSchoolKey(activities[1]));
  assert.notEqual(photoConsentSchoolKey(activities[0]), photoConsentSchoolKey(activities[2]));
  assert.equal(photoConsentSchoolKey({ school: '', authority: 'חיפה' }), '');
  const grouped = photoConsentDocumentsBySchool(activities, files);
  const sameSchool = grouped.get(photoConsentSchoolKey(activities[0]));
  assert.deepEqual(sameSchool.map((f) => f.id), ['second', 'first']);
  assert.deepEqual(sameSchool.map((f) => f.ownerActivity.activity_name), ['טכנולוגיות החלל', 'ביומימיקרי']);
  assert.deepEqual(grouped.get(photoConsentSchoolKey(activities[2])).map((f) => f.id), ['another-city']);
  assert.deepEqual(grouped.get(photoConsentSchoolKey(activities[3])).map((f) => f.id), ['another-school']);
  assert.equal([...grouped.values()].flat().length, 4);
});

test('photo consent filters start collapsed and preserve their open state', async () => {
  const source = await readFile(SCREEN, 'utf8');
  assert.match(source, /filtersOpen: false/);
  assert.match(source, /data-pc-filter-toggle/);
  assert.match(source, /context\.filtersOpen = !context\.filtersOpen/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /context\.filtersOpen \? '' : ' hidden'/);
  assert.match(source, /data-pc-clear/);
});

test('photo consent provides a responsive card layout without horizontal scrolling on small screens', async () => {
  const source = await readFile(SCREEN, 'utf8');
  assert.match(source, /@media\(max-width:820px\)/);
  assert.match(source, /\.pc-table-wrap\{display:none\}/);
  assert.match(source, /\.pc-mobile-list\{display:grid/);
  assert.match(source, /class="pc-mobile-card"/);
  assert.match(source, /\.pc-toolbar\{grid-template-columns:1fr 1fr\}/);
  assert.match(source, /\.pc-kpi/);
});

test('school click opens associated documents without any upload action in management', async () => {
  const source = await readFile(SCREEN, 'utf8');
  assert.match(source, /photoConsentSchoolManagementGroups\(context\.activities, context\.files\)/);
  assert.match(source, /data-pc-toggle/);
  assert.match(source, /aria-label="פתיחת אישורי צילום של /);
  assert.match(source, /file\.ownerActivity\?\.activity_name/);
  assert.match(source, /data-pc-view/);
  assert.match(source, /data-pc-download/);
  assert.match(source, /data-pc-replace/);
  assert.match(source, /data-pc-delete/);
  assert.doesNotMatch(source, /data-pc-upload/);
  assert.doesNotMatch(source, /מסמכים חתומים לפי פעילות שיש לה תאריך התחלה/);
});

test('signed files stay private in SharePoint and permission checks stay in place', async () => {
  const source = await readFile(SCREEN, 'utf8');
  assert.match(source, /state\?\.user\?\.permissions\?\.manage_photo_consents/);
  assert.match(source, /photoConsentInvoke/);
  assert.match(source, /'download'/);
  assert.match(source, /\.from\('activity_photo_consent_files'\)/);
});

test('management lists only schools containing uploaded signed documents', () => {
  const activities = [
    { id: 1, school: 'אורנים', authority: 'חיפה', activity_name: 'חלל' },
    { id: 2, school: 'אורנים', authority: 'חיפה', activity_name: 'ביומימיקרי' },
    { id: 3, school: 'ברושים', authority: 'חיפה', activity_name: 'חלל' },
    { id: 4, school: 'אורנים', authority: 'נתניה', activity_name: 'AI' }
  ];
  const files = [
    { id: 'a', activity_id: 1, uploaded_at: '2026-10-10T10:00:00Z' },
    { id: 'b', activity_id: 2, uploaded_at: '2026-10-11T10:00:00Z' }
  ];
  const groups = photoConsentSchoolManagementGroups(activities, files);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].school, 'אורנים');
  assert.equal(groups[0].authority, 'חיפה');
  assert.equal(groups[0].documents.length, 2);
  assert.equal(groups[0].activityCount, 2);
});
