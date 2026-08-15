import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const activities = await readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
const api = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const graph = await readFile(new URL('../frontend/src/microsoft/graph-mail.js', import.meta.url), 'utf8');
const photo = await readFile(new URL('../supabase/functions/activity-coordination-photo-approval/index.ts', import.meta.url), 'utf8');
const view = await readFile(new URL('../frontend/src/activity-coordination/view.js', import.meta.url), 'utf8');
const detailHtml = await readFile(new URL('../frontend/src/screens/shared/activity-detail-html.js', import.meta.url), 'utf8');

test('2027 activities keep the coordination workspace but remove the permanent table column', () => {
  assert.match(activities, /ACTIVITIES_INNER_TAB_2027, label: 'פעילויות תשפ״ז'[\s\S]*ACTIVITIES_INNER_TAB_COORDINATION, label: 'אישורי תיאום'[\s\S]*ACTIVITIES_INNER_TAB_ARCHIVE/);
  assert.match(activities, /<th>איש קשר<\/th><th>תאריך התחלה<\/th>/);
  assert.doesNotMatch(activities, /<th>אישור תיאום<\/th>/);
  assert.match(activities, /data-coordination-approval[\s\S]*openSecondaryDrawer/);
});

test('coordination approval is view-only and remains outside the activity edit layout', () => {
  assert.match(detailHtml, /data-activity-actions data-view-only>[\s\S]*data-coordination-approval/);
  assert.doesNotMatch(detailHtml, /data-mode="edit"[^>]*>[\s\S]{0,250}data-coordination-approval/);
});

test('activities list projection includes activity_no for syllabus preparation matching', () => {
  assert.match(api, /const ACTIVITY_TABLE_COLUMNS = \[[\s\S]*'activity_no'[\s\S]*\]\.join\(','\)/);
});

test('coordination status filter hides non-matching rows and empty school groups', () => {
  assert.match(view, /function applyCoordinationStatusFilter/);
  assert.match(view, /row\.dataset\.status === selectedStatus/);
  assert.match(view, /row\.style\.display = visible \? '' : 'none'/);
  assert.match(view, /school\.style\.display = schoolVisible \? '' : 'none'/);
  assert.match(view, /if \(!visible\)[\s\S]*item\.checked = false/);
  assert.match(view, /applyCoordinationStatusFilter\(root, filter\.value\)/);
});

test('coordination selection respects visible rows and ready status only', () => {
  assert.match(view, /if \(row\.hidden\) return/);
  assert.match(view, /data-coordination-select-ready[\s\S]*row\?\.dataset\.status === COORDINATION_STATUS\.READY/);
});

test('Graph helper creates drafts under me with immutable IDs and never requests Mail.Send', () => {
  assert.match(graph, /scopes: \['Mail\.ReadWrite'\]/);
  assert.doesNotMatch(graph, /Mail\.Send/);
  assert.match(graph, /Prefer: 'IdType="ImmutableId"'/);
  assert.match(graph, /createGraphDraft[\s\S]*'\/me\/messages'/);
});

test('photo approval SharePoint identifiers are configurable secrets', () => {
  assert.match(photo, /ACTIVITY_COORDINATION_PHOTO_DRIVE_ID/);
  assert.match(photo, /ACTIVITY_COORDINATION_PHOTO_ITEM_ID/);
  assert.doesNotMatch(photo, /think365orgil|b![A-Za-z0-9_-]{10}/);
});
