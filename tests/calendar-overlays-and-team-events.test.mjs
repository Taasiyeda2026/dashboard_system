import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const FEATURE_LOADERS = new URL('../frontend/src/feature-loaders.js', import.meta.url);
const TEAM_UI = new URL('../frontend/src/screens/shared/team-calendar-ui.js', import.meta.url);
const TEAM_DATA = new URL('../frontend/src/screens/shared/team-calendar-data.js', import.meta.url);
const MIGRATION = new URL('../supabase/migrations/20260802150500_add_team_calendar_events.sql', import.meta.url);

test('month, week and dashboard routes load all calendar overlays directly', async () => {
  const source = await readFile(FEATURE_LOADERS, 'utf8');
  assert.match(source, /dashboard:\s*\['dashboard', 'calendarOverlays'\]/);
  assert.match(source, /week:\s*\['activityDrawer', 'calendarOverlays'\]/);
  assert.match(source, /month:\s*\['activityDrawer', 'calendarOverlays'\]/);
  assert.match(source, /import\('\.\/school-calendar-runtime\.js'\)/);
  assert.match(source, /import\('\.\/birthday-calendar\.js'\)/);
  assert.match(source, /import\('\.\/team-calendar-runtime\.js'\)/);
});

test('team calendar uses its own labels and does not overwrite holiday or birthday labels', async () => {
  const source = await readFile(TEAM_UI, 'utf8');
  assert.match(source, /data-team-calendar-label/);
  assert.match(source, /teamCalendarSignature/);
  assert.doesNotMatch(source, /data-birthday-calendar-label/);
  assert.doesNotMatch(source, /data-school-calendar-label/);
  assert.doesNotMatch(source, /clearStaleLabels/);
  assert.doesNotMatch(source, /\.ds-interactive-card__subtitle[^\n]*textContent\s*=/);
});

test('team calendar reads only active shared events for authenticated users', async () => {
  const source = await readFile(TEAM_DATA, 'utf8');
  assert.match(source, /from\('team_calendar_events'\)/);
  assert.match(source, /\.eq\('is_active', true\)/);
  assert.match(source, /\.eq\('show_on_main_calendar', true\)/);
  assert.match(source, /supabase\.auth\.getSession\(\)/);
});

test('August and September seed contains unique deterministic events', async () => {
  const source = await readFile(MIGRATION, 'utf8');
  const keys = [...source.matchAll(/'TEAM-(\d{8})-(\d{2})'/g)].map((match) => match[0]);
  assert.equal(keys.length, 44);
  assert.equal(new Set(keys).size, 44);
  assert.match(source, /'2026-08-02', 'מיפוי קורסים', 'עדן'/);
  assert.match(source, /'2026-09-01', 'ביצוע שיבוצים', 'עדן'/);
  assert.match(source, /'2026-09-17', 'הכשרת מדריכים', 'מנהלים'/);
  assert.match(source, /on conflict \(external_key\) do update/);
});
