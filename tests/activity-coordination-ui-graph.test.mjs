import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const activities = await readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
const graph = await readFile(new URL('../frontend/src/microsoft/graph-mail.js', import.meta.url), 'utf8');
const photo = await readFile(new URL('../supabase/functions/activity-coordination-photo-approval/index.ts', import.meta.url), 'utf8');

test('2027 activities expose coordination tab and column in the required order', () => {
  assert.match(activities, /ACTIVITIES_INNER_TAB_2027, label: 'פעילויות תשפ״ז'[\s\S]*ACTIVITIES_INNER_TAB_COORDINATION, label: 'אישורי תיאום'[\s\S]*ACTIVITIES_INNER_TAB_ARCHIVE/);
  assert.match(activities, /<th>איש קשר<\/th><th>אישור תיאום<\/th><th>תאריך התחלה<\/th>/);
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
