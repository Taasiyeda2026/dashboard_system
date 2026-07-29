import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const hierarchy = fs.readFileSync(new URL('../frontend/src/israa-tracking-hierarchy-runtime.js', import.meta.url), 'utf8');
const catalog = fs.readFileSync(new URL('../frontend/src/israa-new-row-catalog-runtime.js', import.meta.url), 'utf8');
const filters = fs.readFileSync(new URL('../frontend/src/israa-tracking-filters-runtime.js', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../frontend/sw.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260729192000_israa_tracking_full_details.sql', import.meta.url), 'utf8');

test('external Israa table keeps all requested columns in the requested hierarchy', () => {
  assert.match(hierarchy, /בית ספר וסמל מוסד/);
  for (const label of ['רשות', 'מס׳ הצעה', 'תוכנית', 'מס׳ גפ״ן', 'קבוצות', 'סכום', 'סבירות', 'צבר ריאלי', 'סטטוס', 'תאריך מעקב', 'הפעולה הבאה']) {
    assert.match(hierarchy, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const group of ['identification', 'activity', 'finance', 'tracking']) {
    assert.match(hierarchy, new RegExp(`israa-group-${group}`));
  }
});

test('expanded row exposes contact, proposal, notes, barriers and full programs', () => {
  for (const text of ['פרטי איש הקשר', 'פרטי ההצעה', 'תוקף ההצעה', 'אופן הפנייה', 'הערות וחסמים', 'פירוט מלא של התוכניות']) {
    assert.match(hierarchy, new RegExp(text));
  }
  assert.match(hierarchy, /data-v2-field=\"valid_until\"/);
  assert.match(hierarchy, /data-v2-field=\"outreach_method\"/);
  assert.match(hierarchy, /data-v2-field=\"barriers\"/);
});

test('new row choices load every school page and use system catalogs', () => {
  assert.match(catalog, /const PAGE_SIZE = 1000/);
  assert.match(catalog, /for \(let from = 0; ; from \+= PAGE_SIZE\)/);
  assert.match(catalog, /\.from\('schools'\)/);
  assert.match(catalog, /\.from\('contacts_schools'\)/);
  assert.match(catalog, /\.from\('proposal_gefen_courses'\)/);
  assert.match(catalog, /בחירת בית ספר מתוך הרשימה/);
  assert.match(catalog, /בחירת תוכנית מתוך רשימת הקורסים/);
  assert.match(catalog, /data-israa-new-contact/);
});

test('four filters continue to work with the combined school column', () => {
  assert.match(filters, /בית ספר וסמל מוסד/);
  for (const key of ['authority', 'school', 'program', 'status']) {
    assert.match(filters, new RegExp(`data-israa-v2-filter-${key}`));
  }
  assert.doesNotMatch(filters, /data-israa-v2-filter-probability/);
  assert.doesNotMatch(filters, /data-israa-v2-filter-nature/);
});

test('proposal detail fields are persisted and cache versions are bumped', () => {
  for (const field of ['valid_until', 'outreach_method', 'barriers']) {
    assert.match(migration, new RegExp(field));
  }
  assert.match(entry, /israa-tracking-hierarchy-runtime\.js\?v=20260729-israa-hierarchy-v5/);
  assert.match(entry, /israa-new-row-catalog-runtime\.js\?v=20260729-israa-hierarchy-v5/);
  assert.match(sw, /const CACHE_VERSION = 1307/);
});
